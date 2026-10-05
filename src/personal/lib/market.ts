/**
 * Where to see a card on the two market sites.
 *
 * Both links have to land on the *Japanese* card, and a wrong one is worse than none: the
 * English printing of the same Pokémon carries a different number and a different price,
 * which is the whole trap this project keeps running into. So nothing here is guessed
 * from a name.
 *
 * - **PriceCharting** links are harvested. Its product URLs end in the Japanese collector
 *   number, but the rest of the slug carries qualifiers no rule would produce, so
 *   `scripts/resolve-links.mjs` reads each set's index once and matches by number and
 *   name. What it finds is in `market.json`.
 * - **Cardmarket** cannot be read by a script — Cloudflare refuses non-browser clients —
 *   so exact links arrive one at a time from the price bookmarklet. Until a card has one,
 *   the link is a search of the right expansion for the card's own number, which is
 *   Cardmarket's own URL shape and cannot resolve to a different card.
 * - **Mercari** is always a search, and there is nothing to harvest: it is a marketplace
 *   of individual listings, not a catalogue, so a card has no page of its own there. The
 *   query is the set code and the number — what is printed on the card and what a
 *   Japanese seller types in a title — which is why it does not need a name and cannot
 *   drift onto the English printing.
 */
import { priceKey } from './data.ts';

export interface MarketSet {
  cardmarket?: { expansion: string; expansionId: number; slug: string; checkedOn: string | null };
  pricecharting?: { slug: string; checkedOn: string | null };
}

export interface Market {
  sets: Record<string, MarketSet>;
  cards: Record<string, { cardmarket?: string; pricecharting?: string }>;
}

export interface MarketLink {
  href: string;
  /** True when this is the card's own page rather than a search that finds it. */
  isExact: boolean;
}

export interface MarketLinks {
  cardmarket: MarketLink | null;
  pricecharting: MarketLink | null;
  mercari: MarketLink | null;
}

interface Identifiable {
  cardId?: string;
  setId?: string;
  number?: string;
  nameEn?: string | null;
  hint?: { setCode: string; number: string };
}

const setOf = (item: Identifiable): string | undefined => item.setId ?? item.hint?.setCode;
const numberOf = (item: Identifiable): string | undefined => item.number ?? item.hint?.number;

/**
 * A collector number as a search term: without the padding the catalogs add.
 *
 * Not `Number(n)`, which was here before and turns a number that is not a numeral into
 * the string "NaN" — `neo4-DL` (Dark Espeon) is one, and it would have searched Cardmarket
 * for "NaN". It only escapes that today because that card's exact link was harvested by
 * hand. Anything the padding cannot be stripped from is passed through as printed.
 */
const searchNumber = (number: string): string => number.replace(/^0+(?=.)/, '');

/**
 * Cardmarket's own search URL, as the site produces it.
 *
 * `searchMode=v2` is not decoration: without it the same URL answers "no matches" for a
 * query that works with it. The search term is the card's number rather than its name,
 * because a name search inside a Japanese expansion returns nothing at all — measured on
 * 2026-09-20 against Pokémon Card 151, where "Charizard" found nothing and "201" found
 * exactly one product, `Charizard-ex-V3-sv2a201`.
 */
function cardmarketSearch(slug: string, number: string): string {
  return `https://www.cardmarket.com/en/Pokemon/Products/Singles/${slug}?searchString=${encodeURIComponent(searchNumber(number))}&searchMode=v2`;
}

/**
 * Mercari, searched the way a Japanese seller titles a listing.
 *
 * The keyword is the set code and the collector number, lowercase, because that pair is
 * what is printed on the card and what appears in a listing title — a name would be in
 * Japanese on half the listings and in English on the other half. Sorted by relevance
 * rather than price: the cheapest match for a loose keyword is usually a different card.
 *
 * Needs no market.json entry. Mercari has no page per card to harvest, so this is a
 * search for every card and is labelled as one, like any other inexact link here.
 */
function mercariSearch(setId: string, number: string): string {
  const keyword = `${setId} ${searchNumber(number)}`.toLowerCase();
  return `https://jp.mercari.com/en/search?keyword=${encodeURIComponent(keyword)}&sort=score&order=desc`;
}

/** PriceCharting's search, for a card whose page has not been harvested yet. */
function priceChartingSearch(item: Identifiable, set: MarketSet | undefined): string | null {
  const words = set?.pricecharting?.slug?.replace(/-/g, ' ') ?? 'pokemon japanese';
  const what = item.nameEn ?? numberOf(item);
  if (!what) return null;
  return `https://www.pricecharting.com/search-products?q=${encodeURIComponent(`${words} ${what}`)}&type=prices`;
}

export function marketLinks(item: Identifiable, market: Market | null): MarketLinks {
  const key = priceKey(item);
  const known = key ? market?.cards?.[key] : undefined;
  const setId = setOf(item);
  const set = setId ? market?.sets?.[setId] : undefined;
  const number = numberOf(item);

  const cardmarketSlug = set?.cardmarket?.slug;
  const cardmarket = known?.cardmarket
    ? { href: known.cardmarket, isExact: true }
    : cardmarketSlug && number
      ? { href: cardmarketSearch(cardmarketSlug, number), isExact: false }
      : null;

  const search = priceChartingSearch(item, set);
  const pricecharting = known?.pricecharting
    ? { href: known.pricecharting, isExact: true }
    : search
      ? { href: search, isExact: false }
      : null;

  // Only the set code and the number, both of which a card has before any catalog knows
  // about it, so a card waiting on TCGdex gets this link when it gets no other.
  const mercari =
    setId && number ? { href: mercariSearch(setId, number), isExact: false } : null;

  return { cardmarket, pricecharting, mercari };
}
