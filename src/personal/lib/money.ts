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
export type Basis = 'avg1' | 'avg7' | 'avg30' | 'trend';

/**
 * What everything is valued and charted on unless the reader picks otherwise.
 *
 * `trend` since 5 October 2026, and the reasoning is on `quote` below. One constant
 * rather than a default repeated at every call site, because the whole point of the
 * previous arrangement going wrong was that the basis is a decision, not a parameter
 * each function happens to have an opinion about.
 */
export const DEFAULT_BASIS: Basis = 'trend';

export interface Quote {
  value: number;
  /** Which field the figure actually came from, so the screen can say when it is not the one asked for. */
  basis: Basis;
  /** True when the figure was read off Cardmarket by hand rather than taken from the catalog. */
  handRead?: boolean;
}

/**
 * Whether a figure was read off Cardmarket rather than taken from the catalog.
 *
 * Only affects how it is described. Both are the same measurement; the catalog's averages
 * are the ones that stopped being refreshed (PLAN.md §8.4) and so may be days behind.
 */
const isHandRead = (price: Price): boolean => price.source === 'cardmarket/manual';

/**
 * What to reach for when the measure asked for is not in the record.
 *
 * Nearest window first, and never `low` — that is the cheapest listing in any condition,
 * which usually means a damaged copy. The screen always says which one it ended up with,
 * so a substitution is visible rather than silent.
 */
const FALLBACKS: Record<Basis, Basis[]> = {
  avg1: ['avg1', 'avg7', 'avg30', 'trend'],
  avg7: ['avg7', 'avg30', 'avg1', 'trend'],
  avg30: ['avg30', 'trend', 'avg7'],
  trend: ['trend', 'avg30', 'avg7', 'avg1'],
};

/**
 * What one card is worth, on the measure the reader asked for.
 *
 * The default is `trend`, and that reverses a decision taken on 20 September. It is worth
 * setting out both measurements, because neither reading on its own settles it.
 *
 * In September, with the catalog's averages a few days old, the stale average was much
 * the closer estimate of Cardmarket's real 30-day figure and `trend` was far below it:
 *
 *   SV2a-201   true 397.08   stale avg30 399.08  +0.5%   trend 357.63   -9.9%
 *   M6-110     true 388.36   stale avg30 436.50 +12.4%   trend 297.77  -23.3%
 *   S12a-212   true 104.46   stale avg30 109.69  +5.0%   trend  75.17  -28.0%
 *
 * By 4 October the averages had not moved for thirteen days, and the same comparison on
 * the four most valuable cards in the collection came out level:
 *
 *   SV2a-201   true 373.34   stale avg30 397.08  +6.4%   trend 332.49  -10.9%
 *   S12a-261   true 256.84   stale avg30 258.62  +0.7%   trend 256.68   -0.1%
 *   SV1a-080   true 150.19   stale avg30 168.03 +11.9%   trend 145.70   -3.0%
 *   SV1S-101   true 157.87   stale avg30 158.27  +0.3%   trend 165.36   +4.7%
 *   total      true 938.24   stale avg30 982.00  +4.7%   trend 900.23   -4.1%
 *
 * So the error in the stale average is not bounded by how fast a card moves after all —
 * it is bounded by how long the catalog has been dead, and that is outside our control
 * and has only grown. `trend` is wrong by about as much today and its error does not
 * accumulate. The deciding argument is not accuracy, which is a draw: it is that a dead
 * field draws a flat line, and a flat line reads as a stable market rather than as a
 * broken feed.
 *
 * What this costs, stated plainly: `trend` is a different measure, not a fresher avg30.
 * The median gap between them across the watchlist is 9.8%, the switch itself moved the
 * collection's headline by -5.7% with no market behind it, and on the single most
 * valuable card trend sits 10.9% under the real 30-day average. The 30-day average is
 * still kept, still charted on request, and shown beside the headline with the date it
 * last moved, so the second opinion is one tap away and its staleness is on screen.
 *
 * `low` is never used: it is the cheapest listing in any condition, which means a
 * damaged copy.
 */
export function quote(price: Price | undefined, want: Basis = DEFAULT_BASIS): Quote | null {
  if (!price) return null;

  for (const basis of FALLBACKS[want] ?? FALLBACKS.avg30) {
    const value = price[basis];
    if (typeof value === 'number') return { value, basis, handRead: isHandRead(price) };
  }

  return null;
}

/**
 * What someone typed into a price field, as a number.
 *
 * Deliberately forgiving about how an amount is written and unforgiving about what it
 * means: "1.200", "1,200" and "1 200" are all twelve hundred yen in a shop, and a comma
 * is the decimal point in Italian, so both separators are accepted and the last one wins
 * when it looks like a decimal fraction. Anything that does not come out as a positive
 * number is rejected rather than guessed at — a mistyped price becomes a wrong purchase
 * price, and those are what the whole gain column is built on.
 */
export function parseAmount(text: string): number | null {
  // Checked before the sign is stripped away with everything else: "-5" is not 5.
  if (text.includes('-')) return null;

  const trimmed = text.trim().replace(/[^\d.,]/g, '');
  if (!trimmed) return null;

  // The last separator is the decimal point only when it leaves one or two digits after
  // it; "1.200" is a thousands separator, "1.20" is not.
  const match = trimmed.match(/^(.*)[.,](\d{1,2})$/);
  const whole = (match ? match[1] : trimmed).replace(/[.,]/g, '');
  const value = Number(match ? `${whole}.${match[2]}` : whole);

  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

export const marketValue = (price: Price | undefined, want: Basis = DEFAULT_BASIS): number | null =>
  quote(price, want)?.value ?? null;

/**
 * What to call the figure on screen.
 *
 * Said in full wherever a price appears, because the site now mixes three measures and a
 * reader should never have to guess which one a number is.
 */
const NAMES: Record<Basis, string> = {
  avg1: '1-day average',
  avg7: '7-day average',
  avg30: '30-day average',
  trend: 'price trend',
};

/** The measure's own name, with nothing said about where the figure came from. */
export const basisName = (basis: Basis): string => NAMES[basis];

export function basisLabel(reading: { basis: Basis | null; handRead?: boolean } | null): string {
  // A reading can exist with no usable figure in it — a catalog entry whose averages and
  // trend are all null — and calling that a 30-day average would be a lie on the screen.
  if (!reading || reading.basis === null) return 'no price';
  // Live for every card, so there is no freshness to qualify.
  if (reading.basis === 'trend') return NAMES.trend;

  // Which of the two an average is matters: the catalog's stopped refreshing, and a
  // reader has no other way to tell a fresh figure from one that is days behind.
  return `${NAMES[reading.basis]}, ${reading.handRead ? 'read by hand' : 'catalog — may be behind'}`;
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

export function value(item: CollectionItem, snapshot: PriceSnapshot | null, want: Basis = DEFAULT_BASIS): Valued {
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
