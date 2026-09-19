/**
 * Exchange rates, looked up once and then frozen.
 *
 * The rate that matters is the one on the day the card was bought, so it is fetched for
 * that date and written into the purchase record. Nothing recomputes it later: a card
 * bought at ¥1 = €0.00553 cost what it cost, whatever the rate does afterwards.
 *
 * Frankfurter serves European Central Bank reference rates, free, with no key.
 */
import type { Currency } from './types';

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

const round2 = (value: number): number => Math.round(value * 100) / 100;
