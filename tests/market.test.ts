/**
 * The market links under a card.
 *
 * The rule being tested is the one that matters: a link may be less convenient than the
 * card's own page, but it must never be a different card. The English printing of the
 * same Pokémon carries a different number and a different price, and this project has
 * been caught by that more than once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketLinks, type Market } from '../src/personal/lib/market.ts';

const market: Market = {
  sets: {
    SV2a: {
      cardmarket: { expansion: 'Pokémon Card 151', expansionId: 5328, slug: 'Pokemon-Card-151', checkedOn: '2026-09-20' },
      pricecharting: { slug: 'pokemon-japanese-scarlet-&-violet-151', checkedOn: '2026-09-20' },
    },
    M6a: {
      cardmarket: { expansion: '30th Celebration JP', expansionId: 6602, slug: '30th-Celebration-JP', checkedOn: '2026-09-20' },
      pricecharting: { slug: 'pokemon-japanese-30th-celebration', checkedOn: '2026-09-20' },
    },
  },
  cards: {
    'SV2a-201': {
      cardmarket: 'https://www.cardmarket.com/en/Pokemon/Products/Singles/Pokemon-Card-151/Charizard-ex-V3-sv2a201',
      pricecharting: 'https://www.pricecharting.com/game/pokemon-japanese-scarlet-&-violet-151/charizard-ex-201',
    },
    'M6a-105': { pricecharting: 'https://www.pricecharting.com/game/pokemon-japanese-30th-celebration/moltres-105' },
  },
};

test('a card that has been looked up goes straight to its own page on both sites', () => {
  const links = marketLinks({ cardId: 'SV2a-201', setId: 'SV2a', number: '201', nameEn: 'Charizard ex' }, market);

  assert.equal(links.cardmarket?.href, market.cards['SV2a-201'].cardmarket);
  assert.equal(links.cardmarket?.isExact, true);
  assert.equal(links.pricecharting?.href, market.cards['SV2a-201'].pricecharting);
  assert.equal(links.pricecharting?.isExact, true);
});

test('without an exact Cardmarket link, the search is scoped to the expansion and the number', () => {
  const links = marketLinks({ cardId: 'M6a-105', setId: 'M6a', number: '105', nameEn: 'Moltres' }, market);

  // The expansion is the Japanese one and the term is the card's own number: the two
  // things that make it impossible to land on the English Moltres, which is number 130.
  assert.equal(
    links.cardmarket?.href,
    'https://www.cardmarket.com/en/Pokemon/Products/Singles/30th-Celebration-JP?searchString=105&searchMode=v2',
  );
  assert.equal(links.cardmarket?.isExact, false, 'and it says it is a search');
});

test('searchMode=v2 is always on, because without it Cardmarket finds nothing', () => {
  const links = marketLinks({ setId: 'SV2a', number: '166', nameEn: 'Bulbasaur' }, market);

  assert.match(links.cardmarket?.href ?? '', /searchMode=v2/);
});

test('a leading zero is dropped, as Cardmarket writes the number', () => {
  const links = marketLinks({ setId: 'M6a', number: '017', nameEn: 'Pikachu' }, market);

  assert.match(links.cardmarket?.href ?? '', /searchString=17&/);
});

test('a set nobody has mapped yet gets no Cardmarket link at all', () => {
  // A guessed expansion is how you end up on the English printing. No link is better.
  const links = marketLinks({ setId: 'SV42', number: '001', nameEn: 'Pikachu' }, market);

  assert.equal(links.cardmarket, null);
});

test('a card still waiting on the catalog is linked through its hint', () => {
  const links = marketLinks({ hint: { setCode: 'M6a', number: '107' }, nameEn: 'Articuno' }, market);

  assert.match(links.cardmarket?.href ?? '', /30th-Celebration-JP\?searchString=107/);
  assert.match(links.pricecharting?.href ?? '', /pricecharting\.com\/search-products/);
});

test('PriceCharting falls back to a search that names the Japanese set', () => {
  const links = marketLinks({ setId: 'SV2a', number: '183', nameEn: 'Mewtwo' }, market);

  const href = links.pricecharting?.href ?? '';
  assert.match(href, /search-products/);
  assert.match(decodeURIComponent(href), /pokemon japanese scarlet & violet 151 Mewtwo/);
  assert.equal(links.pricecharting?.isExact, false);
});

test('with no market data at all nothing is invented for Cardmarket', () => {
  const links = marketLinks({ setId: 'SV2a', number: '201', nameEn: 'Charizard ex' }, null);

  assert.equal(links.cardmarket, null);
  assert.match(links.pricecharting?.href ?? '', /search-products/);
});

/**
 * Mercari, where the card is actually bought.
 *
 * Always a search — Mercari lists individual sellers, not products, so there is no page
 * per card to harvest and no exact link to be had. What matters is that the query cannot
 * find the English printing: it is the set code and the collector number, both printed on
 * the Japanese card, and neither is shared with its English twin.
 */
test('Mercari is searched by set code and number, as a seller would title it', () => {
  const links = marketLinks({ cardId: 'M6a-124', setId: 'M6a', number: '124' }, market);
  assert.equal(
    links.mercari?.href,
    'https://jp.mercari.com/en/search?keyword=m6a%20124&sort=score&order=desc',
  );
  assert.equal(links.mercari?.isExact, false, 'it is a search and the screen must say so');
});

test('the catalog’s zero padding is not part of what a seller types', () => {
  const links = marketLinks({ cardId: 'SV2a-080', setId: 'SV2a', number: '080' }, market);
  assert.ok(links.mercari?.href.includes('keyword=sv2a%2080'), links.mercari?.href);
});

test('a number that is not a numeral survives, rather than becoming NaN', () => {
  // neo4-DL is Dark Espeon. Number('DL') is NaN, and the old Cardmarket search would
  // have asked the site for "NaN"; it escaped notice only because that card's exact
  // link had been harvested by hand.
  const links = marketLinks({ cardId: 'neo4-DL', setId: 'neo4', number: 'DL' }, market);
  assert.ok(links.mercari?.href.includes('keyword=neo4%20dl'), links.mercari?.href);
  assert.ok(!links.cardmarket?.href.includes('NaN'), 'no search term may ever be NaN');
});

test('a card the catalog has not published yet still gets a Mercari link', () => {
  // The one link such a card can always have: the set code and number are read off the
  // card itself, long before TCGdex publishes the set.
  const links = marketLinks({ hint: { setCode: 'M6a', number: '141' } }, market);
  assert.ok(links.mercari?.href.includes('keyword=m6a%20141'), links.mercari?.href);
});

test('without a set or a number there is no Mercari link, rather than a bad one', () => {
  assert.equal(marketLinks({ cardId: 'M6a-124' }, market).mercari, null);
});
