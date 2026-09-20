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
 * Ordered by the money resting on each figure, because the allowance for reading pages
 * runs out long before the list does. Ten cards carry more of the collection's value than
 * the fifty below them put together, and a wrong price on a 400 euro card matters in a way
 * that a wrong price on a 5 euro one does not.
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

/**
 * How far avg30 may sit from TCGdex's own trend before it is worth re-reading.
 *
 * These come from the same feed and describe the same market, so a wide gap means one of
 * them is stale — and it is avg30, which is the field that stopped moving (PLAN.md §8.4).
 * This catches a card on the first day, where the frozen test needs three.
 */
const TREND_GAP = 0.08;

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

/**
 * How many copies are held, and where, so the ordering reflects real exposure.
 *
 * Read from the plaintext working copy; the public watchlist deliberately carries no
 * quantities and no owner. Without it the figures still order correctly, just by unit
 * price rather than by holding.
 */
const holdings = new Map();

function note(cardId, where, copies) {
  if (!cardId) return;
  const entry = holdings.get(cardId) ?? { copies: 0, where: new Set() };
  entry.copies += copies;
  entry.where.add(where);
  holdings.set(cardId, entry);
}

if (existsSync('.local/collection.json')) {
  for (const item of (await readJson('.local/collection.json')).items ?? []) {
    note(item.cardId, 'collection', item.quantity ?? 1);
  }
}
for (const owner of ['valerio', 'tommy', 'lotad']) {
  const path = `.local/wishlists/${owner}.json`;
  if (!existsSync(path)) continue;
  for (const item of (await readJson(path)).items ?? []) {
    if (item.status !== 'bought') note(item.cardId, `${owner}'s list`, 0);
  }
}

const work = [];

for (const entry of watchlist.cards) {
  if (doneToday.has(entry.cardId)) continue;

  const held = holdings.get(entry.cardId);
  const add = (reason, detail, price, url = null) =>
    work.push({
      cardId: entry.cardId,
      reason,
      detail,
      url,
      // What the figure is worth being wrong about. A wanted card holds no copies, so it
      // is ranked on its unit price alone — it still has to be read, just later.
      value: (price?.avg30 ?? 0) * Math.max(held?.copies ?? 0, 1),
      copies: held?.copies ?? 0,
      where: held ? [...held.where].join(', ') : 'unknown',
    });

  const override = manualPrices.get(entry.cardId);
  if (override) {
    const age = override.price?.checkedOn ? daysSince(override.price.checkedOn) : Infinity;
    if (age > STALE_MANUAL_DAYS) {
      add('hand-checked price is stale', `${age} days old`, override.price, override.cardmarketUrl ?? null);
    }
    continue;
  }

  const price = latest.prices[entry.cardId];
  if (!price || price.avg30 === null || price.avg30 === undefined) {
    add('no price at all', 'TCGdex returns none', price);
    continue;
  }

  if (isFrozen(entry.cardId)) {
    add('avg30 frozen', `unchanged at ${price.avg30} for ${FROZEN_AFTER_DAYS} readings`, price);
    continue;
  }

  // Same feed, same market: a wide gap means avg30 is the stale one.
  if (price.trend) {
    const gap = (price.trend - price.avg30) / price.avg30;
    if (Math.abs(gap) >= TREND_GAP) {
      add('avg30 disagrees with trend', `avg30 ${price.avg30} vs trend ${price.trend} (${gap > 0 ? '+' : ''}${Math.round(gap * 100)}%)`, price);
    }
  }
}

// Most money first: the allowance for reading pages runs out before the list does.
work.sort((a, b) => b.value - a.value);

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

  let running = 0;
  const total = work.reduce((sum, item) => sum + item.value, 0);

  for (const [index, item] of work.entries()) {
    running += item.value;
    const share = total > 0 ? Math.round((running / total) * 100) : 0;
    console.log(
      `  ${String(index + 1).padStart(3)}. ${item.cardId.padEnd(11)} ${('EUR ' + item.value.toFixed(2)).padStart(11)}` +
        `  ${item.copies > 0 ? `${item.copies}x ${item.where}` : item.where}`,
    );
    console.log(`       ${item.reason} — ${item.detail}   [${share}% of value covered]`);
    if (item.url) console.log(`       ${item.url}`);
  }

  if (work.length > 0) {
    console.log(`\n  EUR ${total.toFixed(2)} of value rests on the figures above.`);
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
