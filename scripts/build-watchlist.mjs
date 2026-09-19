/**
 * Writes public/data/watchlist.json: every card the daily price job should snapshot.
 *
 * The file deliberately carries no owner, no price paid and no target, so the pipeline
 * never needs a decryption key and the file is safe to serve from a public repository.
 * That split is the whole reason the personal data can be encrypted without giving the
 * job a secret.
 *
 *   node scripts/build-watchlist.mjs [--collection path] [--out path]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    collection: { type: 'string', default: '.local/collection.json' },
    out: { type: 'string', default: 'public/data/watchlist.json' },
  },
});

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const collection = await readJson(options.collection);
const overrides = await readJson('public/data/catalog-overrides.json');
const manual = new Set(overrides.cards.map((card) => card.cardId));

const cards = new Map();
const skipped = [];

for (const item of collection.items) {
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

  cards.set(`${item.cardId}|${item.variantId}`, { cardId: item.cardId, variantId: item.variantId });
}

const watchlist = {
  version: 1,
  generatedAt: new Date().toISOString(),
  cards: [...cards.values()].sort((a, b) => a.cardId.localeCompare(b.cardId)),
};

await writeFile(options.out, `${JSON.stringify(watchlist, null, 2)}\n`);

console.log(`cards to price  ${watchlist.cards.length}`);
for (const reason of skipped) console.log(`  skipped: ${reason}`);
console.log(`written to      ${options.out}`);
