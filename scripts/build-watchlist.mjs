/**
 * Writes the two public files the daily job works from:
 *
 *   public/data/watchlist.json  cards to snapshot a price for
 *   public/data/pending.json    cards the catalog has not published yet, to retry
 *
 * The logic lives in src/lib/watchlist.mjs so this and the browser produce identical
 * output; publishing from a laptop and publishing from a phone must not disagree.
 *
 *   node scripts/build-watchlist.mjs [--collection path] [--wishlists dir]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { derivePublicFiles } from '../src/lib/watchlist.mjs';

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

// Keyed by file name without its extension, which is the same id the browser holds and
// the same one that ends up in a pending item's id.
const wishlists = {};
if (existsSync(options.wishlists)) {
  for (const name of (await readdir(options.wishlists)).filter((file) => file.endsWith('.json'))) {
    wishlists[name.replace(/\.json$/, '')] = await readJson(`${options.wishlists}/${name}`);
  }
}

const { watchlist, pending, skipped } = derivePublicFiles({
  collection,
  wishlists,
  manualCardIds: overrides.cards.map((card) => card.cardId),
});

await writeFile(options.out, `${JSON.stringify(watchlist, null, 2)}\n`);
await writeFile(options.pending, `${JSON.stringify(pending, null, 2)}\n`);

console.log(`cards to price      ${watchlist.cards.length}`);
console.log(`awaiting catalog    ${pending.items.length}`);
for (const reason of skipped) console.log(`  skipped: ${reason}`);
console.log(`written to          ${options.out}, ${options.pending}`);
