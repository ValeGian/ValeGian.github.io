/**
 * Adding a card.
 *
 * Search the catalog, pick the exact printing, type what it cost. A card the catalog has
 * not published yet is still addable — it goes in with what was read off the card itself
 * and resolves later — because a set bought on release day in Japan can sit unpublished
 * for weeks, and the purchase still happened.
 */
import { el, frag } from '../lib/dom.ts';
import { cardThumb } from './thumb.ts';
import { convert } from '../lib/fx.ts';
import { searchCards, cardDetail, pricedVariantId, type CardHit } from '../lib/tcgdex.ts';
import { toEnglish } from '../../lib/card-name.mjs';
import type { NameTable } from '../lib/data.ts';
import type { CollectionItem, Currency } from '../lib/types.ts';

export interface AddCardState {
  names: NameTable;
  query: string;
  results: CardHit[];
  searching: boolean;
  picked: CardHit | null;
  manual: boolean;
  error: string;
  saving: boolean;
  onChange(change: Partial<AddCardState>): void;
  onSave(item: CollectionItem): Promise<void>;
  onCancel(): void;
  nextId(): string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function field(label: string, input: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, el('span', { text: label }), input);
}

function resultTile(hit: CardHit, state: AddCardState): HTMLElement {
  return el(
    'button',
    {
      type: 'button',
      class: state.picked?.id === hit.id ? 'result on' : 'result',
      onClick: () => state.onChange({ picked: hit, manual: false }),
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

export function renderAddCard(state: AddCardState): HTMLElement {
  const form = el('form', { class: 'add-form' });

  const search = el('input', {
    type: 'search',
    placeholder: 'Charizard, リザードン, Mega Rayquaza…',
    'aria-label': 'Search the catalog',
    value: state.query,
    onInput: (event: Event) => {
      const text = (event.target as HTMLInputElement).value;
      state.onChange({ query: text });
    },
  });

  const runSearch = async () => {
    state.onChange({ searching: true, error: '' });
    try {
      state.onChange({ results: await searchCards(search.value, state.names), searching: false });
    } catch (error) {
      state.onChange({
        searching: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const amount = el('input', { type: 'number', min: '0', step: '0.01', required: true, inputmode: 'decimal' });
  const currency = el(
    'select',
    {},
    el('option', { value: 'JPY', text: 'JPY ¥' }),
    el('option', { value: 'EUR', text: 'EUR €' }),
  );
  const date = el('input', { type: 'date', value: today(), required: true });
  const quantity = el('input', { type: 'number', min: '1', step: '1', value: '1' });
  const notes = el('input', { type: 'text', placeholder: 'Shop, condition remarks…' });

  const manualSet = el('input', { type: 'text', placeholder: 'M6a' });
  const manualNumber = el('input', { type: 'text', placeholder: '045' });
  const manualName = el('input', { type: 'text', placeholder: 'ピカチュウ' });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.picked && !state.manual) {
      state.onChange({ error: 'Pick a card, or add it as not-yet-in-the-catalog.' });
      return;
    }

    state.onChange({ saving: true, error: '' });

    try {
      const purchaseDate = date.value;
      const money = await convert(Number(amount.value), currency.value as Currency, purchaseDate);

      const base = {
        id: state.nextId(),
        condition: 'NM' as const,
        isGraded: false as const,
        quantity: Number(quantity.value) || 1,
        purchase: {
          date: purchaseDate,
          amount: Number(amount.value),
          currency: currency.value as Currency,
          amountEur: money.amountEur,
          fxRate: money.fxRate,
          fxSource: (currency.value === 'EUR' ? 'identity' : 'frankfurter') as 'identity' | 'frankfurter',
        },
        notes: notes.value,
      };

      if (state.manual || !state.picked) {
        await state.onSave({
          ...base,
          status: 'pending',
          hint: { setCode: manualSet.value.trim(), number: manualNumber.value.trim(), nameJa: manualName.value.trim() },
          pendingSince: purchaseDate,
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
      el(
        'div',
        { class: 'search-row' },
        search,
        el('button', {
          type: 'button',
          class: 'chip',
          text: state.searching ? 'Searching…' : 'Search',
          disabled: state.searching,
          onClick: runSearch,
        }),
      ),
      state.results.length > 0
        ? el('div', { class: 'results' }, ...state.results.map((hit) => resultTile(hit, state)))
        : null,
      el('label', { class: 'check' },
        el('input', {
          type: 'checkbox',
          checked: state.manual,
          onChange: (event: Event) =>
            state.onChange({ manual: (event.target as HTMLInputElement).checked, picked: null }),
        }),
        el('span', { text: 'Not in the catalog yet — I will type what is on the card' }),
      ),
      state.manual
        ? el(
            'div',
            { class: 'grid-fields' },
            field('Set code', manualSet),
            field('Number', manualNumber),
            field('Name as printed', manualName),
          )
        : null,
      el(
        'div',
        { class: 'grid-fields' },
        field('Paid', amount),
        field('Currency', currency),
        field('Date', date),
        field('Copies', quantity),
      ),
      field('Notes', notes),
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
