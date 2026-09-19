import { test } from 'node:test';
import assert from 'node:assert/strict';
import { value, totals } from '../src/personal/lib/money.ts';
import type { CollectionItem, PriceSnapshot } from '../src/personal/lib/types.ts';

const card = (over: Partial<CollectionItem> = {}): CollectionItem => ({
  id: 'itm_0001',
  status: 'resolved',
  cardId: 'S12a-261',
  condition: 'NM',
  isGraded: false,
  quantity: 1,
  purchase: {
    date: '2026-01-01',
    amount: 140,
    currency: 'EUR',
    amountEur: 140,
    fxRate: 1,
    fxSource: 'identity',
  },
  ...over,
});

const snapshot = (prices: Record<string, number | null>): PriceSnapshot => ({
  version: 1,
  date: '2026-09-19',
  generatedAt: '2026-09-19T06:20:00.000Z',
  prices: Object.fromEntries(
    Object.entries(prices).map(([id, avg30]) => [
      id,
      { source: 'cardmarket/tcgdex' as const, currency: 'EUR' as const, updated: null, avg30, trend: null, low: null },
    ]),
  ),
});

test('a priced card reports gain against what was paid', () => {
  const row = value(card(), snapshot({ 'S12a-261': 252.58 }));
  assert.equal(row.paid, 140);
  assert.equal(row.value, 252.58);
  assert.equal(row.gain, 112.58);
  assert.ok(Math.abs((row.ratio ?? 0) - 0.8041) < 0.001);
});

test('quantity multiplies both sides, not just one', () => {
  const row = value(card({ quantity: 3 }), snapshot({ 'S12a-261': 100 }));
  assert.equal(row.paid, 420);
  assert.equal(row.value, 300);
  assert.equal(row.gain, -120);
});

test('a card with no price is null, never zero', () => {
  const row = value(card(), snapshot({}));
  assert.equal(row.value, null);
  assert.equal(row.gain, null, 'a missing price must not read as a total loss');
  assert.equal(row.ratio, null);
  assert.equal(row.paid, 140, 'what was paid is still known');
});

test('totals leave unpriced cards out of the value and out of the ratio basis', () => {
  const rows = [
    value(card({ id: 'itm_0001', cardId: 'A' }), snapshot({ A: 200 })),
    value(card({ id: 'itm_0002', cardId: 'B' }), snapshot({ A: 200 })),
  ];
  const figures = totals(rows);

  assert.equal(figures.cards, 2);
  assert.equal(figures.paid, 280, 'the paid total covers everything owned');
  assert.equal(figures.valued, 200, 'only the priced card contributes value');
  assert.equal(figures.unpriced, 1);
  assert.equal(figures.gain, 60, 'gain compares 200 against the 140 paid for that card alone');
  assert.ok(Math.abs((figures.ratio ?? 0) - 0.4286) < 0.001);
});

test('an empty collection has no ratio rather than a ratio of zero', () => {
  const figures = totals([]);
  assert.equal(figures.cards, 0);
  assert.equal(figures.ratio, null);
});

test('a set of cards with no prices has no value, which is not a value of zero', () => {
  const rows = [value(card({ cardId: 'X' }), snapshot({}))];
  const figures = totals(rows);

  assert.equal(figures.valued, 0);
  assert.equal(figures.unpriced, 1);
  assert.equal(figures.ratio, null, 'no basis to compare against, so no percentage');
  // The screen reads this pair to decide between a figure and a dash.
  assert.ok(figures.ratio === null && figures.valued === 0, 'the two together mean "unknown", not "worthless"');
});

test('the 7-day average stands in when there is no 30-day one, and says so', async () => {
  const { quote } = await import('../src/personal/lib/money.ts');

  assert.deepEqual(
    quote({ source: 'cardmarket/tcgdex', currency: 'EUR', updated: null, avg30: 41.82, avg7: 48.19, trend: null, low: null }),
    { value: 41.82, basis: 'avg30' },
  );
  assert.deepEqual(
    quote({ source: 'cardmarket/tcgdex', currency: 'EUR', updated: null, avg30: null, avg7: 48.19, trend: null, low: null }),
    { value: 48.19, basis: 'avg7' },
    'a card too new for a 30-day average still gets a figure, labelled',
  );
  assert.equal(
    quote({ source: 'cardmarket/tcgdex', currency: 'EUR', updated: null, avg30: null, avg7: null, trend: 12, low: 3 }),
    null,
    'trend and low are never used as a valuation',
  );
});
