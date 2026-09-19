/**
 * Prints every price field TCGdex holds for a few cards, next to a Cardmarket search
 * link, so the two can be compared by eye.
 *
 * This exists for one open question. Checked against Cardmarket's own pages on
 * 2026-09-19, `avg30` agreed to within 2.3% and `low` matched to the cent, but `avg7`
 * and `avg1` were out by up to 33%. Until a week of readings says why, only `avg30` is
 * shown anywhere in the site.
 *
 *   node scripts/spot-check.mjs [--count 3]
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({ options: { count: { type: 'string', default: '3' } } });

const latest = JSON.parse(await readFile('public/data/prices/latest.json', 'utf8'));
const collection = JSON.parse(await readFile('.local/collection.json', 'utf8'));

const names = new Map(collection.items.map((item) => [item.cardId, item.nameEn]));

const chosen = Object.entries(latest.prices)
  .filter(([, price]) => price.source === 'cardmarket/tcgdex')
  .sort(([, a], [, b]) => (b.avg30 ?? 0) - (a.avg30 ?? 0))
  .slice(0, Number(options.count));

console.log(`Snapshot ${latest.date}. Compare each row against its Cardmarket page.\n`);

for (const [cardId, price] of chosen) {
  const name = names.get(cardId) ?? cardId;
  const search = `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent(name)}`;
  console.log(`${name}  (${cardId})`);
  console.log(`  avg30 ${price.avg30}   avg7 ${price.avg7}   avg1 ${price.avg1}   trend ${price.trend}   low ${price.low}`);
  console.log(`  TCGdex read Cardmarket at ${price.updated}`);
  console.log(`  ${search}\n`);
}

console.log('Record each comparison in PLAN.md §13. Seven readings decide whether avg7');
console.log('and avg1 can be trusted, or stay hidden for good.');
