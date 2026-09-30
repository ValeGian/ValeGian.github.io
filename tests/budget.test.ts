/**
 * What a wishlist would cost at the prices its cards are wanted at.
 *
 * The figure a person reads before walking into a shop, so the two things that must not
 * happen are a card with no target being counted as free, and a bought card still being
 * counted as something to pay for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { targetBudget } from '../src/personal/views/wishlists.ts';
import type { WishlistItem } from '../src/personal/lib/types.ts';

const card = (over: Partial<WishlistItem> = {}): WishlistItem => ({
  id: 'wish_0001',
  status: 'wanted',
  targetPriceEur: 10,
  priority: 'normal',
  addedAt: '2026-09-30',
  ...over,
});

test('the budget is the sum of the targets', () => {
  const budget = targetBudget([card({ targetPriceEur: 5 }), card({ targetPriceEur: 145 }), card({ targetPriceEur: 2.5 })]);

  assert.equal(budget.total, 152.5);
  assert.equal(budget.priced, 3);
  assert.equal(budget.open, 0);
});

test('a card wanted at any price is counted apart, never as zero', () => {
  // Treating "any price" as free would understate the budget by exactly the cards most
  // likely to be expensive.
  const budget = targetBudget([card({ targetPriceEur: 40 }), card({ targetPriceEur: null }), card({ targetPriceEur: null })]);

  assert.equal(budget.total, 40);
  assert.equal(budget.priced, 1);
  assert.equal(budget.open, 2, 'and the screen says how many are unpriced');
});

test('a card already bought is not still to pay for', () => {
  const budget = targetBudget([
    card({ targetPriceEur: 30 }),
    card({ status: 'bought', targetPriceEur: 999, purchase: { date: '2026-09-01', amount: 1200, currency: 'JPY', amountEur: 6.6, fxRate: 0.0055, fxSource: 'frankfurter' } }),
  ]);

  assert.equal(budget.total, 30);
  assert.equal(budget.priced, 1);
});

test('the total is money, not a binary float', () => {
  // 0.1 + 0.2 is 0.30000000000000004, and a budget that reads like that is not a budget.
  const budget = targetBudget([card({ targetPriceEur: 0.1 }), card({ targetPriceEur: 0.2 })]);

  assert.equal(budget.total, 0.3);
});

test('an empty list costs nothing and says so without dividing by zero', () => {
  assert.deepEqual(targetBudget([]), { total: 0, priced: 0, open: 0 });
});
