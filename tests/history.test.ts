/**
 * Bucketing, and the one rule that decides whether the collection line exists at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGES, cardSeries, daysNeeded, holdingsSeries, type HistorySource } from '../src/personal/lib/history.ts';
import type { PriceSnapshot } from '../src/personal/lib/types.ts';

const range = (key: string) => RANGES.find((entry) => entry.key === key)!;

const day = (date: string, value: number): PriceSnapshot => ({
  version: 1,
  date,
  generatedAt: `${date}T06:20:00.000Z`,
  prices: {
    A: { source: 'cardmarket/tcgdex', currency: 'EUR', updated: null, avg30: value, trend: null, low: null },
  },
});

function source(): HistorySource {
  const days = ['2026-09-17', '2026-09-18', '2026-09-19'];
  return {
    index: { days, firstDay: days[0], lastDay: days.at(-1) ?? null },
    rollups: {
      weekly: { A: [{ period: '2026-W38', value: 20, days: 3 }] },
      monthly: {
        A: [
          { period: '2026-08', value: 10, days: 31 },
          { period: '2026-09', value: 20, days: 19 },
        ],
      },
    },
    daily: new Map(days.map((date, index) => [date, day(date, 10 + index)])),
  };
}

test('a week asks for days, a month asks for none because weeks are pre-rolled', () => {
  const history = source();
  assert.deepEqual(daysNeeded(history, range('1w')), ['2026-09-17', '2026-09-18', '2026-09-19']);
  assert.deepEqual(daysNeeded(history, range('1m')), [], 'weekly buckets come from the rollup file');
  assert.deepEqual(daysNeeded(history, range('1y')), []);
});

test('each range reads the resolution it was defined with', () => {
  const history = source();
  assert.deepEqual(
    cardSeries(history, 'A', range('1w')).map((point) => point.value),
    [10, 11, 12],
    'daily',
  );
  assert.deepEqual(cardSeries(history, 'A', range('1m')).map((p) => p.period), ['2026-W38'], 'weekly');
  assert.equal(cardSeries(history, 'A', range('all')).length, 2, 'monthly, everything');
});

test('a range excludes periods older than its window', () => {
  const history = source();
  const sixMonths = cardSeries(history, 'A', range('6m')).map((point) => point.period);
  assert.ok(sixMonths.includes('2026-09'));
  assert.equal(cardSeries(history, 'A', range('1y')).length, 2, 'a year reaches back past August');
});

test('a card counts only from when it was bought', () => {
  const history = source();
  const points = holdingsSeries(history, [{ cardId: 'A', quantity: 1, boughtOn: '2026-09-18' }], range('1w'));
  assert.deepEqual(points.map((p) => p.period), ['2026-09-18', '2026-09-19'], 'nothing before the purchase');
});

test('a placeholder purchase date counts throughout, because it means unknown', () => {
  // Every imported card carries the bootstrap date. Reading those as acquisitions would
  // start the whole collection on the day the tracker did and flatten all earlier
  // readings to zero — a chart of the tool's age, not the collection's value.
  const history = source();
  const points = holdingsSeries(
    history,
    [{ cardId: 'A', quantity: 2, boughtOn: '2026-09-19', dateIsBootstrap: true }],
    range('1w'),
  );
  assert.deepEqual(points.map((p) => p.period), ['2026-09-17', '2026-09-18', '2026-09-19']);
  assert.deepEqual(points.map((p) => p.value), [20, 22, 24], 'quantity multiplies each reading');
});
