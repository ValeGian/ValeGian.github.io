/**
 * Filtering and sorting for the collection.
 *
 * Pure functions over already-valued rows, so they can be reasoned about and tested
 * without a DOM or a network.
 */
import type { Valued } from './money.ts';

export interface Filters {
  text: string;
  setId: string;
  condition: string;
  from: string;
  to: string;
  onlyPending: boolean;
  onlyGainers: boolean;
  onlyLosers: boolean;
}

export const emptyFilters: Filters = {
  text: '',
  setId: '',
  condition: '',
  from: '',
  to: '',
  onlyPending: false,
  onlyGainers: false,
  onlyLosers: false,
};

export type SortKey = 'value' | 'paid' | 'gain' | 'ratio' | 'name' | 'date' | 'set';

/**
 * Everything one box should match: both names, the set, the number, the card id and any
 * note. Separators are flattened so `S12a-261`, `S12a 261` and `s12a261` all find the
 * same card, which is what anyone who has used Cardmarket's search will expect.
 */
const flatten = (text: string): string => text.toLowerCase().replace(/[\s\-_/]+/g, '');

const searchable = (row: Valued): string => {
  const parts = [
    row.item.nameEn,
    row.item.nameJa,
    row.item.setId,
    row.item.number,
    row.item.cardId,
    row.item.rarity,
    row.item.notes,
    row.item.hint?.setName,
    row.item.hint?.setCode,
  ].filter(Boolean);

  // Both forms, so a query with spaces and a query without both work.
  return `${parts.join(' ').toLowerCase()} ${flatten(parts.join(''))}`;
};

export function apply(rows: Valued[], filters: Filters): Valued[] {
  const query = filters.text.trim().toLowerCase();
  const flat = flatten(filters.text);

  return rows.filter((row) => {
    if (query) {
      const haystack = searchable(row);
      if (!haystack.includes(query) && !haystack.includes(flat)) return false;
    }
    if (filters.setId && row.item.setId !== filters.setId) return false;
    if (filters.condition && row.item.condition !== filters.condition) return false;
    if (filters.onlyPending && row.item.status !== 'pending') return false;
    if (filters.from && row.item.purchase.date < filters.from) return false;
    if (filters.to && row.item.purchase.date > filters.to) return false;
    if (filters.onlyGainers && !(row.gain !== null && row.gain > 0)) return false;
    if (filters.onlyLosers && !(row.gain !== null && row.gain < 0)) return false;
    return true;
  });
}

/** Unpriced cards sort last on value-like keys: absent is not the same as zero. */
export function sort(rows: Valued[], key: SortKey, descending: boolean): Valued[] {
  const direction = descending ? -1 : 1;

  const compare = (a: Valued, b: Valued): number => {
    switch (key) {
      case 'name':
        return (a.item.nameEn ?? a.item.nameJa ?? '').localeCompare(b.item.nameEn ?? b.item.nameJa ?? '');
      case 'set':
        return `${a.item.setId}${a.item.number}`.localeCompare(`${b.item.setId}${b.item.number}`);
      case 'date':
        return a.item.purchase.date.localeCompare(b.item.purchase.date);
      case 'paid':
        return a.paid - b.paid;
      default: {
        const left = a[key];
        const right = b[key];
        if (left === null && right === null) return 0;
        if (left === null) return 1 * direction;
        if (right === null) return -1 * direction;
        return left - right;
      }
    }
  };

  return [...rows].sort((a, b) => compare(a, b) * direction);
}

export const activeCount = (filters: Filters): number =>
  Object.entries(filters).filter(([key, value]) =>
    key === 'text' ? String(value).trim() !== '' : value !== '' && value !== false,
  ).length;
