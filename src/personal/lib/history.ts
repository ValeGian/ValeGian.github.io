/**
 * Price history, at whatever resolution the chosen range deserves.
 *
 * A week of daily points is readable. Five years of daily points is 1,800 marks in a
 * few hundred pixels — unreadable, and expensive to fetch. So the range picks the
 * bucket: days for a week, weeks for a month, months beyond that, each longer bucket
 * being the mean of the days inside it.
 *
 * Daily points come from the immutable per-day files, fetched only for the span asked
 * for. Anything coarser comes from one rollup file.
 */
import { quote, type Basis } from './money.ts';
import type { PriceSnapshot } from './types.ts';

export type RangeKey = '1w' | '1m' | '6m' | '1y' | '5y' | 'all';

export interface Range {
  key: RangeKey;
  label: string;
  days: number | null;
  bucket: 'day' | 'week' | 'month';
}

export const RANGES: Range[] = [
  { key: '1w', label: '1W', days: 7, bucket: 'day' },
  { key: '1m', label: '1M', days: 31, bucket: 'week' },
  { key: '6m', label: '6M', days: 183, bucket: 'month' },
  { key: '1y', label: '1Y', days: 366, bucket: 'month' },
  { key: '5y', label: '5Y', days: 1827, bucket: 'month' },
  { key: 'all', label: 'All', days: null, bucket: 'month' },
];

export interface Point {
  /** The period this point covers: a date, an ISO week, or a month. */
  period: string;
  /** Midpoint of the period, for placing it on a time axis. */
  at: number;
  value: number;
}

/**
 * A closed period, holding the mean of every figure the days inside it carried.
 *
 * All of them, not only the one being charted: which measure a series should be built on
 * is the reader's choice and may change, and a rollup covers a period that is over.
 */
type RollupEntry = { period: string; days: number } & Partial<Record<Basis | 'low' | 'avg', number | null>>;

export interface HistorySource {
  index: { days: string[]; firstDay: string | null; lastDay: string | null };
  rollups: { weekly: Record<string, RollupEntry[]>; monthly: Record<string, RollupEntry[]> };
  /** Daily snapshots already fetched, keyed by date. */
  daily: Map<string, PriceSnapshot>;
}

const json = async <T,>(path: string, fallback: T): Promise<T> => {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    return response.ok ? ((await response.json()) as T) : fallback;
  } catch {
    return fallback;
  }
};

export async function loadHistory(): Promise<HistorySource> {
  const [index, rollups] = await Promise.all([
    json('/data/prices/index.json', { days: [] as string[], firstDay: null, lastDay: null }),
    json('/data/prices/rollups.json', { weekly: {}, monthly: {} }),
  ]);
  return { index, rollups, daily: new Map() };
}

/** Daily files are immutable once written, so a fetched day never needs fetching again. */
export async function ensureDays(source: HistorySource, dates: string[]): Promise<void> {
  const missing = dates.filter((date) => !source.daily.has(date));
  if (missing.length === 0) return;

  const loaded = await Promise.all(
    missing.map(async (date) => [date, await json<PriceSnapshot | null>(`/data/prices/daily/${date}.json`, null)] as const),
  );
  for (const [date, snapshot] of loaded) {
    if (snapshot) source.daily.set(date, snapshot);
  }
}

const midOfWeek = (period: string): number => {
  const [year, week] = period.split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  const dayOfWeek = new Date(jan4).getUTCDay() || 7;
  return jan4 + ((week - 1) * 7 - dayOfWeek + 4) * 86_400_000;
};

const midOfMonth = (period: string): number => {
  const [year, month] = period.split('-').map(Number);
  return Date.UTC(year, month - 1, 15);
};

/** Which days the chosen range needs fetched, if it is a daily one. */
export function daysNeeded(source: HistorySource, range: Range): string[] {
  if (range.bucket !== 'day') return [];
  const all = [...source.index.days].sort();
  return range.days === null ? all : all.slice(-range.days);
}

