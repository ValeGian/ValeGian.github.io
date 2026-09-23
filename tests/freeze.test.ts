/**
 * Telling a dead price feed from one that is merely not refreshed today.
 *
 * This test exists because the first version of the detector could not, and said the
 * feed was dead on every day that was not a Monday: it opened an issue saying so, and
 * put 72 of 73 cards into the hand-reading queue. Cardmarket's averages move about once
 * a week, so a run of identical days is the ordinary midweek state of every card.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CADENCE_DAYS, frozenVerdict, comparableCards, unmovedAcross } from '../scripts/lib/freeze.mjs';

const card = (avg30: number, trend: number, source = 'cardmarket/tcgdex') => ({
  source,
  avg30,
  avg7: avg30,
  avg1: avg30,
  trend,
  low: trend,
});

/** `days` readings of twelve cards; `refreshOn` is the index where the averages move. */
const window = (days: number, refreshOn?: number) =>
  Array.from({ length: days }, (_, day) =>
    Object.fromEntries(
      Array.from({ length: 12 }, (_, n) => [
        `C-${n}`,
        // trend moves every day whatever happens, as it does upstream.
        card(refreshOn !== undefined && day >= refreshOn ? 110 + n : 100 + n, 90 + n + day),
      ]),
    ),
  );

test('a week of unchanged averages says nothing, because that is the cadence', () => {
  assert.equal(frozenVerdict(window(7)), null);
});

test('a window shorter than one refresh cycle says nothing at all', () => {
  // With less history than a cycle, "unchanged" and "not yet refreshed" look identical,
  // and guessing between them is what went wrong the first time.
  assert.equal(frozenVerdict(window(CADENCE_DAYS)), null, 'exactly a cycle is still not enough');
});

test('longer than a cycle with no movement is worth reporting', () => {
  const verdict = frozenVerdict(window(CADENCE_DAYS + 1));

  assert.ok(verdict, 'this is the case the detector exists for');
  assert.equal(verdict.shared, 12);
  assert.equal(verdict.averages, 12);
  assert.equal(verdict.spot, 0, 'trend moved every day, so the feed itself is alive');
});

test('a refresh inside the window clears it, wherever it falls', () => {
  for (const day of [1, 5, CADENCE_DAYS]) {
    assert.equal(frozenVerdict(window(CADENCE_DAYS + 1, day)), null, `refresh on day ${day}`);
  }
});

test('a hand-read day is left out rather than counted as movement', () => {
  const readings = window(CADENCE_DAYS + 1);
  readings[3]['C-0'] = card(100, 93, 'cardmarket/manual');

  assert.equal(comparableCards(readings).includes('C-0'), false);
  assert.equal(frozenVerdict(readings)?.shared, 11, 'the other eleven are still judged');
});

test('too few cards to take a share of is not a verdict', () => {
  const readings = window(CADENCE_DAYS + 1).map((day) => ({ 'C-0': day['C-0'], 'C-1': day['C-1'] }));

  assert.equal(frozenVerdict(readings), null);
});

test('unmovedAcross looks at every day, not just the ends', () => {
  const readings = window(5);
  readings[2]['C-0'] = card(999, 95);

  assert.equal(unmovedAcross(readings, ['C-0'], ['avg30']).length, 0, 'a blip in the middle is movement');
});
