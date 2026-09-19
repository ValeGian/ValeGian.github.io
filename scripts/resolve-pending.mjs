/**
 * Retries cards the catalog had not published when they were added.
 *
 * A set bought on release day in Japan can sit unpublished for weeks — the Japanese 30th
 * Celebration set was still absent from TCGdex three days after release. Those cards are
 * added with a hint instead of a card id and retried here every day.
 *
 * Writes public/data/resolutions.json. The job cannot promote the card itself, because
 * the collection is encrypted and it holds no key; it publishes the answer, and the
 * owner's next visit applies it.
 *
 *   node scripts/resolve-pending.mjs [--dry-run]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setIndex, findCard, card, chooseVariant } from './lib/tcgdex.mjs';

const DATA = 'public/data';

/** Past this, a card is not late — it is wrong, or the set was never published. */
const STALE_DAYS = 60;

const { values: options } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false } },
});

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const daysSince = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

const pending = await readJson(`${DATA}/pending.json`);
const sets = await setIndex();

const resolved = [];
const stillWaiting = [];

for (const item of pending.items) {
  const setId = sets.get(item.hint.setCode.toLowerCase());
  const match = setId ? await findCard(setId, item.hint.number) : null;

  if (!match) {
    const waitedDays = daysSince(item.pendingSince);
    stillWaiting.push({
      id: item.id,
      hint: item.hint,
      waitedDays,
      // Distinguishes "the catalog is behind" from "this hint will never resolve".
      needsAttention: waitedDays > STALE_DAYS,
    });
    continue;
  }

  const detail = await card(match.id);
  const { variant } = chooseVariant(detail);

  resolved.push({
    id: item.id,
    cardId: detail.id,
    ...(variant?.variantId ? { variantId: variant.variantId } : {}),
    setId: detail.set.id,
    number: detail.localId,
    nameJa: detail.name,
    rarity: detail.rarity ?? null,
    imageBase: detail.image ?? '',
    resolvedOn: new Date().toISOString().slice(0, 10),
  });
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  resolved,
  stillWaiting,
};

const previous = existsSync(`${DATA}/resolutions.json`) ? await readJson(`${DATA}/resolutions.json`) : null;
const newlyResolved = resolved.filter(
  (entry) => !previous?.resolved?.some((earlier) => earlier.id === entry.id),
);

// Only the timestamp changes on a quiet day, and a daily commit that says nothing is
// noise in a history that has to stay readable for years.
const unchanged =
  previous &&
  JSON.stringify({ ...previous, generatedAt: null }) === JSON.stringify({ ...output, generatedAt: null });

if (!options['dry-run'] && !unchanged) {
  await writeFile(`${DATA}/resolutions.json`, `${JSON.stringify(output, null, 2)}\n`);
}

console.log(`pending          ${pending.items.length}`);
console.log(`resolved         ${resolved.length} (${newlyResolved.length} new)`);
console.log(`still waiting    ${stillWaiting.length}`);

for (const entry of newlyResolved) {
  console.log(`  now in catalog: ${entry.cardId} ${entry.nameJa}`);
}
for (const entry of stillWaiting.filter((item) => item.needsAttention)) {
  console.log(`  waiting ${entry.waitedDays} days, check by hand: ${entry.hint.setCode} ${entry.hint.number}`);
}

// The workflow turns this into an issue comment when it is non-empty.
if (!options['dry-run'] && newlyResolved.length > 0) {
  await writeFile(
    '.resolution-report.md',
    [
      `${newlyResolved.length} card(s) now in the catalog:`,
      '',
      ...newlyResolved.map((entry) => `- \`${entry.cardId}\` ${entry.nameJa} (${entry.setId} ${entry.number})`),
      '',
      'Open the collection and apply them; the job cannot, it holds no key.',
    ].join('\n'),
  );
}
