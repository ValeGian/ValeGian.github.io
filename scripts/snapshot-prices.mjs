/**
 * Takes one day's price reading for every card on the watchlist.
 *
 * Writes two things, and they answer different questions:
 *
 *   prices/daily/<date>.json   what was actually observed that day. A card that could
 *                              not be read is simply absent; a gap in the record is a
 *                              real gap and is recorded as one.
 *   prices/latest.json         the best price currently known for each card, which may
 *                              have been carried over from an earlier day. Every reading
 *                              carries the timestamp it was read at, so a carried value
 *                              is visible as an old one rather than a missing one.
 *   artwork.json               where each card's picture is, for cards the catalog had
 *                              none for when they were added. See below.
 *
 * The distinction matters: dropping a card from latest.json because one lookup failed
 * makes the site say a card has no price when it plainly does.
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
import { watchlistCoverage, isTooIncomplete } from './lib/coverage.mjs';

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

/**
 * Where each card's picture is, as the catalog currently says.
 *
 * TCGdex lists a Japanese set weeks or months before it scans the cards: every card in
 * M2a, M4, M5, M6 and SV11W has Cardmarket prices and no artwork at all. A card added
 * then is stored with no picture, and nothing would ever go back and look again.
 *
 * This is that second look, and it costs nothing — the price job already fetches every
 * watched card once a day. It is published as plain data, so the picture simply appears
 * on the next visit, with no key, no write to the vault and nothing to remember.
 */
const artwork = {};

