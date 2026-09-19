/**
 * Schema tests.
 *
 * A schema that accepts everything passes validation silently, so each rule that matters
 * is checked from both sides: a shape that must be accepted, and the near-miss that must
 * be rejected.
 *
 *   node scripts/test-schemas.mjs
 */
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);

for (const name of ['common', 'collection', 'catalog-overrides', 'watchlist', 'wishlist']) {
  ajv.addSchema(await readJson(`schemas/${name}.schema.json`), `${name}.schema.json`);
}

const purchase = {
  date: '2026-10-14',
  amount: 52000,
  currency: 'JPY',
  amountEur: 287.6,
  fxRate: 0.00553,
  fxSource: 'frankfurter',
};

const resolved = {
  id: 'itm_0001',
  status: 'resolved',
  cardId: 'S12a-261',
  setId: 'S12a',
  number: '261',
  nameJa: 'ギラティナVSTAR',
  catalogSource: 'tcgdex',
  condition: 'NM',
  isGraded: false,
  quantity: 1,
  purchase,
};

const pending = {
  id: 'itm_0192',
  status: 'pending',
  condition: 'NM',
  isGraded: false,
  quantity: 1,
  purchase,
  hint: { setCode: 'M6a', number: '045', nameJa: 'ピカチュウ' },
  pendingSince: '2026-10-14',
};

const wish = {
  id: 'wish_0001',
  status: 'wanted',
  cardId: 'M6-113',
  targetPriceEur: 700,
  priority: 'normal',
  addedAt: '2026-09-19',
};

const list = (items) => ({ owner: 'Tommy', items, settlements: [] });

const cases = [
  ['wishlist', 'a wanted card', list([wish]), true],
  [
    'wishlist',
    'a wanted card with no target, which means any price',
    list([{ ...wish, targetPriceEur: null }]),
    true,
  ],
  [
    'wishlist',
    'a bought card carrying what it cost',
    list([{ ...wish, status: 'bought', boughtAt: '2026-10-14', purchase }]),
    true,
  ],
  [
    'wishlist',
    'a bought card with no purchase, which would leave a debt unrecorded',
    list([{ ...wish, status: 'bought', boughtAt: '2026-10-14' }]),
    false,
  ],
  [
    'wishlist',
    'a wanted card carrying a purchase, which has not happened',
    list([{ ...wish, purchase }]),
    false,
  ],
  [
    'wishlist',
    'a free-text priority',
    list([{ ...wish, priority: 'urgent' }]),
    false,
  ],
  [
    'wishlist',
    'a settlement with no amount',
    { owner: 'Tommy', items: [], settlements: [{ date: '2026-11-02' }] },
    false,
  ],
  ['collection', 'a resolved TCGdex card', { version: 1, items: [resolved] }, true],
  ['collection', 'a pending card with only a hint', { version: 1, items: [pending] }, true],
  [
    'collection',
    'an override-sourced card, which carries no cached catalog fields',
    { version: 1, items: [{ ...resolved, catalogSource: 'override', setId: undefined, number: undefined, nameJa: undefined }] },
    true,
  ],
  [
    'collection',
    'a pending card missing its hint',
    { version: 1, items: [{ ...pending, hint: undefined }] },
    false,
  ],
  [
    'collection',
    'a TCGdex card missing its Japanese name',
    { version: 1, items: [{ ...resolved, nameJa: undefined }] },
    false,
  ],
  [
    'collection',
    'a graded card, which v1 does not accept',
    { version: 1, items: [{ ...resolved, isGraded: true }] },
    false,
  ],
  [
    'collection',
    'a free-text condition',
    { version: 1, items: [{ ...resolved, condition: 'Near Mint' }] },
    false,
  ],
  [
    'collection',
    'a misspelled field, which additionalProperties must catch',
    { version: 1, items: [{ ...resolved, nameJP: 'x' }] },
    false,
  ],
  [
    'collection',
    'a purchase with no exchange-rate source',
    { version: 1, items: [{ ...resolved, purchase: { ...purchase, fxSource: undefined } }] },
    false,
  ],
  [
    'watchlist',
    'a watchlist entry carrying a price, which it must never do',
    {
      version: 1,
      generatedAt: '2026-09-19T18:00:00.000Z',
      cards: [{ cardId: 'S12a-261', variantId: 'abc', avg30: 252.58 }],
    },
    false,
  ],
  [
    'catalog-overrides',
    'a price-only override',
    {
      version: 1,
      cards: [
        {
          cardId: 'PMCG1-001',
          reason: 'TCGdex has no Cardmarket link for this set.',
          price: { source: 'manual', currency: 'EUR', checkedOn: '2026-09-19', avg30: 5.3 },
        },
      ],
    },
    true,
  ],
  [
    'catalog-overrides',
    'an override with no stated reason',
    {
      version: 1,
      cards: [{ cardId: 'PMCG1-001', price: { source: 'manual', currency: 'EUR', checkedOn: '2026-09-19' } }],
    },
    false,
  ],
];

const strip = (value) => JSON.parse(JSON.stringify(value));

let failures = 0;
for (const [schema, description, data, shouldPass] of cases) {
  const validate = ajv.getSchema(`${schema}.schema.json`);
  const passed = validate(strip(data));

  if (passed === shouldPass) {
    console.log(`  ok    ${shouldPass ? 'accepts' : 'rejects'} ${description}`);
    continue;
  }

  failures += 1;
  console.error(`  FAIL  expected ${schema} to ${shouldPass ? 'accept' : 'reject'} ${description}`);
  if (!passed) {
    for (const error of validate.errors ?? []) console.error(`          ${error.instancePath || '/'} ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} of ${cases.length} schema tests failed`);
  process.exit(1);
}
console.log(`\n${cases.length} schema tests passed`);
