/**
 * Lends the English 30th Celebration scans to the Japanese cards that have none.
 *
 * TCGdex published M6a weeks before it scanned it: every card in the set answers with a
 * null image, so a wanted card shows an empty frame. The English twin of the same set is
 * fully scanned, and it is the same artwork — only the text on it differs.
 *
 * Why this exists as a script rather than a hand-edit: a card gets its picture from
 * `artwork.json` only if someone put it there, and until now the English stand-in lived on
 * the wishlist item instead, as `imageBase`. That meant the picture belonged to whoever
 * added the card. The same card on someone else's list, added later through search, came
 * with no picture at all — which is exactly how Scraggy and Fuecoco ex ended up blank on
 * Lotad's list while they showed on Valerio's. `artwork.json` is keyed by card, so a
 * picture written here is every list's picture.
 *
 * Nothing is extrapolated. The two sets do NOT run in step — the offset is 6 across the
 * Pikachu run, then 25, 24 and 23 — so only the pairs hand-verified in
 * public/data/set-map-30th.json are used, and each one is checked against the English
 * set's own card name before its image is taken. A pair that does not match is reported
 * and skipped rather than guessed at.
 *
 * Borrowing is temporary by construction: snapshot-prices.mjs rebuilds artwork.json as
 * `{ ...previous, ...fetched }`, so the day TCGdex scans the Japanese card its own image
 * replaces the borrowed one with no action here.
 *
 *   node scripts/borrow-30th-artwork.mjs [--dry-run]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const DATA = 'public/data';
const ENGLISH_SET = 'https://api.tcgdex.net/v2/en/sets/30th';

const { values: options } = parseArgs({ options: { 'dry-run': { type: 'boolean' } } });

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const map = await readJson(`${DATA}/set-map-30th.json`);
const existing = await readJson(`${DATA}/artwork.json`);
const watchlist = (await readJson(`${DATA}/watchlist.json`)).cards;

const response = await fetch(ENGLISH_SET, {
  headers: { 'User-Agent': 'valegian.github.io collection tooling' },
});
if (!response.ok) throw new Error(`TCGdex ${ENGLISH_SET} responded ${response.status}`);
const english = new Map((await response.json()).cards.map((card) => [card.localId, card]));

const watched = new Set(watchlist.map((entry) => entry.cardId));
const japaneseSet = map.japanese.setCode;

const added = {};
const skipped = [];

for (const pair of map.pairs) {
  const cardId = `${japaneseSet}-${pair.japanese}`;

  // Only cards someone actually wants or owns. The rest would be artwork nobody looks at.
  if (!watched.has(cardId)) continue;
  // Never over a picture already on file — that one may be the real Japanese scan.
  if (existing.cards[cardId]) continue;

  const twin = english.get(pair.english);
  if (!twin) {
    skipped.push(`${cardId}: the English set has no card ${pair.english}`);
    continue;
  }
  // The guard that makes this safe to run again after either set is renumbered.
  if (twin.name !== pair.name) {
    skipped.push(`${cardId}: ${pair.english} is "${twin.name}", the map says "${pair.name}"`);
    continue;
  }
  if (!twin.image) {
    skipped.push(`${cardId}: the English ${pair.name} has no scan either`);
    continue;
  }

  added[cardId] = twin.image;
}

for (const line of skipped) console.warn(`skipped  ${line}`);
console.log(`borrowed ${Object.keys(added).length} picture(s) from the English set`);
for (const [cardId, url] of Object.entries(added)) console.log(`  ${cardId}  ${url}`);

if (options['dry-run'] || Object.keys(added).length === 0) process.exit(0);

const cards = { ...existing.cards, ...added };
await writeFile(
  `${DATA}/artwork.json`,
  `${JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      cards: Object.fromEntries(Object.entries(cards).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  )}\n`,
);
console.log(`written to ${DATA}/artwork.json`);
