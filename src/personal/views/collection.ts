/**
 * The collection: what is owned, what it cost, what it is worth now.
 */
import { el, frag } from '../lib/dom.ts';
import { money, signedMoney, percent, totals, type Valued } from '../lib/money.ts';
import { apply, sort, type Filters, type SortKey } from '../lib/filters.ts';
import { displayName, subtitle, type NameTable } from '../lib/data.ts';
import { cardThumb } from './thumb.ts';

export interface CollectionViewState {
  rows: Valued[];
  names: NameTable;
  filters: Filters;
  sortKey: SortKey;
  sortDescending: boolean;
  onFilters(change: Partial<Filters>): void;
  onSort(key: SortKey): void;
  onOpen(itemId: string): void;
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'value', label: 'Value' },
  { key: 'gain', label: 'Gain' },
  { key: 'ratio', label: 'Gain %' },
  { key: 'paid', label: 'Paid' },
  { key: 'date', label: 'Bought' },
  { key: 'name', label: 'Name' },
  { key: 'set', label: 'Set' },
];

/** Date windows worth one tap. The trip window is set by hand from the date fields. */
function presets(): { label: string; from: string; to: string }[] {
  const today = new Date().toISOString().slice(0, 10);
  return [
    { label: 'All time', from: '', to: '' },
    { label: 'This month', from: `${today.slice(0, 7)}-01`, to: today },
    { label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
}

const money0 = (value: number | null): string => (value === null ? '—' : money(value));

function gainCell(entry: Valued): HTMLElement {
  if (entry.gain === null) return el('span', { class: 'muted ui', text: 'no price yet' });
  const tone = entry.gain > 0 ? 'up' : entry.gain < 0 ? 'down' : 'flat';
  return el(
    'span',
    { class: `gain ${tone} numeric` },
    signedMoney(entry.gain),
    entry.ratio === null ? null : el('span', { class: 'gain-ratio', text: percent(entry.ratio) }),
  );
}

function summary(rows: Valued[]): HTMLElement {
  const figures = totals(rows);
  const cells: [string, string, string?][] = [
    ['Cards', String(figures.cards)],
    ['Paid', money(figures.paid)],
    ['Value now', money(figures.valued), figures.unpriced > 0 ? `${figures.unpriced} without a price` : undefined],
    ['Gain', signedMoney(figures.gain), figures.ratio === null ? undefined : percent(figures.ratio)],
  ];

  return el(
    'dl',
    { class: 'summary' },
    ...cells.map(([label, text, note]) =>
      el(
        'div',
        {},
        el('dt', { text: label }),
        el('dd', { class: 'numeric', text }),
        note ? el('dd', { class: 'summary-note', text: note }) : null,
      ),
    ),
  );
}

function filterBar(state: CollectionViewState): HTMLElement {
  const { filters, onFilters } = state;
  const sets = [...new Set(state.rows.map((entry) => entry.item.setId).filter(Boolean))].sort() as string[];

  return el(
    'div',
    { class: 'filters' },
    el('input', {
      // The id is what lets the caret survive the rebuild this keystroke causes.
      id: 'filter-text',
      type: 'search',
      class: 'search',
      placeholder: 'Name, set, number or card id',
      'aria-label': 'Search cards',
      autocomplete: 'off',
      value: filters.text,
      onInput: (event: Event) => onFilters({ text: (event.target as HTMLInputElement).value }),
    }),
    el(
      'select',
      {
        id: 'filter-set',
        'aria-label': 'Set',
        onChange: (event: Event) => onFilters({ setId: (event.target as HTMLSelectElement).value }),
      },
      el('option', { value: '', text: 'Every set' }),
      ...sets.map((setId) => el('option', { value: setId, text: setId, selected: filters.setId === setId })),
    ),
    el(
      'div',
      { class: 'dates' },
      el('input', {
        id: 'filter-from',
        type: 'date',
        'aria-label': 'Bought from',
        value: filters.from,
        onChange: (event: Event) => onFilters({ from: (event.target as HTMLInputElement).value }),
      }),
      el('span', { class: 'muted ui', text: 'to' }),
      el('input', {
        id: 'filter-to',
        type: 'date',
        'aria-label': 'Bought until',
        value: filters.to,
        onChange: (event: Event) => onFilters({ to: (event.target as HTMLInputElement).value }),
      }),
    ),
    el(
      'div',
      { class: 'chips' },
      ...presets().map((preset) =>
        el('button', {
          type: 'button',
          class: filters.from === preset.from && filters.to === preset.to ? 'chip on' : 'chip',
          text: preset.label,
          onClick: () => onFilters({ from: preset.from, to: preset.to }),
        }),
      ),
      el('button', {
        type: 'button',
        class: filters.onlyGainers ? 'chip on' : 'chip',
        text: 'Up',
        onClick: () => onFilters({ onlyGainers: !filters.onlyGainers, onlyLosers: false }),
      }),
      el('button', {
        type: 'button',
        class: filters.onlyLosers ? 'chip on' : 'chip',
        text: 'Down',
        onClick: () => onFilters({ onlyLosers: !filters.onlyLosers, onlyGainers: false }),
      }),
      el('button', {
        type: 'button',
        class: filters.onlyPending ? 'chip on' : 'chip',
        text: 'Awaiting catalog',
        onClick: () => onFilters({ onlyPending: !filters.onlyPending }),
      }),
    ),
  );
}

function sortBar(state: CollectionViewState): HTMLElement {
  return el(
    'div',
    { class: 'sorts' },
    el('span', { class: 'muted ui', text: 'Sort' }),
    ...SORTS.map((option) =>
      el('button', {
        type: 'button',
        class: state.sortKey === option.key ? 'chip on' : 'chip',
        text: state.sortKey === option.key ? `${option.label} ${state.sortDescending ? '↓' : '↑'}` : option.label,
        onClick: () => state.onSort(option.key),
      }),
    ),
  );
}

function cardRow(entry: Valued, names: NameTable, onOpen: (id: string) => void): HTMLElement {

  return el(
    'li',
    { class: 'card-row' },
    el(
      'button',
      { type: 'button', class: 'card-open', onClick: () => onOpen(entry.item.id) },
      cardThumb(entry.item),
      el(
        'span',
        { class: 'card-name' },
        el('span', { class: 'card-title', text: displayName(entry.item, names) }),
        el(
          'span',
          { class: 'card-meta ui' },
          subtitle(entry.item),
          entry.item.quantity > 1 ? ` · ${entry.item.quantity} copies` : '',
          entry.item.status === 'pending' ? el('span', { class: 'flag', text: 'awaiting catalog' }) : null,
        ),
      ),
      el(
        'span',
        { class: 'card-figures' },
        el('span', { class: 'paid numeric', text: money(entry.paid) }),
        el('span', { class: 'value numeric', text: money0(entry.value) }),
        gainCell(entry),
      ),
    ),
  );
}

export function renderCollection(state: CollectionViewState): DocumentFragment {
  const visible = sort(apply(state.rows, state.filters), state.sortKey, state.sortDescending);

  return frag(
    filterBar(state),
    summary(visible),
    sortBar(state),
    visible.length === 0
      ? el('p', { class: 'empty', text: 'No cards match these filters.' })
      : el('ul', { class: 'card-list' }, ...visible.map((entry) => cardRow(entry, state.names, state.onOpen))),
  );
}
