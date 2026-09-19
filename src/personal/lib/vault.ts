/**
 * The unlocked vault, and every change that can be made to it.
 *
 * Holds the decrypted contents and the file keys from the unlock, but never the
 * password: saving reseals a payload under the key it already has, so nothing needs to
 * keep a password in memory in order to write.
 *
 * Nothing here touches storage. Every mutation returns the files that would have to be
 * written, and the caller decides what to do with them. That keeps the rules about whose
 * money is whose testable without a browser, and leaves one place — the caller — where
 * anything reaches the device or GitHub.
 */
import { resealPayload } from '../../lib/crypto.mjs';
import { derivePublicFiles } from '../../lib/watchlist.mjs';
import type { Collection, CollectionItem, Purchase, Wishlist, WishlistItem } from './types.ts';

const PERSONAL_PATH = 'public/data/personal';
const DATA_PATH = 'public/data';

export interface Envelope {
  v: 1;
  [key: string]: unknown;
}

export interface Vault {
  collection: Collection;
  wishlists: Record<string, Wishlist>;
  keys: Map<string, CryptoKey>;
  envelopes: Map<string, Envelope>;
  manualCardIds: string[];
}

/** Ids only have to be unique within the file, and readable when something goes wrong. */
function nextId(prefix: string, existing: string[]): string {
  const highest = existing
    .map((id) => Number.parseInt(id.replace(`${prefix}_`, ''), 10))
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);
  return `${prefix}_${String(highest + 1).padStart(4, '0')}`;
}

export const newCardId = (vault: Vault): string =>
  nextId('itm', vault.collection.items.map((item) => item.id));

export const newWishId = (list: Wishlist): string => nextId('wish', list.items.map((item) => item.id));

export interface Write {
  path: string;
  content: string;
  savedAt: string;
}

/**
 * Reseals the files that changed and returns everything that has to be written.
 *
 * `touched` names the personal files to rewrite; the derived public files always go
 * along, because a card added without its watchlist entry would never be priced.
 *
 * Kept separate from storing the result so it can be tested without a browser — this is
 * the function that decides what reaches GitHub.
 */
export async function buildWrites(vault: Vault, touched: string[]): Promise<Write[]> {
  const writes: Write[] = [];
  const savedAt = new Date().toISOString();

  for (const name of new Set(touched)) {
    const key = vault.keys.get(name);
    const envelope = vault.envelopes.get(name);
    if (!key || !envelope) throw new Error(`No key held for ${name}; cannot save it`);

    const payload = name === 'collection' ? vault.collection : vault.wishlists[name];
    const sealed = (await resealPayload(envelope, key, payload)) as Envelope;
    vault.envelopes.set(name, sealed);
    writes.push({ path: `${PERSONAL_PATH}/${name}.enc`, content: `${JSON.stringify(sealed)}\n`, savedAt });
  }

  const { watchlist, pending } = derivePublicFiles({
    collection: vault.collection,
    wishlists: Object.values(vault.wishlists),
    manualCardIds: vault.manualCardIds,
    now: savedAt,
  });

  writes.push(
    { path: `${DATA_PATH}/watchlist.json`, content: `${JSON.stringify(watchlist, null, 2)}\n`, savedAt },
    { path: `${DATA_PATH}/pending.json`, content: `${JSON.stringify(pending, null, 2)}\n`, savedAt },
  );

  return writes;
}

export async function addCard(vault: Vault, item: CollectionItem): Promise<Write[]> {
  vault.collection.items.push(item);
  return buildWrites(vault, ['collection']);
}

export async function updateCard(vault: Vault, id: string, patch: Partial<CollectionItem>): Promise<Write[]> {
  const item = vault.collection.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`No card ${id}`);
  Object.assign(item, patch);
  return buildWrites(vault, ['collection']);
}

export async function deleteCard(vault: Vault, id: string): Promise<Write[]> {
  vault.collection.items = vault.collection.items.filter((item) => item.id !== id);
  return buildWrites(vault, ['collection']);
}

export async function addWish(vault: Vault, owner: string, item: WishlistItem): Promise<Write[]> {
  return addWishToMany(vault, [owner], item);
}

/**
 * Puts the same card on several lists at once.
 *
 * Two people wanting the same card is normal, and walking a shop with it listed twice is
 * the point — each of them has their own target price and their own answer about whether
 * it was worth buying. Each list gets its own item with its own id; nothing is shared
 * between them.
 */
export async function addWishToMany(
  vault: Vault,
  owners: string[],
  item: Omit<WishlistItem, 'id'>,
): Promise<Write[]> {
  const touched: string[] = [];

  for (const owner of owners) {
    const list = vault.wishlists[owner];
    if (!list) throw new Error(`No wishlist for ${owner}`);
    list.items.push({ ...item, id: newWishId(list) });
    touched.push(owner);
  }

  if (touched.length === 0) throw new Error('Choose at least one list');
  return buildWrites(vault, touched);
}

export async function deleteWish(vault: Vault, owner: string, id: string): Promise<Write[]> {
  const list = vault.wishlists[owner];
  list.items = list.items.filter((item) => item.id !== id);
  return buildWrites(vault, [owner]);
}

/**
 * Marks a wanted card bought, and this is where the two behaviours part.
 *
 * My own card becomes a collection item and leaves the wishlist. A friend's card stays
 * on their list, flips to bought, and its cost joins what they owe. Their cards are not
 * my assets and must never reach my totals.
 */
export async function markBought(
  vault: Vault,
  owner: string,
  wishId: string,
  purchase: Purchase,
): Promise<{ addedToCollection: boolean; writes: Write[] }> {
  const list = vault.wishlists[owner];
  const item = list.items.find((candidate) => candidate.id === wishId);
  if (!item) throw new Error(`No wishlist item ${wishId}`);

  if (owner !== 'valerio') {
    item.status = 'bought';
    item.boughtAt = purchase.date;
    item.purchase = purchase;
    return { addedToCollection: false, writes: await buildWrites(vault, [owner]) };
  }

  const card: CollectionItem = {
    id: newCardId(vault),
    status: item.cardId ? 'resolved' : 'pending',
    cardId: item.cardId,
    setId: item.setId,
    number: item.number,
    nameJa: item.nameJa,
    nameEn: item.nameEn,
    imageBase: item.imageBase,
    catalogSource: item.cardId ? 'tcgdex' : undefined,
    condition: 'NM',
    isGraded: false,
    quantity: 1,
    purchase,
    acquiredFrom: item.id,
    notes: item.notes ?? '',
  };

  vault.collection.items.push(card);
  list.items = list.items.filter((candidate) => candidate.id !== wishId);
  return { addedToCollection: true, writes: await buildWrites(vault, ['collection', owner]) };
}
