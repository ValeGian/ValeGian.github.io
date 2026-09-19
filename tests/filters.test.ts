import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, sort, emptyFilters } from '../src/personal/lib/filters.ts';
import type { Valued } from '../src/personal/lib/money.ts';

const row = (over: { id: string; nameEn?: string; nameJa?: string; setId?: string; cardId?: string; rarity?: string; date?: string; gain?: number | null; value?: number | null; status?: 'resolved' | 'pending' }): Valued =>
  ({
    item: {
      id: over.id,
      status: over.status ?? 'resolved',
      nameEn: over.nameEn,
      nameJa: over.nameJa,
      cardId: over.cardId ?? 'S12a-261',
      rarity: over.rarity,
      setId: over.setId ?? 'S12a',
      number: '261',
      condition: 'NM',
      isGraded: false,
      quantity: 1,
      purchase: { date: over.date ?? '2026-01-01', amount: 10, currency: 'EUR', amountEur: 10, fxRate: 1, fxSource: 'identity' },
    },
    value: over.value === undefined ? 20 : over.value,
    paid: 10,
    gain: over.gain === undefined ? 10 : over.gain,
    ratio: 1,
  }) as Valued;

test('search matches the Japanese name as well as the English one', () => {
  const rows = [row({ id: 'a', nameEn: 'Giratina VSTAR', nameJa: 'ギラティナVSTAR' })];
  assert.equal(apply(rows, { ...emptyFilters, text: 'giratina' }).length, 1);
  assert.equal(apply(rows, { ...emptyFilters, text: 'ギラティナ' }).length, 1);
  assert.equal(apply(rows, { ...emptyFilters, text: 'charizard' }).length, 0);
});

test('the date range includes both ends', () => {
  const rows = [
    row({ id: 'a', date: '2026-10-01' }),
    row({ id: 'b', date: '2026-10-15' }),
    row({ id: 'c', date: '2026-10-31' }),
  ];
  const inWindow = apply(rows, { ...emptyFilters, from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(inWindow.map((entry) => entry.item.id), ['a', 'b', 'c']);
});

test('gainers and losers both exclude cards with no price', () => {
  const rows = [
    row({ id: 'up', gain: 5 }),
    row({ id: 'down', gain: -5 }),
    row({ id: 'unpriced', gain: null, value: null }),
  ];
  assert.deepEqual(apply(rows, { ...emptyFilters, onlyGainers: true }).map((e) => e.item.id), ['up']);
  assert.deepEqual(apply(rows, { ...emptyFilters, onlyLosers: true }).map((e) => e.item.id), ['down']);
});

test('unpriced cards sort last whichever way the column is pointing', () => {
  const rows = [
    row({ id: 'cheap', value: 5 }),
    row({ id: 'unpriced', value: null, gain: null }),
    row({ id: 'dear', value: 500 }),
  ];

  assert.deepEqual(
    sort(rows, 'value', true).map((entry) => entry.item.id),
    ['dear', 'cheap', 'unpriced'],
    'descending: the most valuable first, unknown last',
  );
  assert.deepEqual(
    sort(rows, 'value', false).map((entry) => entry.item.id),
    ['cheap', 'dear', 'unpriced'],
    'ascending: unknown is still last, because absent is not cheap',
  );
});

test('one box finds a card by its id, however the separator is written', () => {
  const rows = [row({ id: 'a', nameEn: 'Giratina VSTAR', cardId: 'S12a-261' })];

  for (const query of ['S12a-261', 's12a-261', 'S12a 261', 's12a261', '261']) {
    assert.equal(apply(rows, { ...emptyFilters, text: query }).length, 1, `"${query}" should find it`);
  }
  assert.equal(apply(rows, { ...emptyFilters, text: 'S12a-262' }).length, 0, 'a different card is not a match');
});

test('rarity is searchable, because it is how a shelf gets browsed', () => {
  const rows = [
    row({ id: 'a', nameEn: 'Giratina VSTAR', rarity: 'Secret Rare' }),
    row({ id: 'b', nameEn: 'Ralts', rarity: 'Common' }),
  ];
  assert.deepEqual(apply(rows, { ...emptyFilters, text: 'secret' }).map((e) => e.item.id), ['a']);
});

test('an image path is derived when the catalog does not supply one', async () => {
  const { thumbnail } = await import('../src/personal/lib/data.ts');

  // TCGdex reports no image for SV10-127, yet the file is served. Trusting the field
  // left a whole set blank, so the path is derived from the card id instead.
  assert.equal(
    thumbnail({ cardId: 'SV10-127', setId: 'SV10', number: '127' }),
    'https://assets.tcgdex.net/ja/SV/SV10/127/low.webp',
  );

  // A supplied path always wins over a derived one.
  assert.equal(
    thumbnail({ imageBase: 'https://assets.tcgdex.net/ja/S/S12a/261', cardId: 'S12a-261' }),
    'https://assets.tcgdex.net/ja/S/S12a/261/low.webp',
  );

  // The series is the letters in front of the set id, however long.
  assert.equal(
    thumbnail({ cardId: 'PMCG1-001' }),
    'https://assets.tcgdex.net/ja/PMCG/PMCG1/001/low.webp',
  );

  assert.equal(thumbnail({}), null, 'with nothing to go on, nothing is guessed');
});
