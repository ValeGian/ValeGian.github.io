/**
 * Correcting what a card cost.
 *
 * A purchase is a ledger entry. Fixing a typo in it must not restate it at a different
 * rate, and must not need the network to do it: the typo is noticed in the shop where it
 * was made. Only a new currency or a new date asks for a rate that is not already on
 * record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purchaseAt, revisePurchase, type Converted } from '../src/personal/lib/fx.ts';
import type { Currency, Purchase } from '../src/personal/lib/types.ts';

const RATE_ON_14_OCT = 0.0056;

/** Stands in for Frankfurter, and remembers what it was asked. */
function fakeRates() {
  const asked: string[] = [];
  const convertAt = async (amount: number, currency: Currency, date: string): Promise<Converted> => {
    asked.push(`${currency}|${date}`);
    const fxRate = currency === 'EUR' ? 1 : RATE_ON_14_OCT;
    return { amountEur: Math.round(amount * fxRate * 100) / 100, fxRate, rateDate: date };
  };
  return { asked, convertAt };
}

const recorded = (over: Partial<Purchase> = {}): Purchase => ({
  date: '2026-10-14',
  amount: 1200,
  currency: 'JPY',
  amountEur: 6.72,
  fxRate: RATE_ON_14_OCT,
  fxSource: 'frankfurter',
  ...over,
});

test('a corrected amount keeps the rate on record and asks for no rate', async () => {
  const rates = fakeRates();
  const revised = await revisePurchase(recorded(), { amount: 12000, currency: 'JPY', date: '2026-10-14' }, rates.convertAt);

  assert.deepEqual(rates.asked, [], 'no network needed to fix a typo');
  assert.equal(revised.amount, 12000);
  assert.equal(revised.amountEur, 67.2);
  assert.equal(revised.fxRate, RATE_ON_14_OCT);
});

test('a rate written down at the time survives a corrected amount', async () => {
  const rates = fakeRates();
  const tillRate = recorded({ fxRate: 0.006, fxSource: 'user-recorded', amountEur: 7.2, vendor: 'Card Rush' });
  const revised = await revisePurchase(tillRate, { amount: 1500, currency: 'JPY', date: '2026-10-14' }, rates.convertAt);

  assert.equal(revised.fxRate, 0.006);
  assert.equal(revised.fxSource, 'user-recorded');
  assert.equal(revised.amountEur, 9);
  assert.equal(revised.vendor, 'Card Rush');
});

test('an untouched purchase comes back exactly as recorded', async () => {
  // An imported euro figure need not be amount × rate to the cent; editing the card's
  // condition must not quietly restate it.
  const imported = recorded({ amountEur: 6.75, fxSource: 'user-recorded' });
  const revised = await revisePurchase(imported, { amount: 1200, currency: 'JPY', date: '2026-10-14' }, fakeRates().convertAt);

  assert.equal(revised, imported);
});

test('a new currency is priced at the rate on the day of purchase, not today', async () => {
  const rates = fakeRates();
  const revised = await revisePurchase(recorded(), { amount: 7, currency: 'EUR', date: '2026-10-14' }, rates.convertAt);

  assert.deepEqual(rates.asked, ['EUR|2026-10-14']);
  assert.equal(revised.currency, 'EUR');
  assert.equal(revised.amountEur, 7);
  assert.equal(revised.fxRate, 1);
  assert.equal(revised.fxSource, 'identity');
});

test('a new date fetches that day and retires the import placeholder', async () => {
  const rates = fakeRates();
  const imported = recorded({ dateIsBootstrap: true });
  const revised = await revisePurchase(imported, { amount: 1200, currency: 'JPY', date: '2026-09-01' }, rates.convertAt);

  assert.deepEqual(rates.asked, ['JPY|2026-09-01']);
  assert.equal(revised.date, '2026-09-01');
  assert.equal(revised.dateIsBootstrap, false);
});

test('a new currency on the same day keeps the import placeholder', async () => {
  const imported = recorded({ dateIsBootstrap: true });
  const revised = await revisePurchase(imported, { amount: 7, currency: 'EUR', date: '2026-10-14' }, fakeRates().convertAt);

  assert.equal(revised.dateIsBootstrap, true, 'the date is still the placeholder it was');
});

test('a purchase made in yen is recorded with the rate it was converted at', async () => {
  const purchase = await purchaseAt(1200, 'JPY', '2026-10-14', fakeRates().convertAt);

  assert.deepEqual(purchase, recorded());
});
