/**
 * The guard that stops the daily job writing a day it only half-collected.
 *
 * The arithmetic used to be "every price I hold, minus the hand-priced overrides", which
 * agrees with the truth only when every override carries a price. One that did not was
 * subtracted although it had never been added, so a complete day could be reported as
 * short — and a genuinely short day is what makes the job refuse to write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchlistCoverage, isTooIncomplete } from '../scripts/lib/coverage.mjs';

const watchlist = { cards: [{ cardId: 'A' }, { cardId: 'B' }, { cardId: 'C' }, { cardId: 'D' }, { cardId: 'E' }] };

test('a full day counts every watched card and names nothing missing', () => {
  const coverage = watchlistCoverage(watchlist, { A: {}, B: {}, C: {}, D: {}, E: {} });

  assert.deepEqual(coverage, { expected: 5, got: 5, missing: [] });
  assert.equal(isTooIncomplete(coverage, 0.2), false);
});

test('hand-priced cards alongside the watchlist neither raise nor lower the count', () => {
  // Overrides are deliberately kept off the watchlist, so their prices sit in the same
  // object without being cards the catalog was asked about.
  const coverage = watchlistCoverage(watchlist, { A: {}, B: {}, C: {}, D: {}, E: {}, 'CLK-001': {}, 'PMCG1-014': {} });

  assert.equal(coverage.got, 5, 'a price for a card nobody watches is not coverage');
  assert.equal(isTooIncomplete(coverage, 0.2), false);
});

test('an override carrying no price does not make a complete day look short', () => {
  // The old arithmetic subtracted this entry although nothing was ever added for it.
  const coverage = watchlistCoverage(watchlist, { A: {}, B: {}, C: {}, D: {}, E: {} });

  assert.equal(coverage.got, 5);
});

test('a day that lost too many cards is refused, and says which', () => {
  const coverage = watchlistCoverage(watchlist, { A: {}, B: {} });

  assert.equal(coverage.got, 2);
  assert.deepEqual(coverage.missing, ['C', 'D', 'E']);
  assert.equal(isTooIncomplete(coverage, 0.2), true);
});

test('the threshold is a floor, not a range: exactly at the limit still writes', () => {
  const ten = { cards: Array.from({ length: 10 }, (_, index) => ({ cardId: `card-${index}` })) };
  const priced = Object.fromEntries(ten.cards.slice(0, 8).map((entry) => [entry.cardId, {}]));

  assert.equal(isTooIncomplete(watchlistCoverage(ten, priced), 0.2), false, '80% is allowed');
  delete priced['card-7'];
  assert.equal(isTooIncomplete(watchlistCoverage(ten, priced), 0.2), true, '70% is not');
});

test('an empty watchlist is not a failure', () => {
  assert.equal(isTooIncomplete(watchlistCoverage({ cards: [] }, {}), 0.2), false);
});
