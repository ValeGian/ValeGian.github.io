/**
 * Loads everything the personal area renders, and stitches it together.
 *
 * Prices, names and catalog overrides are public files; the collection and the wishlists
 * arrive already decrypted from the unlock step. Nothing here needs a key.
 */
import { toEnglish } from '../../lib/card-name.mjs';
import type { CollectionItem, PriceSnapshot, WishlistItem } from './types.ts';

export interface NameTable {
  species: Record<string, string>;
  ownerPrefixes?: Record<string, string>;
}

export interface CatalogOverride {
  cardId: string;
  setName?: string;
  nameJa?: string;
  nameEn?: string;
  cardmarketUrl?: string;
  reason: string;
}

export interface PublicData {
  prices: PriceSnapshot | null;
  names: NameTable;
  overrides: Map<string, CatalogOverride>;
  /** Card id to artwork base, for cards the catalog had no picture for when they were added. */
  artwork: Map<string, string>;
}

/**
 * Artwork the daily job has since found, by card id.
 *
 * Held here rather than passed to every view. `picture` is called from the thumbnail,
 * the detail panel, the lightbox and the search results, and threading one presentational
 * lookup through all of them would be more plumbing than the lookup is worth. It is set
 * once when the public data loads and read nowhere else.
 */
let discoveredArtwork = new Map<string, string>();

export function usePublishedArtwork(artwork: Map<string, string>): void {
  discoveredArtwork = artwork;
}

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) return fallback;
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function loadPublicData(): Promise<PublicData> {
  const [prices, names, overrides, artwork] = await Promise.all([
    getJson<PriceSnapshot | null>('/data/prices/latest.json', null),
    getJson<NameTable>('/data/card-names.json', { species: {} }),
    getJson<{ cards: CatalogOverride[] }>('/data/catalog-overrides.json', { cards: [] }),
    getJson<{ cards: Record<string, string> }>('/data/artwork.json', { cards: {} }),
  ]);

  const found = new Map(Object.entries(artwork.cards));
  usePublishedArtwork(found);

  return {
    prices,
    names,
    overrides: new Map(overrides.cards.map((card) => [card.cardId, card])),
    artwork: found,
  };
}

/**
 * The name to show. The spreadsheet's English names are kept where they exist because
 * they are what the owner recognises; otherwise the Japanese name is translated, and if
 * that fails the Japanese name stands rather than a guess.
 */
export function displayName(item: CollectionItem | WishlistItem, names: NameTable): string {
  if (item.nameEn) return item.nameEn;
  if (item.nameJa) return toEnglish(item.nameJa, names);
  if ('hint' in item && item.hint) return item.hint.nameEn ?? item.hint.nameJa ?? 'Unidentified card';
  return 'Unidentified card';
}

export const subtitle = (item: CollectionItem | WishlistItem): string => {
  if (item.setId && item.number) return `${item.setId} ${item.number}`;
  if ('hint' in item && item.hint) return `${item.hint.setCode} ${item.hint.number}`;
  // A card whose catalog entry is a hand-written override carries no set fields of its
  // own; its id still says which printing it is.
  if (item.cardId) return item.cardId.replace('-', ' ');
  return '';
};

/**
 * Where a card's artwork lives.
 *
 * TCGdex's `image` field is not reliable: `SV10-127` has no image in the API while the
 * file is served perfectly well, so trusting the field left a whole set blank. The path
 * is predictable — series letters, set id, number — so it is derived when the API has
 * nothing, and the caller's error handler deals with the cases where the file really is
 * absent. Guessing and falling back beats not asking.
 */
function derivedBase(item: { cardId?: string; setId?: string; number?: string }): string | null {
  const setId = item.setId ?? item.cardId?.split('-')[0];
  const number = item.number ?? item.cardId?.split('-').slice(1).join('-');
  if (!setId || !number) return null;

  const series = setId.match(/^[A-Za-z]+/)?.[0];
  if (!series) return null;

  return `https://assets.tcgdex.net/ja/${series}/${setId}/${number}`;
}

/** True when the stored value is a finished image rather than a base to append a size to. */
const isCompleteImage = (url: string): boolean => /\.(jpe?g|png|webp)$/i.test(url);

type Illustrated = {
  imageBase?: string;
  photoUrl?: string;
  cardId?: string;
  setId?: string;
  number?: string;
};

/**
 * Which picture to show, in order of how much it can be trusted.
 *
 * Artwork the daily job has found comes first, because it is the most recent thing anyone
 * has actually checked: a Japanese set is listed with prices long before its cards are
 * scanned, so a card added on release day is stored with no picture, or with a stand-in
 * from the English printing, and this is what replaces it. Then what was stored when the
 * card was added.
 *
 * Then a photograph, which only exists because someone looked and found nothing — TCGdex
 * has never digitised the 1996 Japanese base set and carries no Pokémon Card Game Classic
 * at all, so for those cards a photo is the only picture there will ever be. A guessed
 * path comes last, because it is a guess.
 */
export function picture(item: Illustrated, size: 'low' | 'high'): string | null {
  // Keyed the same way a price is, so a card the catalog has not published yet picks up
  // its real artwork the day the daily job finds it — see priceKey.
  const key = priceKey(item);
  const found = key ? discoveredArtwork.get(key) : undefined;
  if (found) return `${found}/${size}.webp`;
  // TCGdex serves a base path and wants a size appended; the official Japanese card
  // database serves one finished file. A value that already names a file is used as it is.
  if (item.imageBase) return isCompleteImage(item.imageBase) ? item.imageBase : `${item.imageBase}/${size}.webp`;
  if (item.photoUrl) return item.photoUrl;
  const derived = derivedBase(item);
  return derived ? `${derived}/${size}.webp` : null;
}

export const thumbnail = (item: Illustrated): string | null => picture(item, 'low');
export const fullImage = (item: Illustrated): string | null => picture(item, 'high');

/**
 * The key a card's price is filed under.
 *
 * Normally its catalog id. A card the catalog has not published yet has none, but it can
 * still have a price — read off Cardmarket by hand — and that is filed under set code and
 * number, which is exactly the id the card will be given when the catalog catches up. So
 * the figure is already on screen before TCGdex has ever heard of the card, and nothing
 * has to be re-filed when it does.
 */
export function priceKey(item: {
  cardId?: string;
  setId?: string;
  number?: string;
  hint?: { setCode: string; number: string };
}): string | null {
  if (item.cardId) return item.cardId;
  if (item.setId && item.number) return `${item.setId}-${item.number}`;
  if (item.hint) return `${item.hint.setCode}-${item.hint.number}`;
  return null;
}

/** How old the price data is, in whole days, or null when there is none. */
export function stalenessDays(snapshot: PriceSnapshot | null): number | null {
  if (!snapshot) return null;
  return Math.floor((Date.now() - Date.parse(snapshot.generatedAt)) / 86_400_000);
}
