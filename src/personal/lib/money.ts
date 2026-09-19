/**
 * Money and market value.
 *
 * Every figure the site shows comes from here, so there is one place to check when a
 * number looks wrong, and one place where the rules about which price to use live.
 */
import type { CollectionItem, Price, PriceSnapshot } from './types';

const EUR = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const SIGNED = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const PERCENT = new Intl.NumberFormat('en-IE', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });

export const money = (value: number): string => EUR.format(value);
export const signedMoney = (value: number): string => SIGNED.format(value);
export const percent = (ratio: number): string => PERCENT.format(ratio);

/**
 * The market value of one card.
 *
 * `avg30` and nothing else. Checked against Cardmarket's own pages, it agreed within
 * 2.3% while `avg7` and `avg1` were out by up to 33%, and `low` is the cheapest listing
 * in any condition — a damaged copy — so it is never a valuation.
 */
export const marketValue = (price: Price | undefined): number | null => price?.avg30 ?? null;

export interface Valued {
  item: CollectionItem;
  price?: Price;
  /** Null when the card has no price yet, which is not the same as being worth nothing. */
  value: number | null;
  paid: number;
  gain: number | null;
  ratio: number | null;
}

export function value(item: CollectionItem, snapshot: PriceSnapshot | null): Valued {
  const price = item.cardId ? snapshot?.prices[item.cardId] : undefined;
  const unit = marketValue(price);
  const paid = item.purchase.amountEur * item.quantity;
  const total = unit === null ? null : unit * item.quantity;

  return {
    item,
    price,
    value: total,
    paid,
    gain: total === null ? null : total - paid,
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
  const paidForPriced = priced.reduce((sum, entry) => sum + entry.paid, 0);
  const valued = priced.reduce((sum, entry) => sum + (entry.value ?? 0), 0);

  return {
    cards: valuedItems.reduce((sum, entry) => sum + entry.item.quantity, 0),
    paid: valuedItems.reduce((sum, entry) => sum + entry.paid, 0),
    valued,
    unpriced: valuedItems.length - priced.length,
    gain: valued - paidForPriced,
    ratio: paidForPriced === 0 ? null : valued / paidForPriced - 1,
  };
}
