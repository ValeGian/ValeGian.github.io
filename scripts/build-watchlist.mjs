/**
 * Writes the two public files the daily job works from:
 *
 *   public/data/watchlist.json  cards to snapshot a price for
 *   public/data/pending.json    cards the catalog has not published yet, to retry
 *
 * Both carry card identifiers only — no owner, no price paid, no target — so the job
 * never needs a decryption key. That split is what lets the personal data be encrypted
 * without handing the pipeline a secret.
 *
 *   node scripts/build-watchlist.mjs [--collection path]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    collection: { type: 'string', default: '.local/collection.json' },
    wishlists: { type: 'string', default: '.local/wishlists' },
    out: { type: 'string', default: 'public/data/watchlist.json' },
    pending: { type: 'string', default: 'public/data/pending.json' },
  },
});

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const collection = await readJson(options.collection);
const overrides = await readJson('public/data/catalog-overrides.json');
const manual = new Set(overrides.cards.map((card) => card.cardId));

const cards = new Map();
const waiting = [];
const skipped = [];

/** Wanted cards need a price too: a target with nothing to compare against is useless. */
const wishlistItems = [];
if (existsSync(options.wishlists)) {
  for (const name of (await readdir(options.wishlists)).filter((file) => file.endsWith('.json'))) {
    const list = await readJson(`${options.wishlists}/${name}`);
    wishlistItems.push(...list.items.filter((item) => item.status !== 'bought'));
  }
}

for (const item of wishlistItems) {
  if (!item.cardId || manual.has(item.cardId)) continue;
  // A wishlist entry has no variant, so the snapshot resolves the priced one itself.
  if (!cards.has(item.cardId)) cards.set(item.cardId, { cardId: item.cardId });
}

for (const item of collection.items) {
  if (item.status === 'pending') {
    // The hint is what the owner typed off the physical card. It identifies a printing,
    // not an owner, so it is as publishable as the card id it will become.
    waiting.push({ id: item.id, hint: item.hint, pendingSince: item.pendingSince });
    continue;
  }
  if (item.status !== 'resolved') continue;

  // A card priced by hand in catalog-overrides.json has nothing for the job to fetch.
  if (manual.has(item.cardId)) {
    skipped.push(`${item.cardId} priced manually`);
    continue;
  }

  if (!item.variantId) {
    skipped.push(`${item.cardId} has no priced variant`);
    continue;
  }

  cards.set(item.cardId, { cardId: item.cardId, variantId: item.variantId });
}

const watchlist = {
  version: 1,
  generatedAt: new Date().toISOString(),
  cards: [...cards.values()].sort((a, b) => a.cardId.localeCompare(b.cardId)),
};

const pendingFile = {
  version: 1,
  generatedAt: new Date().toISOString(),
  items: waiting.sort((a, b) => a.id.localeCompare(b.id)),
};

await writeFile(options.out, `${JSON.stringify(watchlist, null, 2)}\n`);
await writeFile(options.pending, `${JSON.stringify(pendingFile, null, 2)}\n`);

console.log(`cards to price      ${watchlist.cards.length} (${wishlistItems.length} wanted)`);
console.log(`awaiting catalog    ${pendingFile.items.length}`);
for (const reason of skipped) console.log(`  skipped: ${reason}`);
console.log(`written to          ${options.out}, ${options.pending}`);
