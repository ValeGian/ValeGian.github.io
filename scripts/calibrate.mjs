/**
 * Checks the price fields against each other, over time.
 *
 * The open question was why `avg30` agreed with Cardmarket's own page within 2.3% while
 * `avg7` and `avg1` were out by up to 33%. A one-day eyeball comparison cannot answer
 * that: it cannot tell a thinly-traded card whose weekly average genuinely swings from a
 * field that is mislabelled or stale.
 *
 * The snapshots answer it without Cardmarket. If the fields mean what they say, then a
 * reported `avg7` should track the mean of the last seven reported `avg1` values, and
 * `avg30` the last thirty. That is thirty observations instead of one, it needs no
 * access to a site that refuses automated clients, and it runs on its own.
 *
 * It cannot prove agreement with Cardmarket — that was established by direct comparison
 * and is not in question for `avg30`. It proves the fields are internally consistent and
 * still moving, which is what the remaining doubt was about.
 *
 *   node scripts/calibrate.mjs [--min-days 8]
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const DAILY = 'public/data/prices/daily';
const REPORT = 'public/data/prices/calibration.json';

/** Below this there is not enough history for a trailing mean to mean anything. */
const WINDOWS = [
  { field: 'avg7', days: 7 },
  { field: 'avg30', days: 30 },
];

/** A mirror that has stopped moving looks exactly like a flat market; this tells them apart. */
const STALE_AFTER_IDENTICAL_DAYS = 7;

const { values: options } = parseArgs({ options: { 'min-days': { type: 'string', default: '8' } } });
const minDays = Number(options['min-days']);

if (!existsSync(DAILY)) {
  console.log('No snapshots yet.');
  process.exit(0);
}

const files = (await readdir(DAILY)).filter((name) => name.endsWith('.json')).sort();
const days = [];
for (const name of files) {
  days.push(JSON.parse(await readFile(`${DAILY}/${name}`, 'utf8')));
}

if (days.length < minDays) {
  console.log(`${days.length} day(s) of history. Need ${minDays} before the fields can be compared.`);
  console.log('The daily job is collecting them; nothing to do.');
  process.exit(0);
}

/** cardId → [{date, avg1, avg7, avg30, updated}] in date order. */
const series = new Map();
for (const day of days) {
  for (const [cardId, price] of Object.entries(day.prices)) {
    if (price.source !== 'cardmarket/tcgdex') continue;
    if (!series.has(cardId)) series.set(cardId, []);
    series.get(cardId).push({ date: day.date, ...price });
  }
}

const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const errors = Object.fromEntries(WINDOWS.map((window) => [window.field, []]));
const frozen = [];
const jumps = [];

for (const [cardId, readings] of series) {
  for (const { field, days: span } of WINDOWS) {
    for (let index = span - 1; index < readings.length; index += 1) {
      const window = readings.slice(index - span + 1, index + 1);
      const spot = window.map((reading) => reading.avg1).filter((value) => typeof value === 'number');
      if (spot.length < span) continue;

      const reported = readings[index][field];
      if (typeof reported !== 'number' || reported === 0) continue;

      const expected = spot.reduce((sum, value) => sum + value, 0) / spot.length;
      errors[field].push(Math.abs(reported - expected) / reported);
    }
  }

  // A field that never changes across a week is a frozen mirror, not a calm market.
  const recent = readings.slice(-STALE_AFTER_IDENTICAL_DAYS);
  if (recent.length === STALE_AFTER_IDENTICAL_DAYS) {
    const distinct = new Set(recent.map((reading) => reading.updated));
    if (distinct.size === 1) frozen.push(cardId);
  }

  for (let index = 1; index < readings.length; index += 1) {
    const before = readings[index - 1].avg7;
    const after = readings[index].avg7;
    if (typeof before !== 'number' || typeof after !== 'number' || before === 0) continue;
    const change = Math.abs(after / before - 1);
    if (change > 0.25) jumps.push({ cardId, date: readings[index].date, change });
  }
}

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  days: days.length,
  cards: series.size,
  medianRelativeError: Object.fromEntries(
    WINDOWS.map(({ field }) => [field, errors[field].length ? Number(median(errors[field]).toFixed(4)) : null]),
  ),
  samples: Object.fromEntries(WINDOWS.map(({ field }) => [field, errors[field].length])),
  frozenCards: frozen,
  largeWeeklyJumps: jumps.length,
};

await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`days of history   ${report.days}`);
console.log(`cards compared    ${report.cards}`);
for (const { field } of WINDOWS) {
  const error = report.medianRelativeError[field];
  console.log(
    `${field.padEnd(17)} ${error === null ? 'not enough history' : `median error ${(error * 100).toFixed(1)}% over ${report.samples[field]} comparisons`}`,
  );
}
if (frozen.length > 0) console.log(`frozen mirrors    ${frozen.length} card(s) unchanged for a week: ${frozen.slice(0, 5).join(', ')}`);
if (jumps.length > 0) console.log(`weekly jumps >25% ${jumps.length}`);

// Only a frozen mirror is a fault. A noisy weekly average on a thin market is the market.
if (frozen.length > series.size / 2) {
  console.error('\nMost cards have not moved in a week. The upstream mirror has probably stopped.');
  process.exit(1);
}
