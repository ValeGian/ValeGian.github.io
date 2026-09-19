/**
 * Lists the cards that need a price read by hand today, and why.
 *
 * The daily job takes its figures from TCGdex, whose rolling averages stopped moving
 * (PLAN.md §8.4) and which does not carry every set. Cardmarket has the numbers but
 * refuses automated clients, so the gap is filled from a browser — see PRICES-BY-HAND.md,
 * which is the procedure this script feeds.
 *
 * Nothing here decides anything. It prints work, so that a session doing the reading
 * knows what is outstanding and, just as importantly, what is already done today.
 *
 *   node scripts/price-todo.mjs [--date YYYY-MM-DD] [--json]
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const DATA = 'public/data';

/** Past this, a hand-checked price is old enough that it is no longer evidence. */
const STALE_MANUAL_DAYS = 90;

/**
 * Days of identical avg30 before a card counts as frozen rather than quiet.
 *
 * Two readings the same is ordinary; a card can go a day without a sale. Three is where
 * it stops being a coincidence, and it is also the soonest this can be said at all, since
 * it needs three days on file.
 */
const FROZEN_AFTER_DAYS = 3;

const { values: options } = parseArgs({
  options: {
    // The daily files are named by UTC date, and so is this, or a reading taken late in a
    // European evening would be filed under tomorrow and asked for twice.
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    json: { type: 'boolean', default: false },
  },
});

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

const watchlist = await readJson(`${DATA}/watchlist.json`);
const overrides = await readJson(`${DATA}/catalog-overrides.json`);
const latest = existsSync(`${DATA}/prices/latest.json`) ? await readJson(`${DATA}/prices/latest.json`) : { prices: {} };

const dailyDir = `${DATA}/prices/daily`;
const dayFiles = existsSync(dailyDir)
  ? (await readdir(dailyDir)).filter((name) => name.endsWith('.json')).sort()
  : [];

const days = [];
for (const name of dayFiles) days.push({ date: name.replace('.json', ''), ...(await readJson(`${dailyDir}/${name}`)) });

const manualPrices = new Map(overrides.cards.map((card) => [card.cardId, card]));

/**
 * What has already been read by hand today, so the same card is not done twice.
 *
 * Cards with a standing override are excluded: the daily job copies their figure into
 * every snapshot, so they always look hand-read today without anyone having looked.
 */
const today = days.find((day) => day.date === options.date);
const doneToday = new Set(
  Object.entries(today?.prices ?? {})
    .filter(([cardId, price]) => price.source === 'cardmarket/manual' && !manualPrices.has(cardId))
    .map(([cardId]) => cardId),
);

/** True when avg30 has not moved across the last few days on file. */
function isFrozen(cardId) {
  const readings = days
    .map((day) => day.prices[cardId])
    .filter((price) => price && price.source === 'cardmarket/tcgdex' && price.avg30 !== null);

  if (readings.length < FROZEN_AFTER_DAYS) return false;
  const recent = readings.slice(-FROZEN_AFTER_DAYS);
  return recent.every((price) => price.avg30 === recent[0].avg30);
}

const work = [];

for (const entry of watchlist.cards) {
  if (doneToday.has(entry.cardId)) continue;

  const override = manualPrices.get(entry.cardId);
  if (override) {
    const age = override.price?.checkedOn ? daysSince(override.price.checkedOn) : Infinity;
    if (age > STALE_MANUAL_DAYS) {
      work.push({ cardId: entry.cardId, reason: 'hand-checked price is stale', detail: `${age} days old`, url: override.cardmarketUrl ?? null });
    }
    continue;
  }

  const price = latest.prices[entry.cardId];
  if (!price || price.avg30 === null || price.avg30 === undefined) {
    work.push({ cardId: entry.cardId, reason: 'no price at all', detail: 'TCGdex returns none', url: null });
    continue;
  }

  if (isFrozen(entry.cardId)) {
    work.push({
      cardId: entry.cardId,
      reason: 'avg30 frozen',
      detail: `unchanged at ${price.avg30} for ${FROZEN_AFTER_DAYS} readings`,
      url: null,
    });
  }
}

/**
 * Cards that have no catalog entry at all, and so cannot even be asked for by id.
 *
 * These live only inside the encrypted lists, so they are read from the plaintext working
 * copy when there is one. A card here needs identifying on Cardmarket before it can be
 * priced: its Japanese number is what turns it into a card id (`M6a-105`), and until then
 * it appears in no public file.
 */
const unidentified = [];
const localLists = ['.local/collection.json', '.local/wishlists/valerio.json', '.local/wishlists/tommy.json', '.local/wishlists/lotad.json'];

for (const path of localLists) {
  if (!existsSync(path)) continue;
  const file = await readJson(path);
  for (const item of file.items ?? []) {
    if (item.cardId || item.status === 'bought') continue;
    unidentified.push({
      where: path.replace('.local/', '').replace('.json', ''),
      id: item.id,
      setId: item.setId ?? item.hint?.setCode ?? '?',
      name: item.nameEn ?? item.nameJa ?? item.hint?.nameEn ?? '?',
      standInFor: item.imageBase?.match(/\/en\/[^/]+\/([^/]+)\/(\d+)$/)?.slice(1).join('-') ?? null,
    });
  }
}

if (options.json) {
  console.log(JSON.stringify({ date: options.date, doneToday: [...doneToday], work, unidentified }, null, 2));
} else {
  console.log(`date              ${options.date} (UTC, matching the daily files)`);
  console.log(`days on file      ${days.length}`);
  console.log(`already read      ${doneToday.size} card(s) by hand today`);
  console.log(`still to read     ${work.length} card(s)\n`);

  for (const item of work) {
    console.log(`  ${item.cardId.padEnd(12)} ${item.reason.padEnd(26)} ${item.detail}`);
    if (item.url) console.log(`  ${''.padEnd(12)} ${item.url}`);
  }

  if (work.length === 0) console.log('  nothing outstanding.');

  if (unidentified.length > 0) {
    console.log(`\n${unidentified.length} card(s) have no catalog entry and need identifying first:`);
    const byCard = new Map();
    for (const item of unidentified) {
      const key = `${item.setId} ${item.name} ${item.standInFor ?? ''}`;
      byCard.set(key, [...(byCard.get(key) ?? []), `${item.where}/${item.id}`]);
    }
    for (const [key, holders] of byCard) {
      console.log(`  ${key.padEnd(44)} ${holders.join(', ')}`);
    }
  } else if (!existsSync('.local/collection.json')) {
    console.log('\n(.local/ is not present, so cards with no catalog entry were not checked —');
    console.log(' run `npm run data:decrypt` first to include them.)');
  }

  console.log('\nHow to read and record these: PRICES-BY-HAND.md');
}
