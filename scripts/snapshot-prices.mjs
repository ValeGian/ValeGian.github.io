/**
 * Takes one day's price reading for every card on the watchlist.
 *
 * Writes two things:
 *
 *   prices/daily/<date>.json   immutable. Written once, never touched again.
 *   prices/latest.json         rewritten each run, so the site has one file to read.
 *
 * Only immutable files accumulate history. A rolling history file would be rewritten
 * every day, and because git stores a version per commit that costs roughly a hundred
 * times more than the data it holds — about 1.2 GB a year at 500 cards against 20 MB for
 * daily files. Older ranges are served by monthly rollups instead, written once when a
 * month is over.
 *
 *   node scripts/snapshot-prices.mjs [--date YYYY-MM-DD] [--dry-run]
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { card, chooseVariant, cardmarketPrice } from './lib/tcgdex.mjs';

const DATA = 'public/data';
const FIELDS = ['avg30', 'avg7', 'avg1', 'trend', 'low', 'avg'];

/**
 * Losing prices for a few cards is normal — Cardmarket delists products. Losing them for
 * a large share of the collection means something broke upstream, and writing that as a
 * day of history would corrupt the series. Fail instead.
 */
const MAX_LOSS_RATIO = 0.2;

const { values: options } = parseArgs({
  options: {
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    'dry-run': { type: 'boolean', default: false },
  },
});

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const round2 = (value) => (value === null || value === undefined ? null : Math.round(value * 100) / 100);

const watchlist = await readJson(`${DATA}/watchlist.json`);
const overrides = await readJson(`${DATA}/catalog-overrides.json`);

const previous = existsSync(`${DATA}/prices/latest.json`)
  ? await readJson(`${DATA}/prices/latest.json`)
  : { prices: {} };

const prices = {};
const lost = [];
const failed = [];

for (const entry of watchlist.cards) {
  try {
    const detail = await card(entry.cardId);
    const variant =
      (detail.variants_detailed ?? []).find((candidate) => candidate.variantId === entry.variantId) ??
      chooseVariant(detail).variant;
    const cardmarket = cardmarketPrice(variant);

    if (!cardmarket || cardmarket.avg30 === null || cardmarket.avg30 === undefined) {
      if (previous.prices[entry.cardId]) lost.push(entry.cardId);
      continue;
    }

    prices[entry.cardId] = {
      source: 'cardmarket/tcgdex',
      currency: cardmarket.unit ?? 'EUR',
      updated: cardmarket.updated ?? null,
      ...Object.fromEntries(FIELDS.map((field) => [field, round2(cardmarket[field])])),
    };
  } catch (error) {
    failed.push(`${entry.cardId}: ${error.message}`);
  }
}

// Cards Cardmarket does not list through TCGdex carry a hand-checked price. Copying it
// into every snapshot keeps the series complete, and `source` keeps it honest about
// where the number came from and when it was last looked at.
for (const override of overrides.cards) {
  if (!override.price || override.price.avg30 === null) continue;
  prices[override.cardId] = {
    source: 'cardmarket/manual',
    currency: override.price.currency,
    updated: override.price.checkedOn,
    ...Object.fromEntries(FIELDS.map((field) => [field, round2(override.price[field] ?? null)])),
  };
}

const expected = watchlist.cards.length;
const got = Object.keys(prices).length - overrides.cards.filter((entry) => entry.price?.avg30 !== null).length;

if (failed.length > 0) {
  console.error('failed lookups:');
  for (const message of failed) console.error(`  ${message}`);
}

if (expected > 0 && got / expected < 1 - MAX_LOSS_RATIO) {
  console.error(`\nOnly ${got} of ${expected} watched cards priced. Refusing to write a partial day.`);
  process.exit(1);
}

const snapshot = {
  version: 1,
  date: options.date,
  generatedAt: new Date().toISOString(),
  prices,
};

if (options['dry-run']) {
  console.log(`priced ${Object.keys(prices).length} cards (dry run, nothing written)`);
  process.exit(0);
}

await mkdir(`${DATA}/prices/daily`, { recursive: true });

const dailyPath = `${DATA}/prices/daily/${options.date}.json`;
if (existsSync(dailyPath)) {
  console.log(`${dailyPath} already exists; leaving it alone`);
} else {
  // Compact on purpose: this file is written once and kept forever.
  await writeFile(dailyPath, `${JSON.stringify(snapshot)}\n`);
}

await writeFile(`${DATA}/prices/latest.json`, `${JSON.stringify(snapshot, null, 2)}\n`);

const days = (await readdir(`${DATA}/prices/daily`)).filter((name) => name.endsWith('.json'));
const total = Object.values(prices).reduce((sum, price) => sum + (price.avg30 ?? 0), 0);

console.log(`priced        ${Object.keys(prices).length} cards`);
if (lost.length > 0) console.log(`lost price    ${lost.join(', ')}`);
console.log(`days on file  ${days.length}`);
console.log(`sum of avg30  EUR ${total.toFixed(2)}`);
