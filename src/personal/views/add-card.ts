/**
 * Adding a card, to the collection or to a wishlist.
 *
 * One search box, the way Cardmarket's works: type and results appear. It accepts an
 * English name, a Japanese name, or a card id pasted straight in, because in a shop the
 * thing in front of you is usually the code printed on the card.
 *
 * The two destinations ask for different things and the form says so. A card you own has
 * a price you paid, in the currency you paid it, on a date. A card you are still looking
 * for has only a price you would be willing to pay — asking what it cost would be asking
 * about something that has not happened.
 *
 * Every field is driven from state rather than read off the DOM at submit time. The view
 * is rebuilt whenever anything changes, and an uncontrolled field would be wiped each
 * time results arrived — which is exactly what used to happen to the price.
 */
import { el, frag } from '../lib/dom.ts';
import { convert } from '../lib/fx.ts';
import { searchCards, cardDetail, pricedVariantId, looksLikeCardId, type CardHit } from '../lib/tcgdex.ts';
import { toEnglish } from '../../lib/card-name.mjs';
import { cardThumb } from './thumb.ts';
import { preparePhoto, type PreparedPhoto } from '../lib/photo.ts';
import type { NameTable } from '../lib/data.ts';
import type { CollectionItem, Currency, WishlistItem } from '../lib/types.ts';

export type AddMode = 'collection' | 'wishlist';

export interface AddCardFields {
  query: string;
  amount: string;
  currency: Currency;
  date: string;
  quantity: string;
  notes: string;
  manualSet: string;
  manualNumber: string;
  manualName: string;
  /** Wishlist only: what I would pay, in euro, decided by the person who wants it. */
  target: string;
  priority: WishlistItem['priority'];
  owners: string[];
}

export interface AddCardState extends AddCardFields {
  mode: AddMode;
  names: NameTable;
  /** Lists that can be added to, in display order. Admin sees all of them. */
  lists: { id: string; label: string }[];
  results: CardHit[];
  searching: boolean;
  picked: CardHit | null;
  manual: boolean;
  /** A photo of a card the catalog cannot show, taken in the shop. */
  photo: PreparedPhoto | null;
  error: string;
  saving: boolean;
  onChange(change: Partial<AddCardState>): void;
  /** For a field's own text, which the DOM already shows. See Store.set. */
  onField(change: Partial<AddCardFields>): void;
  /**
   * The current field values at the moment they are read.
   *
   * Field edits deliberately do not rebuild the view, so the props this component was
   * rendered with go stale as soon as anything is typed. Submitting has to ask for the
   * live values rather than trust the snapshot it closed over.
   */
  latest(): AddCardFields;
  onSearch(query: string): void;
  onSave(item: CollectionItem, photo?: PreparedPhoto | null): Promise<void>;
  onSaveWish(owners: string[], item: Omit<WishlistItem, 'id'>): Promise<void>;
  onCancel(): void;
  nextId(): string;
}

export const today = (): string => new Date().toISOString().slice(0, 10);

export const blankFields = (): AddCardFields => ({
  query: '',
  amount: '',
  currency: 'JPY',
  date: today(),
  quantity: '1',
  notes: '',
  manualSet: '',
  manualNumber: '',
  manualName: '',
  target: '',
  priority: 'normal',
  owners: [],
});

/**
 * A wanted card carries no purchase: it has not been bought. Only a target, whose
 * absence is meaningful too — "I want this at any price" is a real answer.
 */
