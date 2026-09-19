/**
 * One-shot import of the Google Sheet into data/collection.json.
 *
 * Input and output both hold purchase prices, so both live under .local/, which is
 * gitignored. Nothing this script touches may be committed: the repository is public and
 * git history is append-only, so a plaintext commit stays readable forever — including
 * after the served copies are encrypted.
 *
 *   node scripts/migrate-sheet.mjs [--in path] [--out path] [--date YYYY-MM-DD]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parseCsv, parseItalianNumber } from './lib/csv.mjs';
import { setIndex, findCard, card, chooseVariant } from './lib/tcgdex.mjs';

/**
 * Rows the sheet cannot resolve on its own, with the reasoning kept next to the mapping
 * so it can be checked rather than trusted.
 */
const SHEET_FIXUPS = new Map([
  // 1996 Japanese cards print the National Pokédex number rather than a collector
  // number, so "Charmander #4" is dex #4 — the fourteenth card of 拡張パック. PMCG1-004
  // is Weedle, dex #13.
  ['-|1', 'PMCG1-001'],
  ['-|4', 'PMCG1-014'],
  // Pokémon Card Game Classic is absent from TCGdex in every language. The CLK code
  // comes from Cardmarket, which is where its catalog entry and price come from too.
  ['CLK|1', 'CLK-001'],
]);

const CURRENCIES = new Map([['€', 'EUR'], ['¥', 'JPY'], ['$', 'USD']]);

const { values: options } = parseArgs({
  options: {
    in: { type: 'string', default: '.local/collection-sheet.csv' },
    out: { type: 'string', default: '.local/collection.json' },
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
  },
});

const round2 = (value) => Math.round(value * 100) / 100;

async function resolveCard(row) {
  const fixup = SHEET_FIXUPS.get(`${row['Set Id']}|${row.Number}`);
  if (fixup) {
    const [setId] = fixup.split('-');
    const sets = await setIndex();
    if (!sets.has(setId.toLowerCase())) {
      return { cardId: fixup, source: 'override' };
    }
    return { cardId: fixup, source: 'tcgdex' };
  }

  const sets = await setIndex();
  const setId = sets.get(row['Set Id'].toLowerCase());
  if (!setId) return null;

  const match = await findCard(setId, row.Number);
  return match ? { cardId: match.id, source: 'tcgdex' } : null;
}

function buildPurchase(row) {
  const currency = CURRENCIES.get(row.Currency);
  if (!currency) throw new Error(`Unknown currency ${JSON.stringify(row.Currency)} for ${row.Name}`);

  const amount = parseItalianNumber(row.Bought);
  const fxRate = parseItalianNumber(row['Conversion Rate']);
  const amountEur = parseItalianNumber(row['Net €']);

  return {
    date: options.date,
    // The real purchase dates were never recorded. Flagged so no chart implies history
    // that was not measured.
    dateIsBootstrap: true,
    amount,
    currency,
    amountEur,
    fxRate,
    // These rates are the ones actually paid at, kept from the sheet rather than
    // recomputed from a rate table that would be wrong for the day.
    fxSource: currency === 'EUR' && fxRate === 1 ? 'identity' : 'user-recorded',
  };
}

const rows = parseCsv(await readFile(options.in, 'utf8'));
const items = [];
const unresolved = [];
const ambiguous = [];
const unpriced = [];

for (const [index, row] of rows.entries()) {
  const purchase = buildPurchase(row);
  const id = `itm_${String(index + 1).padStart(4, '0')}`;
  const resolved = await resolveCard(row);

  if (!resolved) {
    unresolved.push(row);
    items.push({
      id,
      status: 'pending',
      condition: 'NM',
      isGraded: false,
      quantity: 1,
      purchase,
      hint: { setCode: row['Set Id'], number: row.Number, nameEn: row.Name, setName: row.Expansion },
      pendingSince: options.date,
      notes: '',
    });
    continue;
  }

  if (resolved.source === 'override') {
    items.push({
      id,
      status: 'resolved',
      cardId: resolved.cardId,
      nameEn: row.Name,
      catalogSource: 'override',
      condition: 'NM',
      isGraded: false,
      quantity: 1,
      purchase,
      notes: '',
    });
    continue;
  }

  const detail = await card(resolved.cardId);
  const { variant, priced, ambiguous: isAmbiguous, alternatives } = chooseVariant(detail);
  if (isAmbiguous) ambiguous.push({ cardId: detail.id, name: detail.name, alternatives });
  if (!priced) unpriced.push({ cardId: detail.id, name: detail.name });

  items.push({
    id,
    status: 'resolved',
    cardId: detail.id,
    ...(variant?.variantId ? { variantId: variant.variantId } : {}),
    setId: detail.set.id,
    number: detail.localId,
    nameJa: detail.name,
    nameEn: row.Name,
    rarity: detail.rarity ?? null,
    imageBase: detail.image ?? '',
    catalogSource: 'tcgdex',
    condition: 'NM',
    isGraded: false,
    quantity: 1,
    purchase,
    notes: '',
  });
}

const paid = round2(items.reduce((total, item) => total + item.purchase.amountEur * item.quantity, 0));

await writeFile(options.out, `${JSON.stringify({ version: 1, items }, null, 2)}\n`);

console.log(`rows          ${rows.length}`);
console.log(`resolved      ${items.filter((item) => item.status === 'resolved').length}`);
console.log(`pending       ${items.filter((item) => item.status === 'pending').length}`);
console.log(`total paid    EUR ${paid.toFixed(2)}`);
if (ambiguous.length > 0) {
  console.log('\nambiguous variants, pick one by hand:');
  for (const entry of ambiguous) console.log(`  ${entry.cardId} ${entry.name} (${entry.alternatives} priced variants)`);
}
if (unpriced.length > 0) {
  console.log('\nno Cardmarket price on TCGdex, needs a manual override:');
  for (const entry of unpriced) console.log(`  ${entry.cardId} ${entry.name}`);
}
if (unresolved.length > 0) {
  console.log('\nunresolved, imported as pending:');
  for (const row of unresolved) console.log(`  ${row['Set Id']} ${row.Number} ${row.Name}`);
}
console.log(`\nwritten to ${options.out}`);
