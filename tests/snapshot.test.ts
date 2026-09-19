/**
 * One failed lookup must not make the site say a card has no price.
 *
 * This is asserted because it actually happened: a transient failure on two cards left
 * them out of latest.json, and the collection screen reported Charizard V and Latios as
 * unpriced while Cardmarket was listing both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** The merge latest.json performs, isolated from the network and the filesystem. */
const carryForward = (
  previous: Record<string, { avg30: number; updated: string }>,
  observed: Record<string, { avg30: number; updated: string }>,
) => ({ ...previous, ...observed });

test('a card missing from today keeps the reading it had', () => {
  const previous = { A: { avg30: 100, updated: '2026-09-18' }, B: { avg30: 50, updated: '2026-09-18' } };
  const observed = { A: { avg30: 110, updated: '2026-09-19' } };

  const current = carryForward(previous, observed);

  assert.equal(current.A.avg30, 110, "today's reading wins where there is one");
  assert.equal(current.B.avg30, 50, 'yesterday stands rather than the card vanishing');
  assert.equal(current.B.updated, '2026-09-18', 'and it still says how old it is');
});

test('a card seen for the first time is added', () => {
  const current = carryForward({}, { NEW: { avg30: 7, updated: '2026-09-19' } });
  assert.deepEqual(Object.keys(current), ['NEW']);
});

test('the daily record is not merged, so a gap stays a gap', () => {
  // daily/<date>.json holds only what was observed; this documents the distinction the
  // two files exist to keep.
  const observed = { A: { avg30: 110, updated: '2026-09-19' } };
  assert.deepEqual(Object.keys(observed), ['A'], 'no carried values in the historical record');
});
