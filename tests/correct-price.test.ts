/**
 * The form that corrects what a friend's card cost.
 *
 * Two things are worth pinning down. The button appears only where there is a price to
 * correct and someone allowed to correct it. The note under the amount says what will
 * actually be recorded, because the euro figure is what the friend is asked to pay.
 * Removing a bought card changes the same figure, so its button names the amount too, and
 * a bought tile in the grid leads with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCorrectPrice, recordingNote, removalLabels, tileLeadFigure } from '../src/personal/views/wishlists.ts';
import { money } from '../src/personal/lib/money.ts';
import type { Purchase, WishlistItem } from '../src/personal/lib/types.ts';

const paid: Purchase = {
  date: '2026-10-14',
  amount: 1200,
  currency: 'JPY',
  amountEur: 6.72,
  fxRate: 0.0056,
  fxSource: 'frankfurter',
};

const card = (over: Partial<WishlistItem> = {}): WishlistItem => ({
  id: 'wish_0010',
  status: 'bought',
  targetPriceEur: 10,
  priority: 'normal',
  addedAt: '2026-09-30',
  boughtAt: '2026-10-14',
  purchase: paid,
  ...over,
});

test('a bought card can have its price corrected', () => {
  assert.equal(canCorrectPrice(card(), true), true);
});

test('a wanted card offers no price to correct', () => {
  assert.equal(canCorrectPrice(card({ status: 'wanted', purchase: undefined, boughtAt: undefined }), true), false);
});

test('a friend looking at their own list cannot change what they owe', () => {
  assert.equal(canCorrectPrice(card(), false), false);
});

test('the same currency shows the euro figure at the rate on record', () => {
  assert.equal(recordingNote(1500, 'JPY', paid), `Recording 1,500 JPY, at the rate on record: ${money(8.4)}.`);
});

test('a change of currency says which day its rate comes from', () => {
  assert.equal(recordingNote(9, 'USD', paid), 'Recording 9 USD, converted at the rate on the day it was bought.');
});

test('a correction in euros needs no conversion to explain', () => {
  assert.equal(recordingNote(7.5, 'EUR', paid), `Recording ${money(7.5)}.`);
});

test('a new purchase is still converted at today’s rate', () => {
  assert.equal(recordingNote(1200, 'JPY'), "Recording 1,200 JPY, converted at today's rate.");
});

test('removing a bought card says, before the second tap, how much less is owed', () => {
  const labels = removalLabels(card(), 'Pikachu', 'Tommy');

  assert.equal(labels.armedLabel, `Remove? −${money(6.72)}`);
  assert.equal(labels.title, `Remove Pikachu from this list. Tommy will owe ${money(6.72)} less.`);
});

test('removing a wanted card mentions no money, because none is owed for it', () => {
  const labels = removalLabels(card({ status: 'wanted', purchase: undefined, boughtAt: undefined }), 'Pikachu', 'Tommy');

  assert.deepEqual(labels, { armedLabel: 'Remove?', title: 'Remove Pikachu from this list' });
});

test('a bought tile leads with what it was bought for, not the target', () => {
  const lead = tileLeadFigure(card());

  assert.equal(lead.text, money(6.72));
  assert.equal(lead.className, 'paid-price numeric');
});

test('a bought tile with no price on record says so rather than showing the target', () => {
  assert.equal(tileLeadFigure(card({ purchase: undefined })).text, 'paid —');
});

test('a wanted tile still leads with its target', () => {
  const wanted = card({ status: 'wanted', purchase: undefined, boughtAt: undefined });

  assert.deepEqual(tileLeadFigure(wanted), { text: money(10), className: 'target-price numeric', title: 'Target price' });
  assert.equal(tileLeadFigure({ ...wanted, targetPriceEur: null }).text, 'any price');
});
