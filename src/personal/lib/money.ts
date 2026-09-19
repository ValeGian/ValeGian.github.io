/**
 * Money and market value.
 *
 * Every figure the site shows comes from here, so there is one place to check when a
 * number looks wrong, and one place where the rules about which price to use live.
 */
import type { CollectionItem, Price, PriceSnapshot } from './types.ts';

const EUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const SIGNED = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const PERCENT = new Intl.NumberFormat('en-IE', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });

export const money = (value: number): string => EUR.format(value);
export const signedMoney = (value: number): string => SIGNED.format(value);
export const percent = (ratio: number): string => PERCENT.format(ratio);

export interface Quote {
  value: number;
  /** Which field the figure came from, so the screen can say when it is not the usual one. */
  basis: 'avg30' | 'avg7';
}

/**
 * What one card is worth.
 *
 * `avg30` by preference: checked against Cardmarket's own pages it agreed within 2.3%,
 * while `avg7` and `avg1` were out by up to 33%. A card too new or too thinly traded to
 * have a 30-day average falls back to the 7-day one, which is better than showing
 * nothing — but it is labelled wherever it appears, because the two are not the same
 * measurement and a reader should not have to assume.
 *
 * `low` is never used: it is the cheapest listing in any condition, which means a
 * damaged copy.
 */
export function quote(price: Price | undefined): Quote | null {
  if (typeof price?.avg30 === 'number') return { value: price.avg30, basis: 'avg30' };
  if (typeof price?.avg7 === 'number') return { value: price.avg7, basis: 'avg7' };
  return null;
}

export const marketValue = (price: Price | undefined): number | null => quote(price)?.value ?? null;

/**
 * Money is exact to the cent wherever it is produced, not only where it is formatted.
 * Binary floats make 252.58 - 140 into 112.58000000000001, which the display formatter
 * hides but comparisons and sorts do not.
 */
const cents = (value: number): number => Math.round(value * 100) / 100;

export interface Valued {
  item: CollectionItem;
  price?: Price;
  /** Null when there is no price at all; otherwise says which average was used. */
  basis: Quote['basis'] | null;
  /** Null when the card has no price yet, which is not the same as being worth nothing. */
  value: number | null;
  paid: number;
  gain: number | null;
  ratio: number | null;
}

export function value(item: CollectionItem, snapshot: PriceSnapshot | null): Valued {
  const price = item.cardId ? snapshot?.prices[item.cardId] : undefined;
  const reading = quote(price);
  const unit = reading?.value ?? null;
  const paid = cents(item.purchase.amountEur * item.quantity);
  const total = unit === null ? null : cents(unit * item.quantity);

  return {
    item,
    price,
    basis: reading?.basis ?? null,
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