function withinRange(at: number, range: Range): boolean {
  if (range.days === null) return true;
  return at >= Date.now() - range.days * 86_400_000;
}

/**
 * The same order of preference `quote` uses, applied to a period rather than a day.
 *
 * Kept beside it rather than shared with it because a rollup is not a price record: it
 * has no source and no currency, only means.
 */
const ROLLUP_FALLBACKS: Record<Basis, (Basis)[]> = {
  avg1: ['avg1', 'avg7', 'avg30', 'trend'],
  avg7: ['avg7', 'avg30', 'avg1', 'trend'],
  avg30: ['avg30', 'trend', 'avg7'],
  trend: ['trend', 'avg30', 'avg7', 'avg1'],
};

function rollupValue(entry: RollupEntry, basis: Basis): number | null {
  for (const field of ROLLUP_FALLBACKS[basis] ?? ROLLUP_FALLBACKS.avg30) {
    const value = entry[field];
    if (typeof value === 'number') return value;
  }
  return null;
}

/**
 * The series for one card at the resolution the range calls for.
 *
 * Returns an empty list rather than a guess when there is nothing: a chart of one point
 * is not a trend, and the caller shows a figure instead.
 */
export function cardSeries(source: HistorySource, cardId: string, range: Range, basis: Basis = 'avg30'): Point[] {
  if (range.bucket === 'day') {
    return daysNeeded(source, range)
      .map((date) => {
        const price = source.daily.get(date)?.prices[cardId];
        // The same rule the figures use, so a chart and the number above it agree.
        const reading = quote(price, basis);
        return reading ? { period: date, at: Date.parse(`${date}T12:00:00Z`), value: reading.value } : null;
      })
      .filter((point): point is Point => point !== null);
  }

  const entries = (range.bucket === 'week' ? source.rollups.weekly : source.rollups.monthly)[cardId] ?? [];
  const at = range.bucket === 'week' ? midOfWeek : midOfMonth;

  return entries
    .map((entry) => {
      // A period may hold one measure and not another — a quiet card can have a trend
      // every day and a one-day average on none of them — so fall back the same way the
      // figures do rather than break the line.
      const value = rollupValue(entry, basis);
      return value === null ? null : { period: entry.period, at: at(entry.period), value };
    })
    .filter((point): point is Point => point !== null)
    .filter((point) => withinRange(point.at, range));
}

export interface Holding {
  cardId: string;
  quantity: number;
  boughtOn: string;
  /** True when the date is the import placeholder rather than a real purchase date. */
  dateIsBootstrap?: boolean;
}

/**
 * What a set of holdings was worth over time.
 *
 * Summed in the browser from per-card prices and quantities, because the holdings are
 * private and the prices are not.
 *
 * A card counts from the day it was bought, so the line does not pretend the collection
 * was always this size — except where the purchase date is the import placeholder. Those
 * dates say "unknown", not "bought that morning", and treating them as acquisitions
 * would start the whole collection on the day the tracker did and flatten every earlier
 * reading to nothing. An unknown date counts throughout instead.
 */
export function holdingsSeries(
  source: HistorySource,
  holdings: Holding[],
  range: Range,
  basis: Basis = 'avg30',
): Point[] {
  const byPeriod = new Map<string, { at: number; value: number }>();

  for (const holding of holdings) {
    for (const point of cardSeries(source, holding.cardId, range, basis)) {
      if (!holding.dateIsBootstrap && point.period < holding.boughtOn.slice(0, point.period.length)) continue;
      const running = byPeriod.get(point.period) ?? { at: point.at, value: 0 };
      running.value += point.value * holding.quantity;
      byPeriod.set(point.period, running);
    }
  }

  return [...byPeriod]
    .map(([period, { at, value }]) => ({ period, at, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.at - b.at);
}
