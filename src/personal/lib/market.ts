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
 * Cardmarket's own search URL, as the site produces it.
 *
 * `searchMode=v2` is not decoration: without it the same URL answers "no matches" for a
 * query that works with it. The search term is the card's number rather than its name,
 * because a name search inside a Japanese expansion returns nothing at all — measured on
 * 2026-09-20 against Pokémon Card 151, where "Charizard" found nothing and "201" found
 * exactly one product, `Charizard-ex-V3-sv2a201`.
 */
function cardmarketSearch(slug: string, number: string): string {
  const term = String(Number(number));
  return `https://www.cardmarket.com/en/Pokemon/Products/Singles/${slug}?searchString=${encodeURIComponent(term)}&searchMode=v2`;
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

  return { cardmarket, pricecharting };
}
