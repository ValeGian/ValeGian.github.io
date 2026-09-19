/** Shapes shared across the personal area. Mirrors schemas/ — keep both in step. */

export type Condition = 'M' | 'NM' | 'EX' | 'GD' | 'LP' | 'PL' | 'PO';
export type Currency = 'EUR' | 'JPY' | 'USD';

export interface Purchase {
  date: string;
  dateIsBootstrap?: boolean;
  amount: number;
  currency: Currency;
  amountEur: number;
  fxRate: number;
  fxSource: 'user-recorded' | 'frankfurter' | 'identity';
  vendor?: string;
}

export interface CatalogHint {
  setName?: string;
  setCode: string;
  number: string;
  nameJa?: string;
  nameEn?: string;
}

export interface CollectionItem {
  id: string;
  status: 'resolved' | 'pending';
  cardId?: string;
  variantId?: string;
  setId?: string;
  number?: string;
  nameJa?: string;
  nameEn?: string;
  rarity?: string | null;
  imageBase?: string;
  catalogSource?: 'tcgdex' | 'override';
  condition: Condition;
  isGraded: false;
  quantity: number;
  purchase: Purchase;
  acquiredFrom?: string | null;
  notes?: string;
  hint?: CatalogHint;
  photoUrl?: string;
  pendingSince?: string;
}

export interface Collection {
  version: 1;
  items: CollectionItem[];
}

export interface WishlistItem {
  id: string;
  status: 'wanted' | 'bought';
  cardId?: string;
  setId?: string;
  number?: string;
  nameJa?: string;
  nameEn?: string;
  imageBase?: string;
  targetPriceEur: number | null;
  priority: 'high' | 'normal' | 'low';
  notes?: string;
  addedAt: string;
  boughtAt?: string;
  purchase?: Purchase;
  movedToItemId?: string | null;
  /** Present while the catalog has no entry for this card; see CollectionItem.hint. */
  hint?: CatalogHint;
  pendingSince?: string;
}

export interface Settlement {
  date: string;
  amountEur: number;
  note?: string;
}

export interface Wishlist {
  owner: string;
  items: WishlistItem[];
  settlements: Settlement[];
}

export interface Price {
  source: 'cardmarket/tcgdex' | 'cardmarket/manual';
  currency: Currency;
  updated: string | null;
  avg30: number | null;
  avg7?: number | null;
  avg1?: number | null;
  trend: number | null;
  low: number | null;
  avg?: number | null;
}

export interface PriceSnapshot {
  version: 1;
  date: string;
  generatedAt: string;
  prices: Record<string, Price>;
}

export type Session =
  | { role: 'admin'; collection: Collection; wishlists: Record<string, Wishlist> }
  | { role: 'friend'; owner: string; wishlist: Wishlist };
