/**
 * Loads everything the personal area renders, and stitches it together.
 *
 * Prices, names and catalog overrides are public files; the collection and the wishlists
 * arrive already decrypted from the unlock step. Nothing here needs a key.
 */
import { toEnglish } from '../../lib/card-name.mjs';
import type { CollectionItem, PriceSnapshot, WishlistItem } from './types';

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
  const [prices, names, overrides] = await Promise.all([
    getJson<PriceSnapshot | null>('/data/prices/latest.json', null),
    getJson<NameTable>('/data/card-names.json', { species: {} }),
    getJson<{ cards: CatalogOverride[] }>('/data/catalog-overrides.json', { cards: [] }),
  ]);

  return {
    prices,
    names,
    overrides: new Map(overrides.cards.map((card) => [card.cardId, card])),
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
  return '';
};

/**
 * TCGdex serves several sizes from one base; `low` is right for a list thumbnail.
 * Artwork can be missing while the card data exists — normal for a set published days
 * ago — so callers must handle the image failing as well as being absent.
 */
export const thumbnail = (item: { imageBase?: string }): string | null =>
  item.imageBase ? `${item.imageBase}/low.webp` : null;

export const fullImage = (item: { imageBase?: string }): string | null =>
  item.imageBase ? `${item.imageBase}/high.webp` : null;

/** How old the price data is, in whole days, or null when there is none. */
export function stalenessDays(snapshot: PriceSnapshot | null): number | null {
  if (!snapshot) return null;
  return Math.floor((Date.now() - Date.parse(snapshot.generatedAt)) / 86_400_000);
}