async function submitWish(state: AddCardState): Promise<void> {
  const fields = state.latest();

  if (state.owners.length === 0) {
    state.onChange({ error: 'Choose whose list this goes on.' });
    return;
  }

  const target = fields.target.trim() === '' ? null : Number(fields.target);
  if (target !== null && (!Number.isFinite(target) || target <= 0)) {
    state.onChange({ error: 'A target price has to be a number, or left empty.' });
    return;
  }

  state.onChange({ saving: true, error: '' });

  try {
    const shared = {
      status: 'wanted' as const,
      targetPriceEur: target,
      priority: fields.priority,
      notes: fields.notes,
      addedAt: today(),
    };

    if (state.manual || !state.picked) {
      await state.onSaveWish(state.owners, {
        ...shared,
        setId: fields.manualSet.trim(),
        number: fields.manualNumber.trim(),
        nameJa: fields.manualName.trim(),
      });
      return;
    }

    if (state.picked.mirrorOf) {
      await state.onSaveWish(state.owners, {
        ...shared,
        setId: state.picked.mirrorOf.setCode,
        number: state.picked.localId,
        nameJa: state.picked.name,
        nameEn: state.picked.name,
        imageBase: state.picked.image ?? '',
      });
      return;
    }

    const detail = await cardDetail(state.picked.id);
    await state.onSaveWish(state.owners, {
      ...shared,
      cardId: detail.id,
      setId: detail.set.id,
      number: detail.localId,
      nameJa: detail.name,
      nameEn: toEnglish(detail.name, state.names),
      imageBase: detail.image ?? '',
    });
  } catch (error) {
    state.onChange({ saving: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function field(id: string, label: string, input: HTMLElement): HTMLElement {
  return el('label', { class: 'field', for: id }, el('span', { text: label }), input);
}

function textField(
  id: string,
  value: string,
  onInput: (value: string) => void,
  extra: Record<string, unknown> = {},
): HTMLInputElement {
  // The handler records the value; it must not trigger a rebuild, or the element the
  // caret is in gets replaced mid-word.
  return el('input', {
    id,
    value,
    ...extra,
    onInput: (event: Event) => onInput((event.target as HTMLInputElement).value),
  });
}

function resultTile(hit: CardHit, state: AddCardState): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      class: state.picked?.id === hit.id ? 'result on' : 'result',
      onClick: () => state.onChange({ picked: hit, manual: false, error: '' }),
    },
    cardThumb({ imageBase: hit.image, cardId: hit.id }, { width: 48, height: 67 }, 'eager'),
    el(
      'span',
      { class: 'result-text' },
      el('span', { class: 'result-name', text: toEnglish(hit.name, state.names) }),
      el('span', {
        class: 'result-meta ui',
        text: hit.mirrorOf ? `${hit.mirrorOf.setCode}-${hit.localId} · awaiting the Japanese catalog` : hit.id,
      }),
    ),
  );
}

function searchStatus(state: AddCardState): HTMLElement | null {
  if (state.searching) return el('p', { class: 'search-status ui', text: 'Searching…' });
  if (state.query.trim().length >= 2 && state.results.length === 0) {
    return el('p', {
      class: 'search-status ui',
      text: 'Nothing found. Check the spelling, or tick the box below to add it by hand.',
    });
  }
  return null;
}

/**
 * A photo stands in until the catalog publishes artwork. It is shrunk before it is
 * accepted, and refused if it will not shrink: the repository keeps every version of
 * everything, so an oversized image would be permanent.
 */
function photoField(state: AddCardState): HTMLElement {
  return el(
    'div',
    { class: 'photo-field' },
    el(
      'label',
      { class: 'field', for: 'add-photo' },
      el('span', { text: 'Photo of the card (optional)' }),
      el('input', {
        id: 'add-photo',
        type: 'file',
        accept: 'image/*',
        capture: 'environment',
        onChange: async (event: Event) => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (!file) return;
          try {
            state.onChange({ photo: await preparePhoto(file), error: '' });
          } catch (error) {
            state.onChange({ photo: null, error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
    ),
    state.photo
      ? el(
          'div',
          { class: 'photo-preview' },
          el('img', { src: state.photo.dataUrl, alt: 'The card you photographed', width: 60 }),
          el('span', {
            class: 'ui muted',
            text: `${state.photo.width}×${state.photo.height}, ${Math.round(state.photo.bytes / 1024)} KB`,
          }),
          el('button', {
            type: 'button',
            class: 'chip',
            text: 'Remove photo',
            onClick: () => state.onChange({ photo: null }),
          }),
        )
      : null,
  );
}

function purchaseFields(state: AddCardState): HTMLElement {
  return el(
    'div',
    { class: 'grid-fields' },
    field('add-amount', 'Paid', textField('add-amount', state.amount, (amount) => state.onField({ amount }), { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', required: true })),
    field(
      'add-currency',
      'Currency',
      el(
        'select',
        {
          id: 'add-currency',
          onChange: (event: Event) => state.onChange({ currency: (event.target as HTMLSelectElement).value as Currency }),
        },
        el('option', { value: 'JPY', text: 'JPY ¥', selected: state.currency === 'JPY' }),
        el('option', { value: 'EUR', text: 'EUR €', selected: state.currency === 'EUR' }),
      ),
    ),
    field('add-date', 'Date', textField('add-date', state.date, (date) => state.onField({ date }), { type: 'date', required: true })),
    field('add-quantity', 'Copies', textField('add-quantity', state.quantity, (quantity) => state.onField({ quantity }), { type: 'number', min: '1', step: '1' })),
  );
}

function wishFields(state: AddCardState): DocumentFragment {
  const toggle = (id: string) =>
    state.owners.includes(id)
      ? state.owners.filter((owner) => owner !== id)
      : [...state.owners, id];

  return frag(
    el(
      'fieldset',
      { class: 'owners' },
      el('legend', { text: 'Whose list' }),
      ...state.lists.map((list) =>
        el(
          'label',
          { class: state.owners.includes(list.id) ? 'owner-choice on' : 'owner-choice', for: `add-owner-${list.id}` },
          el('input', {
            id: `add-owner-${list.id}`,
            type: 'checkbox',
            checked: state.owners.includes(list.id),
            onChange: () => state.onChange({ owners: toggle(list.id), error: '' }),
          }),
          el('span', { text: list.label }),
        ),
      ),
    ),
    el(
      'div',
      { class: 'grid-fields' },
      field(
        'add-target',
        'Target price (€)',
        textField('add-target', state.target, (target) => state.onField({ target }), {
          type: 'number',
          min: '0',
          step: '0.01',
          inputmode: 'decimal',
          placeholder: 'leave empty for any price',
        }),
      ),
      field(
        'add-priority',
        'Priority',
        el(
          'select',
          {
            id: 'add-priority',
            onChange: (event: Event) =>
              state.onField({ priority: (event.target as HTMLSelectElement).value as WishlistItem['priority'] }),
          },
          ...(['high', 'normal', 'low'] as const).map((level) =>
            el('option', { value: level, text: level, selected: state.priority === level }),
          ),
        ),
      ),
    ),
  );
}

function addToLabel(state: AddCardState): string {
  if (state.owners.length === 0) return 'Add to wishlist';
  if (state.owners.length === 1) {
    return `Add to ${state.lists.find((list) => list.id === state.owners[0])?.label ?? 'list'}`;
  }
  return `Add to ${state.owners.length} lists`;
}

export function renderAddCard(state: AddCardState): HTMLElement {
  const form = el('form', { class: 'add-form' });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.picked && !state.manual) {
      state.onChange({ error: 'Pick a card from the results, or tick the box to add it by hand.' });
      return;
    }

    if (state.mode === 'wishlist') {
      await submitWish(state);
      return;
    }

    const fields = state.latest();
    const amount = Number(fields.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      state.onChange({ error: 'Enter what the card cost.' });
      return;
    }

    state.onChange({ saving: true, error: '' });

    try {
      const money = await convert(amount, fields.currency, fields.date);
      const base = {
        id: state.nextId(),
        condition: 'NM' as const,
        isGraded: false as const,
        quantity: Number(fields.quantity) || 1,
        purchase: {
          date: fields.date,
          amount,
          currency: fields.currency,
          amountEur: money.amountEur,
          fxRate: money.fxRate,
          fxSource: (fields.currency === 'EUR' ? 'identity' : 'frankfurter') as 'identity' | 'frankfurter',
        },
        notes: fields.notes,
      };

      if (state.manual || !state.picked) {
        await state.onSave(
          {
            ...base,
            status: 'pending',
            hint: {
              setCode: fields.manualSet.trim(),
              number: fields.manualNumber.trim(),
              nameJa: fields.manualName.trim(),
            },
            pendingSince: fields.date,
            ...(state.photo ? { photoUrl: `/data/photos/${base.id}.jpg` } : {}),
          },
          state.photo,
        );
        return;
      }

      // A stand-in for a set TCGdex has not published. It names and pictures the card but
      // is a different Cardmarket product, so it is recorded as pending under the Japanese
      // set code and priced only once scripts/resolve-pending.mjs finds the real one.
      if (state.picked.mirrorOf) {
        await state.onSave({
          ...base,
          status: 'pending',
          hint: {
            setCode: state.picked.mirrorOf.setCode,
            number: state.picked.localId,
            nameJa: state.picked.name,
          },
          nameEn: state.picked.name,
          number: state.picked.localId,
          imageBase: state.picked.image ?? '',
          pendingSince: fields.date,
        });
        return;
      }

      const detail = await cardDetail(state.picked.id);
      await state.onSave({
        ...base,
        status: 'resolved',
        cardId: detail.id,
        variantId: pricedVariantId(detail),
        setId: detail.set.id,
        number: detail.localId,
        nameJa: detail.name,
        nameEn: toEnglish(detail.name, state.names),
        rarity: detail.rarity ?? null,
        imageBase: detail.image ?? '',
        catalogSource: 'tcgdex',
      });
    } catch (error) {
      state.onChange({ saving: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  form.append(
    frag(
      el('h3', { text: state.mode === 'collection' ? 'Add a card you bought' : 'Add a card to look for' }),
      textField(
        'add-search',
        state.query,
        (value) => state.onSearch(value),
        {
          type: 'search',
          class: 'search',
          placeholder: 'Charizard, リザードン, or SV2a-201',
          'aria-label': 'Search the catalog by name or card id',
          autocomplete: 'off',
        },
      ),
      searchStatus(state),
      state.results.length > 0
        ? el('div', { class: 'results' }, ...state.results.map((hit) => resultTile(hit, state)))
        : null,
      el(
        'label',
        { class: 'check', for: 'add-manual' },
        el('input', {
          id: 'add-manual',
          type: 'checkbox',
          checked: state.manual,
          onChange: (event: Event) =>
            state.onChange({ manual: (event.target as HTMLInputElement).checked, picked: null, error: '' }),
        }),
        el('span', { text: 'Not in the catalog yet — I will type what is on the card' }),
      ),
      state.manual ? photoField(state) : null,
      state.manual
        ? el(
            'div',
            { class: 'grid-fields' },
            field('add-set', 'Set code', textField('add-set', state.manualSet, (manualSet) => state.onField({ manualSet }), { type: 'text', placeholder: 'M6a' })),
            field('add-number', 'Number', textField('add-number', state.manualNumber, (manualNumber) => state.onField({ manualNumber }), { type: 'text', placeholder: '045' })),
            field('add-name', 'Name as printed', textField('add-name', state.manualName, (manualName) => state.onField({ manualName }), { type: 'text', placeholder: 'ピカチュウ' })),
          )
        : null,
      state.mode === 'collection' ? purchaseFields(state) : wishFields(state),
      field(
        'add-notes',
        'Notes',
        textField('add-notes', state.notes, (notes) => state.onField({ notes }), {
          type: 'text',
          placeholder: state.mode === 'collection' ? 'Shop, condition remarks…' : 'Only if well centred, no whitening…',
        }),
      ),
      state.error ? el('p', { class: 'form-error ui', text: state.error }) : null,
      el(
        'div',
        { class: 'form-actions' },
        el('button', {
          type: 'submit',
          text: state.saving ? 'Saving…' : state.mode === 'collection' ? 'Add to collection' : addToLabel(state),
          disabled: state.saving,
        }),
        el('button', { type: 'button', class: 'chip', text: 'Cancel', onClick: state.onCancel }),
      ),
    ),
  );

  return form;
}

export { searchCards, looksLikeCardId };
