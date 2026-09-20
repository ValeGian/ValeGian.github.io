/**
 * Records a price read off Cardmarket by hand.
 *
 * Writes into the day's own snapshot, alongside whatever the daily job collected, marked
 * `cardmarket/manual` so the site and the history can always say where a figure came
 * from. See PRICES-BY-HAND.md for the procedure this is the last step of.
 *
 * Appending to a day already on file is allowed here and nowhere else. The daily job
 * refuses to touch an existing day, because rewriting a reading it took would destroy
 * evidence; adding a card it could not price destroys nothing.
 *
 *   node scripts/record-manual-price.mjs --card M6a-105 --avg30 10.29 \
 *     [--avg7 10.29] [--avg1 9.24] [--low 6.99] [--trend 9.61] \
 *     [--url https://…] [--date YYYY-MM-DD] [--dry-run]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const DATA = 'public/data';

const { values: options } = parseArgs({
  options: {
    card: { type: 'string' },
    avg30: { type: 'string' },
    avg7: { type: 'string' },
    avg1: { type: 'string' },
    low: { type: 'string' },
    trend: { type: 'string' },
    url: { type: 'string' },
    // UTC, matching the daily files, or an evening reading in Europe lands on tomorrow.
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (!options.card) throw new Error('--card is required, e.g. --card M6a-105');
if (!options.avg30) throw new Error('--avg30 is required: it is the figure the site prices on');

/** Rejects a stray thousands separator or a stray currency symbol rather than storing it. */
function amount(text, field) {
  if (text === undefined) return null;
  const value = Number(String(text).replace(',', '.').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${field} is not a positive number: ${text}`);
  return Math.round(value * 100) / 100;
}

const reading = {
  source: 'cardmarket/manual',
  currency: 'EUR',
  updated: new Date().toISOString(),
  avg30: amount(options.avg30, 'avg30'),
  avg7: amount(options.avg7, 'avg7'),
  avg1: amount(options.avg1, 'avg1'),
  trend: amount(options.trend, 'trend'),
  low: amount(options.low, 'low'),
};

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const dailyPath = `${DATA}/prices/daily/${options.date}.json`;

const day = existsSync(dailyPath)
  ? await readJson(dailyPath)
  : { version: 1, date: options.date, generatedAt: new Date().toISOString(), prices: {} };

const replacing = day.prices[options.card];
if (replacing && replacing.source === 'cardmarket/tcgdex') {
  console.warn(`  note: replacing today's TCGdex reading for ${options.card} (avg30 ${replacing.avg30}) with a hand-read one.`);
}

day.prices[options.card] = reading;

const latestPath = `${DATA}/prices/latest.json`;
const latest = existsSync(latestPath)
  ? await readJson(latestPath)
  : { version: 1, date: options.date, generatedAt: new Date().toISOString(), prices: {} };

latest.prices[options.card] = reading;
latest.generatedAt = new Date().toISOString();

if (options['dry-run']) {
  console.log(JSON.stringify({ wouldWrite: { [options.card]: reading }, to: [dailyPath, latestPath] }, null, 2));
  process.exit(0);
}

await mkdir(`${DATA}/prices/daily`, { recursive: true });
await writeFile(dailyPath, `${JSON.stringify(day)}\n`);
await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

/**
 * The page the figure was read from becomes the card's Cardmarket link.
 *
 * Cardmarket cannot be crawled for product URLs, so someone standing on the page is the
 * only way the site ever gets an exact one. Reading a price means being on exactly that
 * page, so the link comes free — a search has to serve until then.
 */
const isProductPage = /^https:\/\/www\.cardmarket\.com\/[a-z]{2}\/Pokemon\/Products\/Singles\/[^/?#]+\/[^/?#]+$/.test(
  options.url ?? '',
);
if (isProductPage) {
  const marketPath = `${DATA}/market.json`;
  const market = existsSync(marketPath)
    ? await readJson(marketPath)
    : { version: 1, generatedAt: new Date().toISOString(), sets: {}, cards: {} };

  market.cards[options.card] = { ...market.cards[options.card], cardmarket: options.url };
  market.cards = Object.fromEntries(Object.entries(market.cards).sort(([a], [b]) => a.localeCompare(b)));
  market.generatedAt = new Date().toISOString();
  await writeFile(marketPath, `${JSON.stringify(market, null, 2)}\n`);
}

console.log(`recorded ${options.card} on ${options.date}: avg30 ${reading.avg30} EUR (hand-read)`);
if (options.url) console.log(`  from ${options.url}${isProductPage ? ' — kept as this card\'s Cardmarket link' : ''}`);
console.log(`  written to ${dailyPath} and ${latestPath}`);
