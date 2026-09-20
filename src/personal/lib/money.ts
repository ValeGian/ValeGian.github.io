/**
 * Money and market value.
 *
 * Every figure the site shows comes from here, so there is one place to check when a
 * number looks wrong, and one place where the rules about which price to use live.
 */
import { priceKey } from './data.ts';
import type { CollectionItem, Price, PriceSnapshot } from './types.ts';

const EUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const SIGNED = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const PERCENT = new Intl.NumberFormat('en-IE', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });

export const money = (value: number): string => EUR.format(value);
export const signedMoney = (value: number): string => SIGNED.format(value);
export const percent = (ratio: number): string => PERCENT.format(ratio);

/** Which figure the reader asked to see. Not necessarily the one they get — see quote. */
export type Basis = 'avg30' | 'trend';

export interface Quote {
  value: number;
  /** Which field the figure actually came from, so the screen can say when it is not the one asked for. */
  basis: 'avg30' | 'avg7' | 'trend';
  /** True when avg30 was read off Cardmarket by hand rather than taken from the catalog. */
  handRead?: boolean;
}

/**
 * Whether a 30-day average was read off Cardmarket rather than taken from the catalog.
 *
 * Only affects how the figure is described. Both are 30-day averages; the catalog's is
 * the one that stopped being refreshed (PLAN.md §8.4) and so may be days behind.
 */
const isHandRead = (price: Price): boolean => price.source === 'cardmarket/manual';

/**
 * What one card is worth, on the measure the reader asked for.
 *
 * Asking for `avg30` gives a 30-day average — a hand-read one where it exists, otherwise
 * the catalog's, which is stale but is still that measurement.
 *
 * It is worth saying why it is not replaced by `trend`, because that was tried and it was
 * a mistake. TCGdex's averages have stopped moving, so the obvious fix looked like
 * substituting the field that still moves. Measured against Cardmarket's real 30-day
 * average on three cards, the stale average is far closer than the trend is:
 *
 *   SV2a-201   true 397.08   stale avg30 399.08  +0.5%   trend 357.63   -9.9%
 *   M6-110     true 388.36   stale avg30 436.50 +12.4%   trend 297.77  -23.3%
 *   S12a-212   true 104.46   stale avg30 109.69  +5.0%   trend  75.17  -28.0%
 *
 * A stale reading of the right measure beats a live reading of a different one. So the
 * substitution is gone: `avg30` means `avg30`, the screen says when it came from the
 * catalog, and `trend` is shown only when it is asked for.
 *
 * `low` is never used: it is the cheapest listing in any condition, which means a
 * damaged copy.
 */
export function quote(price: Price | undefined, want: Basis = 'avg30'): Quote | null {
  if (!price) return null;

  const average = typeof price.avg30 === 'number' ? price.avg30 : null;
  const trend = typeof price.trend === 'number' ? price.trend : null;

  if (want === 'trend' && trend !== null) return { value: trend, basis: 'trend' };
  if (average !== null) return { value: average, basis: 'avg30', handRead: isHandRead(price) };
  if (trend !== null) return { value: trend, basis: 'trend' };
  if (typeof price.avg7 === 'number') return { value: price.avg7, basis: 'avg7' };
  return null;
}

export const marketValue = (price: Price | undefined, want: Basis = 'avg30'): number | null =>
  quote(price, want)?.value ?? null;

/**
 * What to call the figure on screen.
 *
 * Said in full wherever a price appears, because the site now mixes three measures and a
 * reader should never have to guess which one a number is.
 */
export function basisLabel(reading: Quote | { basis: Quote['basis']; handRead?: boolean } | null): string {
  if (!reading) return 'no price';
  if (reading.basis === 'avg7') return '7-day average, all conditions';
  if (reading.basis === 'trend') return 'price trend';
  // Said plainly, because the catalog's averages stopped refreshing and a reader has no
  // other way to know which of the two they are looking at.
  return reading.handRead ? '30-day average, read by hand' : '30-day average, catalog — may be behind';
}

/**
 * Money is exact to the cent wherever it is produced, not only where it is formatted.
 * Binary floats make 252.58 - 140 into 112.58000000000001, which the display formatter
 * hides but comparisons and sorts do not.
 */
const cents = (value: number): number => Math.round(value * 100) / 100;

export interface Valued {
  item: CollectionItem;
  price?: Price;
  /** Null when there is no price at all; otherwise says which figure was used. */
  basis: Quote['basis'] | null;
  /** True when the 30-day average was read off Cardmarket rather than taken from the catalog. */
  handRead?: boolean;
  /** Null when the card has no price yet, which is not the same as being worth nothing. */
  value: number | null;
  paid: number;
  gain: number | null;
  ratio: number | null;
}

export function value(item: CollectionItem, snapshot: PriceSnapshot | null, want: Basis = 'avg30'): Valued {
  // Also finds a hand-read price for a card the catalog has not published — see priceKey.
  const key = priceKey(item);
  const price = key ? snapshot?.prices[key] : undefined;
  const reading = quote(price, want);
  const unit = reading?.value ?? null;
  const paid = cents(item.purchase.amountEur * item.quantity);
  const total = unit === null ? null : cents(unit * item.quantity);

  return {
    item,
    price,
    basis: reading?.basis ?? null,
    handRead: reading?.handRead,
    value: total,
    paid,
    gain: total === null ? null : cents(total - paid),
    ratio: total === null || paid === 0 ? null : total / paid - 1,
  };
}

export interface Totals {
  cards: number;
  paid: number;
  /** Only cards that have a price. Unpriced ones are counted separately, never as zero. */
  valued: number;
  unpriced: number;
  gain: number;
  ratio: number | null;
}

export function totals(valuedItems: Valued[]): Totals {
  const priced = valuedItems.filter((entry) => entry.value !== null);
  const paidForPriced = cents(priced.reduce((sum, entry) => sum + entry.paid, 0));
  const valued = cents(priced.reduce((sum, entry) => sum + (entry.value ?? 0), 0));

  return {
    cards: valuedItems.reduce((sum, entry) => sum + entry.item.quantity, 0),
    paid: cents(valuedItems.reduce((sum, entry) => sum + entry.paid, 0)),
    valued,
    unpriced: valuedItems.length - priced.length,
    gain: cents(valued - paidForPriced),
    ratio: paidForPriced === 0 ? null : valued / paidForPriced - 1,
  };
}
