/**
 * Opens every harvested market link and checks it is the card it claims to be.
 *
 * A link that quietly points at another printing is the failure this whole mechanism
 * exists to avoid, so the links are not trusted because they were harvested carefully —
 * they are fetched and read back. The page's own title has to carry the card's name and
 * its number.
 *
 * Only PriceCharting is checked. Cardmarket refuses non-browser clients and getting
 * around that is out of bounds, so its links are verified in the browser instead; what
 * this does for Cardmarket is report which expansion slugs have never been confirmed.
 *
 *   node scripts/check-market-links.mjs [--limit 20]
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const DATA = 'public/data';
const PAUSE_MS = 900;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const { values: options } = parseArgs({ options: { limit: { type: 'string' } } });

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Page titles arrive with HTML entities in them; `&#39;` is an apostrophe, not a 39. */
const unescapeHtml = (text) =>
  text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const normalise = (text) =>
  unescapeHtml(decodeURIComponent(text))
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** What the collection and the wishlists say each card is. */
async function knownCards() {
  const cards = new Map();
  const add = (item) => {
    const fromId = item.cardId?.match(/^(.+)-([^-]+)$/);
    const setId = item.setId ?? fromId?.[1];
    const number = item.number ?? fromId?.[2];
    if (!setId || !number) return;
    cards.set(item.cardId ?? `${setId}-${number}`, { setId, number, nameEn: item.nameEn ?? null });
  };

  for (const item of (await readJson('.local/collection.json')).items) add(item);
  const dir = '.local/wishlists';
  if (existsSync(dir)) {
    for (const name of (await readdir(dir)).filter((file) => file.endsWith('.json'))) {
      for (const item of (await readJson(`${dir}/${name}`)).items) add(item);
    }
  }
  return cards;
}

const market = await readJson(`${DATA}/market.json`);
const cards = await knownCards();

const entries = Object.entries(market.cards).filter(([, links]) => links.pricecharting);
const checking = options.limit ? entries.slice(0, Number(options.limit)) : entries;

console.log(`checking ${checking.length} PriceCharting link(s)\n`);

const wrong = [];
const expected = [];
let checked = 0;

for (const [key, links] of checking) {
  const card = cards.get(key);
  try {
    const response = await fetch(links.pricecharting, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) {
      wrong.push(`${key}: HTTP ${response.status}`);
      continue;
    }

    const html = await response.text();
    const title = normalise(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '');
    checked += 1;

    // The title reads "<Set> <Card> #<number> Prices …", so both have to be in it.
    const hasNumber = !card || title.includes(`-${Number(card.number)}-`) || title.endsWith(`-${Number(card.number)}`);
    const hasName = !card?.nameEn || title.includes(normalise(card.nameEn));

    if (hasName && hasNumber) continue;

    // A link a person opened and accepted stays accepted: the two sites genuinely
    // disagree about a few names and numbers, and the note on the card says how.
    if (links.note) {
      expected.push(`${key}: ${links.note}`);
      continue;
    }

    wrong.push(`${key} (${card?.nameEn ?? '?'} ${card?.number ?? '?'}): its page is titled "${title}"`);
  } catch (error) {
    wrong.push(`${key}: ${error.message}`);
  }

  await pause(PAUSE_MS);
}

console.log(`opened        ${checked}/${checking.length}`);
console.log(`confirmed by hand, and still differing as noted: ${expected.length}`);
for (const line of expected) console.log(`  ${line}`);
console.log(`unexplained disagreements ${wrong.length}`);
for (const problem of wrong) console.error(`  ${problem}`);

const unconfirmed = Object.entries(market.sets)
  .filter(([, entry]) => entry.cardmarket && !entry.cardmarket.checkedOn)
  .map(([setId]) => setId);
if (unconfirmed.length > 0) {
  console.log(`\nCardmarket expansion slugs never confirmed in a browser: ${unconfirmed.join(', ')}`);
}

process.exit(wrong.length > 0 ? 1 : 0);
