/**
 * The "ask them first" marker on a friend's wanted card.
 *
 * A card in a shop in Japan is a decision made in a minute. The marker exists so the
 * question "does this one need a message before I buy it?" is answered on the card
 * rather than from memory, so the two ways it could mislead are both worth a test: a
 * marker on my own list, where there is nobody to ask, and a marker still showing on a
 * card that has already been bought.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowContact } from '../src/personal/views/wishlists.ts';
import { OWN_LIST, type WishlistItem } from '../src/personal/lib/types.ts';

const card = (over: Partial<WishlistItem> = {}): WishlistItem => ({
  id: 'wish_0001',
  status: 'wanted',
  targetPriceEur: 10,
  priority: 'normal',
  addedAt: '2026-09-30',
  ...over,
});

test('a friend’s card marked for contact says so', () => {
  assert.equal(shouldShowContact(card({ shouldContactOwner: true }), 'tommy'), true);
});

test('an unmarked card stays quiet, which is every card by default', () => {
  assert.equal(shouldShowContact(card(), 'tommy'), false);
  assert.equal(shouldShowContact(card({ shouldContactOwner: false }), 'tommy'), false);
});

test('my own list never asks me to contact anyone', () => {
  assert.equal(shouldShowContact(card({ shouldContactOwner: true }), OWN_LIST), false);
});

test('a bought card drops the marker, because the question has been answered', () => {
  const bought = card({
    shouldContactOwner: true,
    status: 'bought',
    boughtAt: '2026-10-05',
    purchase: {
      date: '2026-10-05',
      amount: 4000,
      currency: 'JPY',
      amountEur: 23.5,
      fxRate: 170.2,
      fxSource: 'frankfurter',
    },
  });
  assert.equal(shouldShowContact(bought, 'tommy'), false);
});
