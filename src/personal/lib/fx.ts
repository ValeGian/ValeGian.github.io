/**
 * Exchange rates, looked up once and then frozen.
 *
 * The rate that matters is the one on the day the card was bought, so it is fetched for
 * that date and written into the purchase record. Nothing recomputes it later: a card
 * bought at ¥1 = €0.00553 cost what it cost, whatever the rate does afterwards.
 *
 * Frankfurter serves European Central Bank reference rates, free, with no key.
 */
import type { Currency, Purchase } from './types.ts';

const ENDPOINT = 'https://api.frankfurter.dev/v1';

export interface Converted {
  amountEur: number;
  fxRate: number;
  /** The date the rate is actually from — ECB publishes on business days only. */
  rateDate: string;
}

const cache = new Map<string, Converted>();

export async function convert(amount: number, currency: Currency, date: string): Promise<Converted> {
  if (currency === 'EUR') return { amountEur: round2(amount), fxRate: 1, rateDate: date };

  const key = `${currency}|${date}`;
  const cached = cache.get(key);
  if (cached) return { ...cached, amountEur: round2(amount * cached.fxRate) };

  const response = await fetch(`${ENDPOINT}/${date}?base=${currency}&symbols=EUR`);
  if (!response.ok) throw new Error(`Could not get the ${currency} rate for ${date} (${response.status})`);

  const body = (await response.json()) as { date: string; rates: { EUR?: number } };
  const fxRate = body.rates.EUR;
  if (typeof fxRate !== 'number') throw new Error(`No EUR rate published for ${date}`);

  const result = { amountEur: round2(amount * fxRate), fxRate, rateDate: body.date };
  cache.set(key, result);
  return result;
}

type Converter = typeof convert;

/** A purchase made on `date`, priced in euros at that day's rate. */
export async function purchaseAt(
  amount: number,
  currency: Currency,
  date: string,
  convertAt: Converter = convert,
): Promise<Purchase> {
  const converted = await convertAt(amount, currency, date);
  return {
    date,
    amount,
    currency,
    amountEur: converted.amountEur,
    fxRate: converted.fxRate,
    fxSource: currency === 'EUR' ? 'identity' : 'frankfurter',
  };
}

export interface PurchaseChange {
  amount: number;
  currency: Currency;
  date: string;
}

/**
 * A purchase with its amount, currency or date corrected.
 *
 * A rate belongs to a currency on a given day, so it is fetched again only when one of
 * those two changes. Fixing a typo in the amount keeps the rate on record. That matters
 * when the rate was written down at the time rather than looked up. It also means the fix
 * works offline, in the shop where the typo was made.
 */
export async function revisePurchase(
  previous: Purchase,
  change: PurchaseChange,
  convertAt: Converter = convert,
): Promise<Purchase> {
  const isSameDay = change.date === previous.date;
  const isSameRate = isSameDay && change.currency === previous.currency;

  if (isSameRate) {
    // Untouched, it is returned as recorded: an imported amountEur may not be exactly
    // amount × rate, and an edit to something else must not restate it.
    if (change.amount === previous.amount) return previous;
    return { ...previous, amount: change.amount, amountEur: round2(change.amount * previous.fxRate) };
  }

  return {
    ...previous,
    ...(await purchaseAt(change.amount, change.currency, change.date, convertAt)),
    // The import placeholder no longer stands in once a real date has been given.
    dateIsBootstrap: isSameDay ? previous.dateIsBootstrap : false,
  };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
