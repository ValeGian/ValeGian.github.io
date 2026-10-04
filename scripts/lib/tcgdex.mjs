/**
 * Thin TCGdex client.
 *
 * TCGdex publishes no hard rate limit and asks callers to cache rather than re-fetch,
 * so set listings are held for the life of the process and card lookups are paced.
 */
const BASE = 'https://api.tcgdex.net/v2/ja';
const PACE_MS = 150;
const RETRIES = 4;

const setListing = new Map();
let sets;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How many times a 404 is asked again before it is believed.
 *
 * A 404 is normally an answer, and asking twice only wastes time. TCGdex is the exception:
 * `eu` is served by several machines and they do not all carry a new set at the same
 * moment. M6a was published on 28 September 2026, and from the 29th every card in it
 * answered 404 to GitHub's runners while the same request from a laptop in Europe
 * answered 200 — sixty-eight 404s in CI against twenty-six consecutive 200s here. That
 * cost five days of history before the guard above it stopped refusing thin days.
 *
 * So a 404 is tried once more, after a pause long enough to stand a chance of landing on
 * a different machine. Twice is the whole budget: if a card genuinely does not exist,
 * every run would otherwise pay the delay for it forever.
 */
const NOT_FOUND_RETRIES = 1;
const NOT_FOUND_PAUSE_MS = 1200;

/**
 * A 5xx from TCGdex is usually a blip, and the daily job must not lose a day of history
 * to one. Retries those with exponential backoff. A 404 gets one second chance, for the
 * reason above; any other 4xx is a real answer and is taken at its word.
 */
async function get(path) {
  let lastError;
  let notFound = 0;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0) await pause(2 ** attempt * 250);

    try {
      const response = await fetch(`${BASE}/${path}`, {
        headers: { 'User-Agent': 'valegian.github.io collection tooling' },
      });
      if (response.ok) return response.json();

      if (response.status === 404 && notFound < NOT_FOUND_RETRIES) {
        notFound += 1;
        lastError = new Error(`TCGdex ${path} responded 404`);
        await pause(NOT_FOUND_PAUSE_MS);
        continue;
      }

      if (response.status < 500) {
        throw new Error(`TCGdex ${path} responded ${response.status}`);
      }
      lastError = new Error(`TCGdex ${path} responded ${response.status}`);
    } catch (error) {
      if (error.message?.includes('responded 4')) throw error;
      lastError = error;
    }
  }

  throw new Error(`TCGdex ${path} failed after ${RETRIES + 1} attempts: ${lastError.message}`);
}

/** Set ids as TCGdex spells them, keyed lowercase so spreadsheet casing does not matter. */
export async function setIndex() {
  if (!sets) {
    const listing = await get('sets');
    sets = new Map(listing.map((set) => [set.id.toLowerCase(), set.id]));
  }
  return sets;
}

export async function cardsInSet(setId) {
  if (!setListing.has(setId)) {
    const set = await get(`sets/${setId}`);
    setListing.set(setId, set.cards);
    await pause(PACE_MS);
  }
  return setListing.get(setId);
}

/** TCGdex zero-pads local ids; the spreadsheet does not. Compare without the padding. */
export async function findCard(setId, number) {
  const wanted = String(number).replace(/^0+/, '');
  const cards = await cardsInSet(setId);
  return cards.find((card) => card.localId.replace(/^0+/, '') === wanted);
}

export async function card(cardId) {
  const detail = await get(`cards/${cardId}`);
  await pause(PACE_MS);
  return detail;
}

/**
 * Which printing of a card to value.
 *
 * Pricing hangs off the variant, not the card, so picking the card and ignoring the
 * variant silently values a different product. With one variant there is no decision.
 * With several, prefer one that Cardmarket actually lists, and report the rest as
 * ambiguous rather than guessing quietly.
 */
export function chooseVariant(detail) {
  const variants = detail.variants_detailed ?? [];
  const priced = variants.filter((variant) => variant.pricing?.cardmarket);

  if (priced.length === 1) return { variant: priced[0], priced: true, ambiguous: false };
  if (priced.length > 1) {
    return { variant: priced[0], priced: true, ambiguous: true, alternatives: priced.length };
  }

  // Nothing here is priced, so the choice cannot be wrong and cannot be useful either.
  // The card needs a manual price override; see public/data/catalog-overrides.json.
  return { variant: null, priced: false, ambiguous: false, unpriced: variants.length > 0 };
}

export const cardmarketPrice = (variant) => variant?.pricing?.cardmarket ?? null;