for (const entry of watchlist.cards) {
  try {
    const detail = await card(entry.cardId);
    const variant =
      (detail.variants_detailed ?? []).find((candidate) => candidate.variantId === entry.variantId) ??
      chooseVariant(detail).variant;
    const cardmarket = cardmarketPrice(variant);

    // Before the price check: a card can have a picture and no price, and the picture is
    // still worth having.
    if (detail.image) artwork[entry.cardId] = detail.image;

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

const coverage = watchlistCoverage(watchlist, prices);
const { expected, got } = coverage;

if (failed.length > 0) {
  console.error('failed lookups:');
  for (const message of failed) console.error(`  ${message}`);
}

if (isTooIncomplete(coverage, MAX_LOSS_RATIO)) {
  console.error(`\nOnly ${got} of ${expected} watched cards priced. Refusing to write a partial day.`);
  console.error(`missing: ${coverage.missing.join(', ')}`);
  process.exit(1);
}

const observed = {
  version: 1,
  date: options.date,
  generatedAt: new Date().toISOString(),
  prices,
};

// Today's readings over whatever was already known, so one failed lookup does not erase
// a card from the site. The per-reading `updated` field still says how old each one is.
const current = {
  ...observed,
  prices: { ...previous.prices, ...prices },
};

const carried = Object.keys(current.prices).length - Object.keys(prices).length;

if (options['dry-run']) {
  console.log(`priced ${Object.keys(prices).length} cards (dry run, nothing written)`);
  process.exit(0);
}

await mkdir(`${DATA}/prices/daily`, { recursive: true });

const dailyPath = `${DATA}/prices/daily/${options.date}.json`;

/**
 * Adds to the day rather than skipping it.
 *
 * A day used to be written once and never touched, which was right when this job was the
 * only thing that wrote one. It is not any more: prices read by hand off Cardmarket are
 * filed into the same day as they are taken, so by the time this runs the file usually
 * exists already — and skipping it threw away that day's readings for every other card.
 *
 * Readings already on file win. A hand-read figure is better evidence than TCGdex's, and
 * where the entry came from an earlier run of this job the first reading of the day is
 * the honest one. So this only ever fills in cards the day does not yet have.
 */
if (existsSync(dailyPath)) {
  const existing = await readJson(dailyPath);
  const added = Object.keys(prices).filter((cardId) => !existing.prices[cardId]);

  if (added.length === 0) {
    console.log(`${dailyPath} already has every card priced today`);
  } else {
    const merged = { ...existing, prices: { ...prices, ...existing.prices } };
    await writeFile(dailyPath, `${JSON.stringify(merged)}\n`);
    console.log(`${dailyPath} already existed; added ${added.length} card(s) it did not have`);
  }
} else {
  // Compact on purpose: this file is written once and then only ever added to.
  await writeFile(dailyPath, `${JSON.stringify(observed)}\n`);
}

await writeFile(`${DATA}/prices/latest.json`, `${JSON.stringify(current, null, 2)}\n`);

/**
 * Merged over what was there, never replaced.
 *
 * A card that failed to fetch today must not lose the picture it had yesterday, for the
 * same reason a failed price lookup does not erase a price. Entries are only ever added
 * or updated here; a card leaving the watchlist leaves its entry behind, which costs one
 * short line and means nothing breaks if it comes back.
 */
const previousArtwork = existsSync(`${DATA}/artwork.json`)
  ? (await readJson(`${DATA}/artwork.json`)).cards
  : {};

const allArtwork = { ...previousArtwork, ...artwork };
const newArtwork = Object.keys(artwork).filter((cardId) => !previousArtwork[cardId]);

await writeFile(
  `${DATA}/artwork.json`,
  `${JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      cards: Object.fromEntries(Object.entries(allArtwork).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  )}\n`,
);

if (newArtwork.length > 0) {
  console.log(`artwork appeared for ${newArtwork.length} card(s): ${newArtwork.slice(0, 8).join(', ')}`);
}

/**
 * Hand-checked prices go stale silently, because nothing fetches them. Cardmarket
 * refuses automated clients, so the figure has to be re-read by a person; what can be
 * automated is noticing that it is old.
 */
const STALE_MANUAL_DAYS = 90;
const stale = overrides.cards.filter((card) => {
  if (!card.price?.checkedOn) return false;
  const age = (Date.now() - Date.parse(card.price.checkedOn)) / 86_400_000;
  return age > STALE_MANUAL_DAYS;
});

const days = (await readdir(`${DATA}/prices/daily`)).filter((name) => name.endsWith('.json'));
const total = Object.values(current.prices).reduce((sum, price) => sum + (price.avg30 ?? 0), 0);

console.log(`priced        ${Object.keys(prices).length} cards`);
if (carried > 0) console.log(`carried over  ${carried} card(s) from an earlier reading`);
if (lost.length > 0) console.log(`lost price    ${lost.join(', ')}`);
console.log(`days on file  ${days.length}`);
if (stale.length > 0) {
  console.log(`\nhand-checked prices older than ${STALE_MANUAL_DAYS} days:`);
  for (const card of stale) console.log(`  ${card.cardId}  last checked ${card.price.checkedOn}  ${card.cardmarketUrl ?? ''}`);
  await writeFile(
    '.stale-prices.md',
    [
      `${stale.length} hand-checked price(s) are more than ${STALE_MANUAL_DAYS} days old.`,
      '',
      'Cardmarket refuses automated clients, so these have to be re-read by hand and',
      'updated in `public/data/catalog-overrides.json`.',
      '',
      ...stale.map((card) => `- [\`${card.cardId}\`](${card.cardmarketUrl ?? ''}) — last checked ${card.price.checkedOn}`),
    ].join('\n'),
  );
}
/**
 * Notices when the averages stop moving while the rest of the reading does.
 *
 * Measured 2026-09-20: across 25 cards from sets 604 to 1752 days old, `low` changed on
 * 11 and `trend` on 20 between two refresh cycles, while `avg30`, `avg7` and `avg1`
 * changed on none — and the site's own figures for the same card disagreed with all three
 * averages while matching `low` and `trend` to the cent. A one-day average cannot be
 * identical on twenty-five mature cards a day apart, so that is a dead field, not a quiet
 * market.
 *
 * It matters because the headline value is `avg30`: a frozen field draws a flat line that
 * looks like a stable market. The day is still recorded — a reading is a reading, and
 * refusing would leave a hole that cannot be backfilled — but it is reported.
 */
const FROZEN_SHARE = 0.95;
const FROZEN_MINIMUM = 10;

const previousDay = days
  .filter((name) => name < `${options.date}.json`)
  .sort()
  .at(-1);

if (previousDay) {
  const before = await readJson(`${DATA}/prices/daily/${previousDay}`);

  // Only catalogue readings on both sides. A hand-read figure is a different measurement
  // of the same card, so comparing one against a TCGdex reading would count as movement
  // and quietly dilute the very signal this is looking for.
  const shared = Object.keys(prices).filter(
    (cardId) =>
      prices[cardId].source === 'cardmarket/tcgdex' && before.prices[cardId]?.source === 'cardmarket/tcgdex',
  );

  const unmoved = (fields) =>
    shared.filter((cardId) => fields.every((field) => prices[cardId][field] === before.prices[cardId][field]));

  const averages = unmoved(['avg30', 'avg7', 'avg1']);
  const spot = unmoved(['low', 'trend']);

  if (shared.length >= FROZEN_MINIMUM && averages.length / shared.length >= FROZEN_SHARE) {
    const line = `${averages.length} of ${shared.length} cards have identical avg30, avg7 and avg1 since ${previousDay.replace('.json', '')}`;
    console.warn(`\nWARNING: ${line}`);
    console.warn(`         low and trend are unchanged on only ${spot.length} of ${shared.length}, so the feed is alive.`);

    await writeFile(
      '.frozen-prices.md',
      [
        `**${line}**, while \`low\` and \`trend\` moved on ${shared.length - spot.length} of them.`,
        '',
        'A one-day average cannot be identical on that many mature cards a day apart. The',
        'averages are almost certainly not being refreshed upstream, which matters because',
        '`avg30` is the headline value — a dead field draws a flat line that reads as a',
        'stable market.',
        '',
        'The day was still recorded; a gap cannot be backfilled later. See PLAN.md §8.4.',
        '',
        `- unchanged averages: ${averages.length}/${shared.length}`,
        `- unchanged low+trend: ${spot.length}/${shared.length}`,
      ].join('\n'),
    );
  }
}

console.log(`sum of avg30  EUR ${total.toFixed(2)}`);
