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

test('which figure a card is valued at, and what it admits to using', async () => {
  const { quote } = await import('../src/personal/lib/money.ts');
  const priced = (over: Record<string, unknown>) => ({
    source: 'cardmarket/tcgdex' as const,
    currency: 'EUR' as const,
    updated: null,
    avg30: null,
    avg7: null,
    trend: null,
    low: null,
    ...over,
  });

  // Asking for a 30-day average gets one, hand-read where there is one.
  assert.deepEqual(
    quote(priced({ source: 'cardmarket/manual', avg30: 41.82, trend: 39 }), 'avg30'),
    { value: 41.82, basis: 'avg30', handRead: true },
  );

  // And the catalog's where there is not — stale, but still the measure that was asked
  // for. Substituting trend here was tried and measured worse: against Cardmarket's real
  // avg30 the stale average was 0.5% out where the trend was 9.9% out.
  assert.deepEqual(
    quote(priced({ avg30: 399.08, trend: 357.63 }), 'avg30'),
    { value: 399.08, basis: 'avg30', handRead: false },
    'a stale 30-day average beats a live figure that measures something else',
  );

  // Asking for trend gets trend, whatever averages exist. It is marked hand-read for the
  // same reason the averages are: a person read it off the page.
  assert.deepEqual(
    quote(priced({ source: 'cardmarket/manual', avg30: 41.82, trend: 39 }), 'trend'),
    { value: 39, basis: 'trend', handRead: true },
  );

  // No average at all: trend rather than nothing, and labelled.
  assert.deepEqual(quote(priced({ trend: 12 }), 'avg30'), { value: 12, basis: 'trend', handRead: false });

  // A card too new for either still gets a figure.
  assert.deepEqual(quote(priced({ avg7: 48.19 }), 'avg30'), { value: 48.19, basis: 'avg7', handRead: false });

  // A one-day average is a measure in its own right, and the nearest window stands in
  // for it when a quiet card had no sale that day.
  assert.deepEqual(quote(priced({ avg1: 9.24, avg7: 10.29 }), 'avg1'), { value: 9.24, basis: 'avg1', handRead: false });
  assert.deepEqual(quote(priced({ avg7: 10.29, avg30: 11 }), 'avg1'), { value: 10.29, basis: 'avg7', handRead: false });

  // `low` is the cheapest listing in any condition, so it is never a valuation.
  assert.equal(quote(priced({ low: 3 }), 'avg30'), null, 'low is never used as a valuation');
  assert.equal(quote(undefined, 'avg30'), null);
});
test('a card with no usable figure is described as having no price, not as an average', async () => {
  const { basisLabel } = await import('../src/personal/lib/money.ts');

  // `value()` returns basis: null for a card the market has not priced. Describing that
  // as "30-day average" would put a source on a number that does not exist — and the
  // detail panel does call this whenever a price record exists, even an empty one.
  assert.equal(basisLabel({ basis: null }), 'no price');
  assert.equal(basisLabel(null), 'no price');

  assert.equal(basisLabel({ basis: 'avg30', handRead: true }), '30-day average, read by hand');
  assert.equal(basisLabel({ basis: 'avg30' }), '30-day average, catalog — may be behind');
  assert.equal(basisLabel({ basis: 'trend' }), 'price trend');

  // Every window is described the same way, and each one carries the same warning about
  // where it came from: the catalog's averages are all frozen together, not just avg30.
  assert.equal(basisLabel({ basis: 'avg7' }), '7-day average, catalog — may be behind');
  assert.equal(basisLabel({ basis: 'avg1', handRead: true }), '1-day average, read by hand');
});

test('a price typed in a shop is read the way it was meant', async () => {
  const { parseAmount } = await import('../src/personal/lib/money.ts');

  // Plain numbers, and the separators a Japanese price tag and an Italian keyboard use.
  assert.equal(parseAmount('1200'), 1200);
  assert.equal(parseAmount('1.200'), 1200, 'a dot before three digits is a thousands separator');
  assert.equal(parseAmount('1,200'), 1200);
  assert.equal(parseAmount('1 200'), 1200);
  assert.equal(parseAmount('12,50'), 12.5, 'a comma before two digits is the decimal point');
  assert.equal(parseAmount('12.50'), 12.5);
  assert.equal(parseAmount('¥1,200'), 1200, 'a currency symbol pasted in with it');
  assert.equal(parseAmount(' 8.30 € '), 8.3);
  assert.equal(parseAmount('1.234,56'), 1234.56, 'both separators, Italian style');

  // A price that is not a price. Guessing here writes a wrong purchase into the ledger.
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('   '), null);
  assert.equal(parseAmount('free'), null);
  assert.equal(parseAmount('0'), null, 'nothing was bought for nothing');
  assert.equal(parseAmount('-5'), null);
});
