/**
 * Asks TCGdex, right now, whether its rolling averages have started moving again.
 *
 * Separate from the daily job because the question is answered by a single comparison and
 * wants asking at a particular moment: TCGdex refreshes at about 22:54 UTC, so running
 * this after that gives a clean verdict on the day just past without waiting for the
 * 06:20 snapshot.
 *
 * Compares what the catalog serves now against the most recent reading on file, and only
 * where both came from the catalog — a hand-read figure is a different measurement and
 * would read as movement.
 *
 *   node scripts/freeze-check.mjs [--verbose]
 */
import { readFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { card, chooseVariant, cardmarketPrice } from './lib/tcgdex.mjs';

const DATA = 'public/data';

/** Enough cards to be conclusive without asking the catalog for the whole watchlist. */
const SAMPLE = 25;

const { values: options } = parseArgs({ options: { verbose: { type: 'boolean', default: false } } });

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const days = (await readdir(`${DATA}/prices/daily`)).filter((name) => name.endsWith('.json')).sort();
if (days.length === 0) throw new Error('No daily snapshot on file to compare against.');

const latestDay = days.at(-1);
const before = await readJson(`${DATA}/prices/daily/${latestDay}`);

const catalogued = Object.entries(before.prices)
  .filter(([, price]) => price.source === 'cardmarket/tcgdex' && price.avg30 !== null)
  .slice(0, SAMPLE);

console.log(`comparing TCGdex now against ${latestDay} (${catalogued.length} catalogued cards)\n`);

const moved = { avg30: [], avg7: [], avg1: [], low: [], trend: [] };
let compared = 0;
let stampAdvanced = 0;

for (const [cardId, was] of catalogued) {
  try {
    const detail = await card(cardId);
    const now = cardmarketPrice(chooseVariant(detail).variant);
    if (!now) continue;
    compared += 1;

    if (was.updated && now.updated && now.updated > was.updated) stampAdvanced += 1;

    for (const field of Object.keys(moved)) {
      const value = now[field] === null || now[field] === undefined ? null : Math.round(now[field] * 100) / 100;
      if (value !== was[field]) moved[field].push({ cardId, from: was[field], to: value });
    }
  } catch {
    // A card that will not load says nothing either way.
  }
}

console.log(`cards compared        ${compared}`);
console.log(`newer TCGdex stamp    ${stampAdvanced}/${compared}\n`);

for (const [field, changes] of Object.entries(moved)) {
  console.log(`  ${field.padEnd(6)} moved on ${String(changes.length).padStart(3)}/${compared}`);
  if (options.verbose) {
    for (const change of changes.slice(0, 4)) console.log(`         ${change.cardId}: ${change.from} -> ${change.to}`);
  }
}

const averagesMoved = moved.avg30.length + moved.avg7.length + moved.avg1.length;
const spotMoved = moved.low.length + moved.trend.length;

console.log();
if (compared === 0) {
  console.log('VERDICT  nothing could be compared.');
} else if (averagesMoved === 0 && spotMoved > 0) {
  console.log('VERDICT  still frozen. low and/or trend moved; not one average did.');
  console.log('         Another day on the same footing as 18->19 and 19->20 September.');
} else if (averagesMoved === 0 && spotMoved === 0) {
  console.log('VERDICT  nothing moved at all, so this says nothing — the whole reading is');
  console.log('         unchanged. Run it again after TCGdex refreshes at ~22:54 UTC.');
} else {
  console.log(`VERDICT  the averages are moving again (${averagesMoved} change(s) across avg30/avg7/avg1).`);
  console.log('         The freeze has lifted; PLAN.md §8.4 can be closed once a day of');
  console.log('         readings confirms it, and the hand-read queue shortens accordingly.');
}
