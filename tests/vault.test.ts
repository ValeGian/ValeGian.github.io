/**
 * The rules that decide whose money is whose.
 *
 * A card bought for a friend is not an asset of mine, and a wanted card that I buy is.
 * Getting that backwards would misstate both the collection and what someone owes, so it
 * is asserted from both directions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt } from '../src/lib/crypto.mjs';
import { addCard, applyResolutions, buildWrites, deleteCard, markBought, newCardId, type Vault } from '../src/personal/lib/vault.ts';
import { totals, value } from '../src/personal/lib/money.ts';
import { balance } from '../src/personal/views/wishlists.ts';
import type { CollectionItem, Purchase, Wishlist } from '../src/personal/lib/types.ts';

const purchase = (amountEur: number): Purchase => ({
  date: '2026-10-14',
  amount: amountEur,
  currency: 'EUR',
  amountEur,
  fxRate: 1,
  fxSource: 'identity',
});

const wish = (id: string, over: Partial<Wishlist['items'][number]> = {}): Wishlist['items'][number] => ({
  id,
  status: 'wanted',
  cardId: 'M6-113',
  setId: 'M6',
  number: '113',
  nameJa: 'メガレックウザex',
  targetPriceEur: 700,
  priority: 'normal',
  addedAt: '2026-09-19',
  ...over,
});

async function makeVault(): Promise<Vault> {
  const keys = new Map<string, CryptoKey>();
  const envelopes = new Map<string, { v: 1 }>();

  for (const name of ['collection', 'valerio', 'tommy']) {
    const { envelope, key } = await encrypt('test', {});
    keys.set(name, key);
    envelopes.set(name, envelope as { v: 1 });
  }

  return {
    collection: { version: 1, items: [] },
    wishlists: {
      valerio: { owner: 'Valerio', items: [wish('wish_0001')], settlements: [] },
      tommy: { owner: 'Tommy', items: [wish('wish_0010')], settlements: [] },
    },
    keys,
    envelopes: envelopes as Vault['envelopes'],
    manualCardIds: [],
  };
}

test("a card bought for a friend stays on their list and never enters the collection", async () => {
  const vault = await makeVault();
  const result = await markBought(vault, 'tommy', 'wish_0010', purchase(287.6));

  assert.equal(result.addedToCollection, false);
  assert.equal(vault.collection.items.length, 0, "a friend's card is not one of my assets");

  const item = vault.wishlists.tommy.items[0];
  assert.equal(item.status, 'bought');
  assert.equal(item.purchase?.amountEur, 287.6);
  assert.equal(balance(vault.wishlists.tommy).owed, 287.6);
});

test('my own wanted card moves into the collection and leaves the wishlist', async () => {
  const vault = await makeVault();
  const result = await markBought(vault, 'valerio', 'wish_0001', purchase(650));

  assert.equal(result.addedToCollection, true);
  assert.equal(vault.wishlists.valerio.items.length, 0);
  assert.equal(vault.collection.items.length, 1);

  const card = vault.collection.items[0];
  assert.equal(card.cardId, 'M6-113');
  assert.equal(card.acquiredFrom, 'wish_0001', 'the link back to what I was willing to pay survives');
  assert.equal(card.purchase.amountEur, 650);
});

test("a friend's purchases stay out of my totals even when both lists are full", async () => {
  const vault = await makeVault();
  await markBought(vault, 'tommy', 'wish_0010', purchase(287.6));
  await markBought(vault, 'valerio', 'wish_0001', purchase(650));

  const figures = totals(vault.collection.items.map((item) => value(item, null)));
  assert.equal(figures.cards, 1);
  assert.equal(figures.paid, 650, "only my own purchase counts, not the 287.60 spent for Tommy");
});

test('settlements reduce what is owed, and the balance is derived not stored', async () => {
  const vault = await makeVault();
  await markBought(vault, 'tommy', 'wish_0010', purchase(300));
  vault.wishlists.tommy.settlements.push({ date: '2026-11-02', amountEur: 120 });

  const figures = balance(vault.wishlists.tommy);
  assert.equal(figures.bought, 300);
  assert.equal(figures.settled, 120);
  assert.equal(figures.owed, 180);
});

test('ids do not collide after a deletion', async () => {
  const vault = await makeVault();
  const card = (id: string): CollectionItem => ({
    id,
    status: 'resolved',
    cardId: 'S12a-261',
    condition: 'NM',
    isGraded: false,
    quantity: 1,
    purchase: purchase(10),
  });

  await addCard(vault, card(newCardId(vault)));
  await addCard(vault, card(newCardId(vault)));
  await deleteCard(vault, 'itm_0001');

  assert.equal(newCardId(vault), 'itm_0003', 'the next id continues past the highest ever used');
});

test('a save rewrites the touched file and always the derived public files', async () => {
  const vault = await makeVault();
  const writes = await buildWrites(vault, ['collection']);
  const paths = writes.map((write) => write.path);

  assert.deepEqual(paths, [
    'public/data/personal/collection.enc',
    'public/data/watchlist.json',
    'public/data/pending.json',
  ]);

  const untouched = writes.find((write) => write.path.includes('tommy'));
  assert.equal(untouched, undefined, 'a file that did not change is not rewritten');

  const watchlist = JSON.parse(writes[1].content);
  const serialised = JSON.stringify(watchlist);
  for (const leak of ['amountEur', 'targetPriceEur', 'owner', 'purchase']) {
    assert.ok(!serialised.includes(leak), `the public watchlist must not carry ${leak}`);
  }
});

test('a wanted card the catalog has caught up with drops its English stand-in', async () => {
  const vault = await makeVault();
  vault.wishlists.tommy.items = [
    wish('wish_0007', {
      cardId: undefined,
      setId: 'M6a',
      number: '045',
      nameJa: undefined,
      nameEn: 'Pikachu',
      imageBase: 'https://assets.tcgdex.net/en/me/30th/045',
      hint: { setCode: 'M6a', setName: '30th Anniversary', number: '045', nameEn: 'Pikachu' },
      pendingSince: '2026-09-20',
    }),
  ];

  const writes = await applyResolutions(vault, [
    {
      id: 'tommy/wish_0007',
      cardId: 'M6a-045',
      setId: 'M6a',
      number: '045',
      nameJa: 'ピカチュウ',
      imageBase: 'https://assets.tcgdex.net/ja/me/M6a/045',
      resolvedOn: '2026-11-02',
    },
  ]);

  const item = vault.wishlists.tommy.items[0];
  assert.equal(item.cardId, 'M6a-045', 'without a card id it can never be priced');
  assert.equal(item.nameJa, 'ピカチュウ');
  assert.equal(item.imageBase, 'https://assets.tcgdex.net/ja/me/M6a/045', 'the English artwork must not survive');
  assert.equal(item.nameEn, undefined, 'the English name was a stand-in, not a translation');
  assert.equal(item.pendingSince, undefined);
  assert.ok(item.hint, 'the hint is what was read off the card and is kept');

  assert.ok(
    writes?.some((write) => write.path.endsWith('personal/tommy.enc')),
    "the resolved list has to be written, or the fix is lost on reload",
  );
});

test('a resolution for one list leaves the other lists alone', async () => {
  const vault = await makeVault();
  const before = JSON.stringify(vault.wishlists.valerio);

  vault.wishlists.tommy.items = [
    wish('wish_0007', {
      cardId: undefined,
      hint: { setCode: 'M6a', number: '045' },
      pendingSince: '2026-09-20',
    }),
  ];

  const writes = await applyResolutions(vault, [
    { id: 'tommy/wish_0007', cardId: 'M6a-045', setId: 'M6a', number: '045', nameJa: 'ピカチュウ', resolvedOn: '2026-11-02' },
  ]);

  assert.equal(JSON.stringify(vault.wishlists.valerio), before);
  assert.ok(!writes?.some((write) => write.path.endsWith('personal/valerio.enc')));
});

test('a resolution for a card id that is not waiting changes nothing', async () => {
  const vault = await makeVault();
  const writes = await applyResolutions(vault, [
    { id: 'tommy/wish_9999', cardId: 'M6a-045', setId: 'M6a', number: '045', nameJa: 'ピカチュウ', resolvedOn: '2026-11-02' },
  ]);
  assert.equal(writes, null, 'nothing to apply must not produce a commit');
});
