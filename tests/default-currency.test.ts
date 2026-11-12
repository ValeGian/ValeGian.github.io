/**
 * Which currency a blank price is in.
 *
 * Adding a card and marking one bought both start from DEFAULT_CURRENCY. A form that
 * silently started in yen would record a euro price typed into it as yen, a difference of
 * two orders of magnitude, so the default is pinned here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankFields } from '../src/personal/views/add-card.ts';
import { blankBuy } from '../src/personal/views/wishlists.ts';
import { DEFAULT_CURRENCY } from '../src/personal/lib/types.ts';

test('a new price is in euros unless another currency is chosen', () => {
  assert.equal(DEFAULT_CURRENCY, 'EUR');
});

test('a blank add-card form starts in the default currency', () => {
  assert.equal(blankFields().currency, DEFAULT_CURRENCY);
});

test('marking a card bought starts in the default currency, with no amount', () => {
  assert.deepEqual(blankBuy('tommy', 'wish_0010'), {
    owner: 'tommy',
    itemId: 'wish_0010',
    amount: '',
    currency: DEFAULT_CURRENCY,
  });
});
