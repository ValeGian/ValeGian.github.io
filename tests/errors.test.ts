/**
 * What a person is told when adding a card fails.
 *
 * The distinction being tested is the one that matters on the form: a connection that
 * dropped is worth another tap, or the card can be typed in by hand, while a card the
 * catalog does not have is a fact that has to reach the screen unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveErrorMessage } from '../src/personal/lib/errors.ts';

test('a dropped connection is explained, whichever browser phrased it', () => {
  for (const wording of [
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'Network request failed',
  ]) {
    const message = saveErrorMessage(new TypeError(wording));

    assert.match(message, /Could not reach the catalog/);
    assert.match(message, /Not in the catalog yet/, 'and says how to record the card anyway');
  }
});

test('a server having a moment reads the same way, the retry having already failed', () => {
  assert.match(saveErrorMessage(new Error('Could not load SV2a-201 (503)')), /Could not reach the catalog/);
  assert.match(saveErrorMessage(new Error('Could not load SV2a-201 (429)')), /Could not reach the catalog/);
});

test('a card the catalog does not have says exactly that', () => {
  const message = saveErrorMessage(new Error('Could not load M6a-105 (404)'));

  assert.equal(message, 'Could not load M6a-105 (404)', 'rewording this would hide which card and why');
});

test('a failure that is not a request at all is passed through', () => {
  assert.equal(saveErrorMessage(new Error('A target price has to be a number.')), 'A target price has to be a number.');
  assert.equal(saveErrorMessage('something threw a string'), 'something threw a string');
});
