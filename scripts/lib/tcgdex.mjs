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
 * A 5xx from TCGdex is usually a blip, and the daily job must not lose a day of history
 * to one. Retries those with exponential backoff; a 4xx is a real answer and is not
 * retried.
 */
async function get(path) {
  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (attempt > 0) await pause(2 ** attempt * 250);

    try {
      const response = await fetch(`${BASE}/${path}`, {
        headers: { 'User-Agent': 'valegian.github.io collection tooling' },
      });
      if (response.ok) return response.json();
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
