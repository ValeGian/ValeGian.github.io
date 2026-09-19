/**
 * Searching the catalog from the browser.
 *
 * TCGdex holds Japanese cards under Japanese names, but the name that comes to mind in a
 * shop is usually the English one. So an English query is translated to the Japanese
 * species name first, using the same table the display names come from, and the search
 * runs on that.
 */
import type { NameTable } from './data.ts';

const BASE = 'https://api.tcgdex.net/v2/ja';
const LIMIT = 24;

export interface CardHit {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

export interface CardDetail extends CardHit {
  rarity?: string | null;
  set: { id: string; name: string };
  variants_detailed?: {
    variantId: string;
    type: string;
    pricing?: { cardmarket?: unknown };
  }[];
}

const hasLatin = (text: string): boolean => /[a-z]/i.test(text);

/**
 * A card id as TCGdex writes it: set id, a dash, a number. Worth recognising, because
 * the code printed on the card is what is in front of you in a shop.
 */
export const looksLikeCardId = (text: string): boolean => /^[A-Za-z0-9.+]{1,12}-?\s?[0-9]{1,4}[A-Za-z]?$/.test(text.trim());

/** Normalises `sv2a 201`, `SV2a-201` and `sv2a201` to the id TCGdex expects. */
function toCardId(text: string): string | null {
  const match = text.trim().match(/^([A-Za-z0-9.+]{1,12}?)[-\s]?([0-9]{1,4}[A-Za-z]?)$/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(3, '0')}`;
}

/**
 * English query to Japanese species names.
 *
 * "Charizard ex" is not a species, so the whole string never matches. Each word is tried
 * and the matches collected, which also handles "Mega Rayquaza" finding Rayquaza.
 */
function japaneseCandidates(query: string, names: NameTable): string[] {
  const reversed = new Map<string, string>();
  for (const [japanese, english] of Object.entries(names.species)) {
    reversed.set(english.toLowerCase(), japanese);
  }

  const whole = reversed.get(query.trim().toLowerCase());
  if (whole) return [whole];

  const found = query
    .toLowerCase()
    .split(/[\s-]+/)
    .map((word) => reversed.get(word))
    .filter((value): value is string => Boolean(value));

  return [...new Set(found)];
}

async function query(name: string): Promise<CardHit[]> {
  const response = await fetch(
    `${BASE}/cards?name=like:${encodeURIComponent(name)}&pagination:itemsPerPage=${LIMIT}`,
  );
  if (!response.ok) throw new Error(`Catalog search failed (${response.status})`);
  return (await response.json()) as CardHit[];
}

export async function searchCards(text: string, names: NameTable): Promise<CardHit[]> {
  const trimmed = text.trim();
  if (trimmed.length < 2) return [];

  // A pasted card id is an exact answer; try it before guessing at names.
  if (looksLikeCardId(trimmed)) {
    const id = toCardId(trimmed);
    if (id) {
      try {
        const exact = await cardDetail(id);
        return [{ id: exact.id, localId: exact.localId, name: exact.name, image: exact.image }];
      } catch {
        // Not a real id after all; fall through and treat it as a name.
      }
    }
  }

  const terms = hasLatin(trimmed) ? japaneseCandidates(trimmed, names) : [trimmed];
  if (terms.length === 0) {
    // Nothing recognisable as a species; try it verbatim in case it is a trainer or an
    // item card, whose names are not in the species table.
    terms.push(trimmed);
  }

  const results = await Promise.all(terms.map((term) => query(term).catch(() => [])));
  const unique = new Map<string, CardHit>();
  for (const hit of results.flat()) unique.set(hit.id, hit);

  // Cards TCGdex has no artwork for sort last. Ordering by id put the 1996 sets first,
  // so the first screenful of any search was blank frames — the cards least likely to
  // be the one in your hand.
  return [...unique.values()].sort((a, b) => {
    const art = Number(Boolean(b.image)) - Number(Boolean(a.image));
    return art !== 0 ? art : a.id.localeCompare(b.id);
  });
}

export async function cardDetail(cardId: string): Promise<CardDetail> {
  const response = await fetch(`${BASE}/cards/${encodeURIComponent(cardId)}`);
  if (!response.ok) throw new Error(`Could not load ${cardId} (${response.status})`);
  return (await response.json()) as CardDetail;
}

/**
 * The printing to record.
 *
 * Pricing hangs off the variant, so storing a card without one values a different
 * product. When nothing is priced there is no useful choice, and the card falls through
 * to a manual override instead.
 */
export function pricedVariantId(detail: CardDetail): string | undefined {
  const priced = (detail.variants_detailed ?? []).filter((variant) => variant.pricing?.cardmarket);
  return priced[0]?.variantId;
}
