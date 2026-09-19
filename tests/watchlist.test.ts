/**
 * The watchlist is published on a public site, so what it must NOT contain matters more
 * than what it does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicFiles } from '../src/lib/watchlist.mjs';

const at = '2026-09-19T00:00:00.000Z';

const owned = (over = {}) => ({
  id: 'itm_0001',
  status: 'resolved',
  cardId: 'S12a-261',
  variantId: 'v1',
  purchase: { amountEur: 140 },
  ...over,
});

test('a card without a priced variant is left out rather than guessed at', () => {
  const { watchlist, skipped } = derivePublicFiles({
    collection: { items: [owned({ variantId: undefined })] },
    wishlists: [],
    manualCardIds: [],
    now: at,
  });
  assert.equal(watchlist.cards.length, 0);
  assert.match(skipped[0], /no priced variant/);
});

test('a hand-priced card is left to its override', () => {
  const { watchlist, skipped } = derivePublicFiles({
    collection: { items: [owned({ cardId: 'CLK-001' })] },
    wishlists: [],
    manualCardIds: ['CLK-001'],
    now: at,
  });
  assert.equal(watchlist.cards.length, 0);
  assert.match(skipped[0], /priced manually/);
});

test('wanted cards are priced too, or a target has nothing to compare against', () => {
  const { watchlist } = derivePublicFiles({
    collection: { items: [owned()] },
    wishlists: [{ items: [{ cardId: 'M6-113', status: 'wanted', targetPriceEur: 700 }] }],
    manualCardIds: [],
    now: at,
  });
  assert.deepEqual(watchlist.cards.map((card) => card.cardId).sort(), ['M6-113', 'S12a-261']);
});

test('a card already bought for someone is not still being shopped for', () => {
  const { watchlist } = derivePublicFiles({
    collection: { items: [] },
    wishlists: [{ items: [{ cardId: 'M6-113', status: 'bought', purchase: { amountEur: 287.6 } }] }],
    manualCardIds: [],
    now: at,
  });
  assert.equal(watchlist.cards.length, 0);
});

test('pending cards go to the retry list, not the price list', () => {
  const { watchlist, pending } = derivePublicFiles({
    collection: {
      items: [{ id: 'itm_0009', status: 'pending', hint: { setCode: 'M6a', number: '045' }, pendingSince: '2026-10-14' }],
    },
    wishlists: [],
    manualCardIds: [],
    now: at,
  });
  assert.equal(watchlist.cards.length, 0);
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0].hint.setCode, 'M6a');
});

test('neither file carries an owner, a price paid or a target', () => {
  const { watchlist, pending } = derivePublicFiles({
    collection: { items: [owned(), { id: 'itm_0009', status: 'pending', hint: { setCode: 'M6a', number: '045' }, pendingSince: '2026-10-14' }] },
    wishlists: [{ owner: 'Tommy', items: [{ cardId: 'M6-113', status: 'wanted', targetPriceEur: 700, notes: 'centred only' }] }],
    manualCardIds: [],
    now: at,
  });

  const published = JSON.stringify({ watchlist, pending });
  for (const secret of ['amountEur', '140', 'targetPriceEur', '700', 'Tommy', 'centred only', 'purchase']) {
    assert.ok(!published.includes(secret), `the published files must not carry ${secret}`);
  }
});
