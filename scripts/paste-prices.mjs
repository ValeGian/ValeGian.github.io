/**
 * Records prices collected in the browser by the Cardmarket bookmarklet.
 *
 * The bookmarklet cannot write to the repository — it runs on cardmarket.com, which
 * shares nothing with this project — so it leaves what it read on the clipboard and this
 * takes it from there. One command, however many cards were collected.
 *
 * A card already read by hand today is skipped rather than overwritten: the first
 * reading of a day is the honest one, and clicking the same card twice is easy to do.
 *
 *   npm run price:paste            # reads the clipboard
 *   npm run price:paste -- --dry-run
 *   pbpaste | npm run price:paste -- --stdin
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const DATA = 'public/data';

/**
 * Cardmarket's expansion slug to the set code this project uses.
 *
 * Kept explicit rather than derived from the product slug, which is not reliable: the
 * reprints inside the 30th Anniversary set carry codes like `m6aBS` and `m6aPAL` that no
 * rule would turn into `M6a`.
 *
 * Only `30th-Celebration-JP` has been seen on a real page. The rest are how Cardmarket
 * ought to spell those expansions and are unverified — a wrong one costs nothing, because
 * an unknown slug is reported by name and skipped rather than guessed at. Correct them
 * as they turn up.
 */
const EXPANSIONS = {
  '30th-Celebration-JP': 'M6a',
  'Storm-Emerald': 'M6',
  'Abyss-Eye': 'M5',
  'MEGA-Dream-ex': 'M2a',
  'Pokemon-Card-151': 'SV2a',
  'VSTAR-Universe': 'S12a',
  'Wild-Force': 'SV5K',
  'Super-Electric-Breaker': 'SV8',
  'Terastal-Festival-ex': 'SV8a',
  'White-Flare': 'SV11W',
  'Team-Rockets-Glory': 'SV10',
};

const { values: options } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    stdin: { type: 'boolean', default: false },
    // UTC, matching the daily files, as everything else here does.
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
  },
});

async function clipboard() {
  if (options.stdin) {
    let piped = '';
    for await (const chunk of process.stdin) piped += chunk;
    return piped;
  }
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' });
  } catch {
    throw new Error('Could not read the clipboard. Pipe it instead: pbpaste | npm run price:paste -- --stdin');
  }
}

const raw = (await clipboard()).trim();
if (!raw) throw new Error('The clipboard is empty. Click the bookmarklet on a Cardmarket card page first.');

let collected;
try {
  collected = JSON.parse(raw);
} catch {
  throw new Error('The clipboard does not hold what the bookmarklet leaves there. Click it again.');
}
if (!Array.isArray(collected)) collected = [collected];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const dailyPath = `${DATA}/prices/daily/${options.date}.json`;

const day = existsSync(dailyPath)
  ? await readJson(dailyPath)
  : { version: 1, date: options.date, generatedAt: new Date().toISOString(), prices: {} };

const latestPath = `${DATA}/prices/latest.json`;
const latest = existsSync(latestPath) ? await readJson(latestPath) : { version: 1, date: options.date, prices: {} };

/**
 * The page each price was read from is worth keeping.
 *
 * Cardmarket cannot be crawled for product URLs — Cloudflare refuses non-browser clients
 * — so the only way the site ever gets an exact link to a card is for someone to have
 * stood on that page. The bookmarklet is already there and already sends the address, and
 * throwing it away meant finding the same page again by hand every time.
 */
const marketPath = `${DATA}/market.json`;
const market = existsSync(marketPath)
  ? await readJson(marketPath)
  : { version: 1, generatedAt: new Date().toISOString(), sets: {}, cards: {} };
const linked = [];

const amount = (text) => {
  if (text === null || text === undefined || text === '') return null;
  const value = Number(String(text).replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
};

const recorded = [];
const skipped = [];
const unknown = new Set();

for (const entry of collected) {
  const setId = EXPANSIONS[entry.expansion];
  if (!setId) {
    unknown.add(entry.expansion);
    continue;
  }

  const cardId = `${setId}-${String(entry.number).padStart(3, '0')}`;
  const existing = day.prices[cardId];

  if (existing?.source === 'cardmarket/manual') {
    skipped.push(`${cardId} (already read today at ${existing.avg30})`);
    continue;
  }

  const reading = {
    source: 'cardmarket/manual',
    currency: 'EUR',
    updated: new Date().toISOString(),
    avg30: amount(entry.avg30),
    avg7: amount(entry.avg7),
    avg1: amount(entry.avg1),
    trend: amount(entry.trend),
    low: amount(entry.low),
  };

  if (reading.avg30 === null && reading.trend === null) {
    skipped.push(`${cardId} (no 30-day average and no trend on the page)`);
    continue;
  }

  day.prices[cardId] = reading;
  latest.prices[cardId] = reading;

  // Only a product page, never a search or a listing: those change under you.
  if (/^https:\/\/www\.cardmarket\.com\/[a-z]{2}\/Pokemon\/Products\/Singles\/[^/?#]+\/[^/?#]+$/.test(entry.url ?? '')) {
    if (market.cards[cardId]?.cardmarket !== entry.url) {
      market.cards[cardId] = { ...market.cards[cardId], cardmarket: entry.url };
      linked.push(cardId);
    }
  }
  recorded.push(`${cardId.padEnd(11)} avg30 ${String(reading.avg30 ?? '—').padStart(8)}   trend ${String(reading.trend ?? '—').padStart(8)}   ${entry.name ?? ''}`);
}

if (unknown.size > 0) {
  console.error(`\nUnknown expansion(s): ${[...unknown].join(', ')}`);
  console.error('Add them to EXPANSIONS in scripts/paste-prices.mjs — one line each.');
}

if (recorded.length === 0) {
  console.log(`nothing new to record for ${options.date}`);
  for (const line of skipped) console.log(`  skipped ${line}`);
  process.exit(unknown.size > 0 ? 1 : 0);
}

if (options['dry-run']) {
  console.log(`would record ${recorded.length} card(s) for ${options.date}:`);
  for (const line of recorded) console.log(`  ${line}`);
  for (const line of skipped) console.log(`  skipped ${line}`);
  process.exit(0);
}

latest.generatedAt = new Date().toISOString();
await mkdir(`${DATA}/prices/daily`, { recursive: true });
await writeFile(dailyPath, `${JSON.stringify(day)}\n`);
await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

if (linked.length > 0) {
  market.cards = Object.fromEntries(Object.entries(market.cards).sort(([a], [b]) => a.localeCompare(b)));
  market.generatedAt = new Date().toISOString();
  await writeFile(marketPath, `${JSON.stringify(market, null, 2)}\n`);
  console.log(`\nkept the Cardmarket page for ${linked.length} card(s): ${linked.join(', ')}`);
}

console.log(`recorded ${recorded.length} card(s) on ${options.date}:`);
for (const line of recorded) console.log(`  ${line}`);
for (const line of skipped) console.log(`  skipped ${line}`);
console.log(`\nwritten to ${dailyPath} and ${latestPath}`);
