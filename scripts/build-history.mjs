/**
 * Turns the daily snapshots into something a browser can chart without fetching a file
 * per day.
 *
 * Two outputs:
 *
 *   prices/index.json    which days exist, so the client knows what it can ask for
 *   prices/rollups.json  weekly and monthly averages per card
 *
 * Only per-card prices go in. What a collection is worth at a point in time is the
 * holdings multiplied by those prices, and the holdings are private — so that sum is
 * computed in the browser, and nothing here reveals a portfolio.
 *
 * Rollups are rewritten on every run, which is affordable because they are coarse: a
 * card contributes one number per week and one per month, not one per day. Daily
 * resolution stays in the immutable daily files, where it costs nothing to keep.
 *
 *   node scripts/build-history.mjs
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DAILY = 'public/data/prices/daily';
const OUT = 'public/data/prices';

if (!existsSync(DAILY)) {
  console.log('No snapshots yet.');
  process.exit(0);
}

/** ISO week, so a week is the same seven days however the months fall. */
function isoWeek(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const month = (date) => date.slice(0, 7);

const files = (await readdir(DAILY)).filter((name) => name.endsWith('.json')).sort();
const days = [];

/** cardId -> period -> running mean */
const weekly = new Map();
const monthly = new Map();

/**
 * Every figure Cardmarket publishes, kept as its own running mean.
 *
 * Not just the one the chart draws today. Which measure a series should be built on is
 * the reader's choice and may change — a one-day average is the honest primitive for a
 * series we aggregate ourselves, where a thirty-day average is already a mean of the
 * previous thirty days and aggregating it again smooths what is already smooth. Keeping
 * all of them costs a few kilobytes and means that choice stays open.
 *
 * Counted per field, because they are not populated equally: a card can have a trend on a
 * day when no copy sold and so has no one-day average at all. A mean over the days that
 * had a figure is honest; treating a missing day as zero is not.
 */
const FIELDS = ['avg1', 'avg7', 'avg30', 'trend', 'low', 'avg'];

const add = (bucket, cardId, period, price) => {
  if (!bucket.has(cardId)) bucket.set(cardId, new Map());
  const periods = bucket.get(cardId);
  const running = periods.get(period) ?? {
    ...Object.fromEntries(FIELDS.map((field) => [field, { sum: 0, count: 0 }])),
    days: 0,
  };

  for (const field of FIELDS) {
    if (typeof price[field] !== 'number') continue;
    running[field].sum += price[field];
    running[field].count += 1;
  }

  running.days += 1;
  periods.set(period, running);
};

for (const name of files) {
  const snapshot = JSON.parse(await readFile(`${DAILY}/${name}`, 'utf8'));
  days.push(snapshot.date);

  for (const [cardId, price] of Object.entries(snapshot.prices)) {
    // avg7 stands in for a card too new to have a thirty-day average, as it does
    // everywhere else; the real avg7 is kept alongside it either way.
    const values = { ...price, avg30: typeof price.avg30 === 'number' ? price.avg30 : price.avg7 };
    if (!FIELDS.some((field) => typeof values[field] === 'number')) continue;
    add(weekly, cardId, isoWeek(snapshot.date), values);
    add(monthly, cardId, month(snapshot.date), values);
  }
}

const flatten = (bucket) =>
  Object.fromEntries(
    [...bucket].map(([cardId, periods]) => [
      cardId,
      [...periods]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, running]) => {
          const mean = (field) =>
            running[field].count === 0 ? null : Math.round((running[field].sum / running[field].count) * 100) / 100;
          return {
            period,
            ...Object.fromEntries(FIELDS.map((field) => [field, mean(field)])),
            days: running.days,
          };
        }),
    ]),
  );

days.sort();

await writeFile(
  `${OUT}/index.json`,
  `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), firstDay: days[0] ?? null, lastDay: days.at(-1) ?? null, days }, null, 2)}\n`,
);

await writeFile(
  `${OUT}/rollups.json`,
  `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), weekly: flatten(weekly), monthly: flatten(monthly) })}\n`,
);

console.log(`days indexed   ${days.length}`);
console.log(`cards rolled   ${weekly.size}`);
console.log(`written to     ${OUT}/index.json, ${OUT}/rollups.json`);
