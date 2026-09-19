import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, sort, emptyFilters } from '../src/personal/lib/filters.ts';
import type { Valued } from '../src/personal/lib/money.ts';

const row = (over: { id: string; nameEn?: string; nameJa?: string; setId?: string; date?: string; gain?: number | null; value?: number | null; status?: 'resolved' | 'pending' }): Valued =>
  ({
    item: {
      id: over.id,
      status: over.status ?? 'resolved',
      nameEn: over.nameEn,
      nameJa: over.nameJa,
      setId: over.setId ?? 'S12a',
      number: '261',
      condition: 'NM',
      isGraded: false,
      quantity: 1,
      purchase: { date: over.date ?? '2026-01-01', amount: 10, currency: 'EUR', amountEur: 10, fxRate: 1, fxSource: 'identity' },
    },
    value: over.value === undefined ? 20 : over.value,
    paid: 10,
    gain: over.gain === undefined ? 10 : over.gain,
    ratio: 1,
  }) as Valued;

test('search matches the Japanese name as well as the English one', () => {
  const rows = [row({ id: 'a', nameEn: 'Giratina VSTAR', nameJa: 'ギラティナVSTAR' })];
  assert.equal(apply(rows, { ...emptyFilters, text: 'giratina' }).length, 1);
  assert.equal(apply(rows, { ...emptyFilters, text: 'ギラティナ' }).length, 1);
  assert.equal(apply(rows, { ...emptyFilters, text: 'charizard' }).length, 0);
});

test('the date range includes both ends', () => {
  const rows = [
    row({ id: 'a', date: '2026-10-01' }),
    row({ id: 'b', date: '2026-10-15' }),
    row({ id: 'c', date: '2026-10-31' }),
  ];
  const inWindow = apply(rows, { ...emptyFilters, from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(inWindow.map((entry) => entry.item.id), ['a', 'b', 'c']);
});

test('gainers and losers both exclude cards with no price', () => {
  const rows = [
    row({ id: 'up', gain: 5 }),
    row({ id: 'down', gain: -5 }),
    row({ id: 'unpriced', gain: null, value: null }),
  ];
  assert.deepEqual(apply(rows, { ...emptyFilters, onlyGainers: true }).map((e) => e.item.id), ['up']);
  assert.deepEqual(apply(rows, { ...emptyFilters, onlyLosers: true }).map((e) => e.item.id), ['down']);
});

test('unpriced cards sort last whichever way the column is pointing', () => {
  const rows = [
    row({ id: 'cheap', value: 5 }),
    row({ id: 'unpriced', value: null, gain: null }),
    row({ id: 'dear', value: 500 }),
  ];

  assert.deepEqual(
    sort(rows, 'value', true).map((entry) => entry.item.id),
    ['dear', 'cheap', 'unpriced'],
    'descending: the most valuable first, unknown last',
  );
  assert.deepEqual(
    sort(rows, 'value', false).map((entry) => entry.item.id),
    ['cheap', 'dear', 'unpriced'],
    'ascending: unknown is still last, because absent is not cheap',
  );
});
