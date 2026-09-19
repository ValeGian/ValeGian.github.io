/**
 * Adding a card.
 *
 * One search box, the way Cardmarket's works: type and results appear. It accepts an
 * English name, a Japanese name, or a card id pasted straight in, because in a shop the
 * thing in front of you is usually the code printed on the card.
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
import type { NameTable } from '../lib/data.ts';
import type { CollectionItem, Currency } from '../lib/types.ts';

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
}

export interface AddCardState extends AddCardFields {
  names: NameTable;
  results: CardHit[];
  searching: boolean;
  picked: CardHit | null;
  manual: boolean;
  error: string;
  saving: boolean;
  onChange(change: Partial<AddCardState>): void;
  onSearch(query: string): void;
  onSave(item: CollectionItem): Promise<void>;
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
});

function field(id: string, label: string, input: HTMLElement): HTMLElement {
  return el('label', { class: 'field', for: id }, el('span', { text: label }), input);
}

function textField(
  id: string,
  value: string,
  onInput: (value: string) => void,
  extra: Record<string, unknown> = {},
): HTMLInputElement {
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
    cardThumb({ imageBase: hit.image }, { width: 48, height: 67 }),
    el(
      'span',
      { class: 'result-text' },
      el('span', { class: 'result-name', text: toEnglish(hit.name, state.names) }),
      el('span', { class: 'result-meta ui', text: hit.id }),
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

export function renderAddCard(state: AddCardState): HTMLElement {
  const form = el('form', { class: 'add-form' });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.picked && !state.manual) {
      state.onChange({ error: 'Pick a card from the results, or tick the box to add it by hand.' });
      return;
    }

    const amount = Number(state.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      state.onChange({ error: 'Enter what the card cost.' });
      return;
    }

    state.onChange({ saving: true, error: '' });

    try {
      const money = await convert(amount, state.currency, state.date);
      const base = {
        id: state.nextId(),
        condition: 'NM' as const,
        isGraded: false as const,
        quantity: Number(state.quantity) || 1,
        purchase: {
          date: state.date,
          amount,
          currency: state.currency,
          amountEur: money.amountEur,
          fxRate: money.fxRate,
          fxSource: (state.currency === 'EUR' ? 'identity' : 'frankfurter') as 'identity' | 'frankfurter',
        },
        notes: state.notes,
      };

      if (state.manual || !state.picked) {
        await state.onSave({
          ...base,
          status: 'pending',
          hint: {
            setCode: state.manualSet.trim(),
            number: state.manualNumber.trim(),
            nameJa: state.manualName.trim(),
          },
          pendingSince: state.date,
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
      el('h3', { text: 'Add a card' }),
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
      state.manual
        ? el(
            'div',
            { class: 'grid-fields' },
            field('add-set', 'Set code', textField('add-set', state.manualSet, (manualSet) => state.onChange({ manualSet }), { type: 'text', placeholder: 'M6a' })),
            field('add-number', 'Number', textField('add-number', state.manualNumber, (manualNumber) => state.onChange({ manualNumber }), { type: 'text', placeholder: '045' })),
            field('add-name', 'Name as printed', textField('add-name', state.manualName, (manualName) => state.onChange({ manualName }), { type: 'text', placeholder: 'ピカチュウ' })),
          )
        : null,
      el(
        'div',
        { class: 'grid-fields' },
        field('add-amount', 'Paid', textField('add-amount', state.amount, (amount) => state.onChange({ amount }), { type: 'number', min: '0', step: '0.01', inputmode: 'decimal', required: true })),
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
        field('add-date', 'Date', textField('add-date', state.date, (date) => state.onChange({ date }), { type: 'date', required: true })),
        field('add-quantity', 'Copies', textField('add-quantity', state.quantity, (quantity) => state.onChange({ quantity }), { type: 'number', min: '1', step: '1' })),
      ),
      field('add-notes', 'Notes', textField('add-notes', state.notes, (notes) => state.onChange({ notes }), { type: 'text', placeholder: 'Shop, condition remarks…' })),
      state.error ? el('p', { class: 'form-error ui', text: state.error }) : null,
      el(
        'div',
        { class: 'form-actions' },
        el('button', { type: 'submit', text: state.saving ? 'Saving…' : 'Add card', disabled: state.saving }),
        el('button', { type: 'button', class: 'chip', text: 'Cancel', onClick: state.onCancel }),
      ),
    ),
  );

  return form;
}

export { searchCards, looksLikeCardId };
