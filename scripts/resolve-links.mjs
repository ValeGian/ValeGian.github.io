/**
 * Finds the PriceCharting page for every card in the collection and the wishlists.
 *
 * The links are harvested, never derived. PriceCharting's product URLs end in the
 * Japanese collector number — `/game/pokemon-japanese-30th-celebration/moltres-105` is
 * the Japanese Moltres, numbered as the Japanese card is — but the name part of the slug
 * carries qualifiers that no rule would produce (`abra-master-ball-63`, `aerodactyl-
 * reverse-142`). So each set's index is read once and the card is matched by number, and
 * then by name where we have one.
 *
 * Cardmarket is not harvested here: Cloudflare refuses non-browser clients, and getting
 * around that is out of bounds. Its exact links arrive from the browser instead, through
 * the price bookmarklet — see PRICES-BY-HAND.md. Until one exists the site falls back to
 * a search scoped to the expansion and the card's number, which cannot point at the
 * wrong card.
 *
 *   node scripts/resolve-links.mjs [--only SV2a] [--dry-run]
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const DATA = 'public/data';
const PAGE_SIZE = 150;
/** Plenty for the largest Japanese set once its reverse and promo variants are counted. */
const MAX_PAGES = 8;
/** Human pace. Their pages are plain HTML and cheap, but there is no reason to rush. */
const PAUSE_MS = 1500;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const { values: options } = parseArgs({
  options: { only: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A name reduced to what both sides can agree on.
 *
 * Applied to our name and to theirs, so the comparison is between like and like.
 * Apostrophes are the reason this exists: PriceCharting writes `steven%27s-metagross-ex`
 * and percent-encodes the quote, so a raw comparison against "Steven's Metagross ex"
 * fails on four of the cards here. Dropping the quote on both sides settles it, and
 * everything else that is not a letter or a digit becomes a separator.
 */
const normaliseName = (name) =>
  decodeURIComponent(name)
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Every card we hold or want, as {key, setId, number, nameEn}. */
async function wantedCards() {
  const cards = new Map();

  const add = (item) => {
    // A card id is `<setId>-<number>` by construction, and a few items carry only that —
    // the ones priced by a catalog override never went through the catalog at all.
    const fromId = item.cardId?.match(/^(.+)-([^-]+)$/);
    const setId = item.setId ?? fromId?.[1];
    const number = item.number ?? fromId?.[2];
    if (!setId || !number) return;

    const key = item.cardId ?? `${setId}-${number}`;
    if (!cards.has(key)) cards.set(key, { key, setId, number, nameEn: item.nameEn ?? null });
  };

  const collection = await readJson('.local/collection.json');
  for (const item of collection.items) add(item);

  const dir = '.local/wishlists';
  if (existsSync(dir)) {
    for (const name of (await readdir(dir)).filter((file) => file.endsWith('.json'))) {
      for (const item of (await readJson(`${dir}/${name}`)).items) add(item);
    }
  }

  return [...cards.values()];
}

/** One page of a set's index, as product paths. */
async function indexPage(slug, cursor) {
  const url = `https://www.pricecharting.com/console/${slug}${cursor ? `?cursor=${cursor}` : ''}`;
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`${slug} returned ${response.status}`);

  const html = await response.text();
  const paths = new Set();
  for (const match of html.matchAll(/\/game\/[^"'<>\s]+/g)) paths.add(match[0].replace(/&amp;/g, '&'));
  return [...paths];
}

/**
 * The product for one card, out of everything the set lists under that number.
 *
 * The name has to agree as well as the number, and there is no weaker fallback. A number
 * can carry several products — the card, its reverse holo, a Master Ball stamp — and
 * worse, an old set can be numbered differently by the two sites: PriceCharting's
 * fourteenth card of the 1996 Expansion Pack is Kakuna, while the fourteenth card of that
 * set in our catalog is Charmander, because the 1996 cards print the Pokédex number.
 * Taking the number alone produced a confident link to the wrong card.
 *
 * A card that cannot be matched on both is left unresolved and reported. The site then
 * falls back to a search, which is a worse link but never a wrong one.
 */
function pickProduct(paths, number, nameEn) {
  const tail = `-${Number(number)}`;
  const candidates = paths.filter((path) => path.endsWith(tail));
  if (candidates.length === 0 || !nameEn) return { product: null, candidates };

  const wanted = normaliseName(`${nameEn}${tail}`);
  return { product: candidates.find((path) => normaliseName(path.split('/').pop()) === wanted) ?? null, candidates };
}

const market = await readJson(`${DATA}/market.json`);
const cards = await wantedCards();

/**
 * Cardmarket links that already exist.
 *
 * A card priced by a catalog override was looked up on Cardmarket by hand, and the page
 * it was read from is recorded with it. That is an exact link and there is no reason to
 * make anyone find it twice.
 */
const overrides = await readJson(`${DATA}/catalog-overrides.json`);
for (const override of overrides.cards) {
  if (override.cardmarketUrl) {
    market.cards[override.cardId] = { ...market.cards[override.cardId], cardmarket: override.cardmarketUrl };
  }
}

const bySet = new Map();
for (const card of cards) {
  if (options.only && card.setId !== options.only) continue;
  if (!bySet.has(card.setId)) bySet.set(card.setId, []);
  bySet.get(card.setId).push(card);
}

const resolved = { ...market.cards };
const problems = [];

for (const [setId, wanted] of [...bySet].sort()) {
  const entry = market.sets[setId];
  if (!entry?.pricecharting?.slug) {
    problems.push(`${setId}: no PriceCharting slug in market.json — add one`);
    continue;
  }

  const slug = entry.pricecharting.slug;
  const paths = new Set();
  let outstanding = wanted.filter((card) => !resolved[card.key]?.pricecharting);

  for (let page = 0; page < MAX_PAGES && outstanding.length > 0; page += 1) {
    let fresh = 0;
    try {
      for (const path of await indexPage(slug, page * PAGE_SIZE)) {
        if (!paths.has(path)) {
          paths.add(path);
          fresh += 1;
        }
      }
    } catch (error) {
      problems.push(`${setId}: ${error.message}`);
      break;
    }

    // The index repeats itself once it runs out, which is how the end is known.
    if (fresh === 0) break;

    const list = [...paths];
    outstanding = outstanding.filter((card) => {
      const { product } = pickProduct(list, card.number, card.nameEn);
      if (!product) return true;
      resolved[card.key] = { ...resolved[card.key], pricecharting: `https://www.pricecharting.com${product}` };
      return false;
    });

    await pause(PAUSE_MS);
  }

  entry.pricecharting.checkedOn = new Date().toISOString().slice(0, 10);
  const found = wanted.length - outstanding.length;
  console.log(`${setId.padEnd(6)} ${String(found).padStart(3)}/${String(wanted.length).padEnd(3)} found   (${paths.size} products indexed)`);
  for (const card of outstanding) {
    const { candidates } = pickProduct([...paths], card.number, card.nameEn);
    const near = candidates.map((path) => path.split('/').pop()).join(', ') || 'nothing with that number';
    problems.push(`${card.key} (${card.nameEn}): no match in ${slug} — under ${card.number} it lists ${near}`);
  }
}

if (problems.length > 0) {
  console.error('\nunresolved:');
  for (const problem of problems) console.error(`  ${problem}`);
}

if (options['dry-run']) {
  console.log(`\n${Object.keys(resolved).length} card(s) would be written (dry run)`);
  process.exit(0);
}

market.cards = Object.fromEntries(Object.entries(resolved).sort(([a], [b]) => a.localeCompare(b)));
market.generatedAt = new Date().toISOString();
await writeFile(`${DATA}/market.json`, `${JSON.stringify(market, null, 2)}\n`);
console.log(`\nwritten to ${DATA}/market.json — ${Object.keys(market.cards).length} card link(s)`);
