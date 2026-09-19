/**
 * Searching the catalog from the browser.
 *
 * TCGdex holds Japanese cards under Japanese names, but the name that comes to mind in a
 * shop is usually the English one. So an English query is translated to the Japanese
 * species name first, using the same table the display names come from, and the search
 * runs on that.
 */
import { toEnglish } from '../../lib/card-name.mjs';
import type { NameTable } from './data.ts';

const JA = 'https://api.tcgdex.net/v2/ja';
const EN = 'https://api.tcgdex.net/v2/en';
/** How many catalog results one page of the search asks for. */
const PAGE_SIZE = 24;

/**
 * How many stand-ins a search that did not ask for the set may return.
 *
 * The 30th Anniversary set is 34 Pikachus out of 158 cards, so an unbounded tail would
 * be the entire first screenful of a plain Pikachu search — pushing aside the Japanese
 * cards that are almost always the ones wanted.
 */
const MIRROR_TAIL = 6;

export interface CardHit {
  id: string;
  localId: string;
  name: string;
  image?: string;
  /**
   * Set on a hit that stands in for a Japanese card the catalog has not published.
   * Carries the Japanese set code, which is what the card has to be recorded under.
   */
  mirrorOf?: { setCode: string; setName: string };
}

/**
 * Japanese sets paired with the English set that prints the same cards at the same
 * numbers, for the two cases where the Japanese catalog entry is not enough.
 *
 * **The numbering does not carry across, not even for a simultaneous release.** This was
 * assumed at first and it was wrong: Cardmarket lists the Japanese Moltres as m6a 105 and
 * m6a 006, where the English set has its two Moltres at 011 and 130 — no offset, no
 * pattern. A pairing therefore supplies a name and a picture and never a number. Anything
 * that needs the number has to get it from the card itself.
 *
 * The pairing does two jobs:
 *
 * - **The set is missing from the Japanese catalog.** Four days after the 30th
 *   Anniversary launch TCGdex had the English set complete with artwork for all 158
 *   cards and no Japanese M6a at all, so a card bought on release day could not be found
 *   by name, by number, or at all. The English twin stands in for the name and the
 *   picture — never the card id, which is a different Cardmarket product, and never the
 *   number, which is a different number.
 * A row disables itself as soon as the Japanese set appears, so leaving one behind costs
 * nothing.
 *
 * Borrowing a picture for a Japanese card that *is* in the catalog but has not been
 * scanned — every card in M2a, M4, M5, M6 and SV11W has prices and no picture — was tried
 * and removed: it can only be done by number, and the numbers do not correspond. Those
 * cards get their artwork from artwork.json when the daily job finds it.
 */
const MIRRORED_SETS: { japanese: string; setName: string; english: string }[] = [
  { japanese: 'M6a', setName: '30th Anniversary', english: '30th' },
];

export interface CardDetail extends CardHit {
  rarity?: string | null;
  set: { id: string; name: string };
  variants_detailed?: {
    variantId: string;
    type: string;
    pricing?: { cardmarket?: unknown };
  }[];
}

const hasLatin = (text: string): boolean => /[a-z]/i.test(text);

/**
 * A card id as TCGdex writes it: set id, a dash, a number. Worth recognising, because
 * the code printed on the card is what is in front of you in a shop.
 */
export const looksLikeCardId = (text: string): boolean => /^[A-Za-z0-9.+]{1,12}-?\s?[0-9]{1,4}[A-Za-z]?$/.test(text.trim());

/** Normalises `sv2a 201`, `SV2a-201` and `sv2a201` to the id TCGdex expects. */
function toCardId(text: string): string | null {
  const match = text.trim().match(/^([A-Za-z0-9.+]{1,12}?)[-\s]?([0-9]{1,4}[A-Za-z]?)$/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(3, '0')}`;
}

/**
 * English query to Japanese species names.
 *
 * "Charizard ex" is not a species, so the whole string never matches. Each word is tried
 * and the matches collected, which also handles "Mega Rayquaza" finding Rayquaza.
 */
function japaneseCandidates(query: string, names: NameTable): string[] {
  const reversed = new Map<string, string>();
  for (const [japanese, english] of Object.entries(names.species)) {
    reversed.set(english.toLowerCase(), japanese);
  }

  const whole = reversed.get(query.trim().toLowerCase());
  if (whole) return [whole];

  const found = query
    .toLowerCase()
    .split(/[\s-]+/)
    .map((word) => reversed.get(word))
    .filter((value): value is string => Boolean(value));

  return [...new Set(found)];
}

/** Caches a promise per key, so a repeated lookup costs nothing and a failure is not retried. */
function cached<T>(store: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const existing = store.get(key);
  if (existing) return existing;
  const fresh = make();
  store.set(key, fresh);
  return fresh;
}

/**
 * Every Japanese set id, fetched once.
 *
 * Used to recognise a set code typed into the search box, and to tell whether a mirrored
 * set has been published. One request per session answers both.
 */
let japaneseSets: Promise<Map<string, string>> | null = null;

function setIndex(): Promise<Map<string, string>> {
  japaneseSets ??= (async () => {
    try {
      const response = await fetch(`${JA}/sets`);
      if (!response.ok) return new Map<string, string>();
      const sets = (await response.json()) as { id: string }[];
      return new Map(sets.map((set) => [set.id.toLowerCase(), set.id]));
    } catch {
      // Offline. An empty index just means no query is read as naming a set.
      return new Map<string, string>();
    }
  })();
  return japaneseSets;
}

/** One set, whole, fetched at most once per session. Both catalogs share the cache. */
const setCards = new Map<string, Promise<CardHit[]>>();

function cardsInSet(base: string, setId: string): Promise<CardHit[]> {
  return cached(setCards, `${base}/${setId}`, async () => {
    try {
      const response = await fetch(`${base}/sets/${encodeURIComponent(setId)}`);
      if (!response.ok) return [];
      const set = (await response.json()) as { cards?: CardHit[] };
      return set.cards ?? [];
    } catch {
      return [];
    }
  });
}

/**
 * A query read as "this set, and this card within it".
 *
 * A card in a shop is labelled with its set code and its number, and that is how they
 * get typed. Recognising the pattern turns the search into one request for one set,
 * filtered locally — instead of a catalog-wide name search that returns thirty years of
 * Pikachus and has to be paged through.
 */
interface ScopedQuery {
  /** As TCGdex writes it for a published set, or the Japanese code for a mirrored one. */
  setCode: string;
  english: string | null;
  /** Everything after the set code: a number, a name, or nothing. */
  rest: string;
}

async function parseScoped(text: string): Promise<ScopedQuery | null> {
  const match = text.trim().match(/^([A-Za-z0-9.+-]{1,12}?)(?:[\s-]+(.*))?$/);
  if (!match) return null;

  const [, code, rest = ''] = match;
  const mirror = MIRRORED_SETS.find((entry) => entry.japanese.toLowerCase() === code.toLowerCase());
  if (mirror && !(await setIndex()).has(code.toLowerCase())) {
    return { setCode: mirror.japanese, english: mirror.english, rest: rest.trim() };
  }

  const known = (await setIndex()).get(code.toLowerCase());
  return known ? { setCode: known, english: null, rest: rest.trim() } : null;
}

/**
 * The cards of one set that the rest of the query picks out.
 *
 * An empty rest means the whole set. A number means that card. Anything else is matched
 * against the name — which is the case `M6a moltres` used to fall through, leaving the
 * set unfiltered and the wanted card buried a hundred rows down.
 */
function withinSet(cards: CardHit[], rest: string, terms: string[]): CardHit[] {
  if (rest === '') return cards;

  const number = rest.match(/^([0-9]{1,4})[A-Za-z]?$/)?.[1];
  if (number) {
    const padded = number.padStart(3, '0');
    const exact = cards.filter((card) => card.localId === padded || card.localId === number);
    if (exact.length > 0) return exact;
  }

  const needles = [rest.toLowerCase(), ...terms.map((term) => term.toLowerCase())];
  return cards.filter((card) => {
    const name = card.name.toLowerCase();
    return needles.some((needle) => name.includes(needle));
  });
}

/**
 * Stand-ins from the mirror sets, for a query that did not name one.
 *
 * Capped and sorted last: the 30th Anniversary set is 34 Pikachus out of 158 cards, so an
 * unbounded tail would be the whole first screenful of a plain Pikachu search.
 */
async function mirrorTail(text: string, names: NameTable): Promise<CardHit[]> {
  const needle = toEnglish(text.trim(), names).toLowerCase();
  const published = await setIndex();
  const hits: CardHit[] = [];

  for (const mirror of MIRRORED_SETS) {
    if (published.has(mirror.japanese.toLowerCase())) continue;

    for (const card of await cardsInSet(EN, mirror.english)) {
      if (!card.name.toLowerCase().includes(needle)) continue;
      hits.push({ ...card, mirrorOf: { setCode: mirror.japanese, setName: mirror.setName } });
      if (hits.length >= MIRROR_TAIL) return hits;
    }
  }

  return hits;
}

async function query(base: string, name: string, page: number): Promise<CardHit[]> {
  const response = await fetch(
    `${base}/cards?name=like:${encodeURIComponent(name)}` +
      `&pagination:page=${page}&pagination:itemsPerPage=${PAGE_SIZE}`,
  );
  if (!response.ok) throw new Error(`Catalog search failed (${response.status})`);
  return (await response.json()) as CardHit[];
}

/** One page of results, and whether asking for the next one is worth doing. */
export interface SearchPage {
  hits: CardHit[];
  hasMore: boolean;
}

/**
 * One page of the catalog, for a query.
 *
 * Paged rather than returned whole because a common species has hundreds of printings:
 * "Pikachu" is over a thousand cards. The first page is what almost every search needs,
 * and the rest is fetched only if someone scrolls to the end of it.
 *
 * `page` is 1-based, matching TCGdex. Stand-ins for unpublished sets (see MIRRORED_SETS)
 * are a fixed local list rather than a paged endpoint, so they are added once, on the
 * first page, and never repeated.
 */
export async function searchCards(text: string, names: NameTable, page = 1): Promise<SearchPage> {
  const trimmed = text.trim();
  if (trimmed.length < 2) return { hits: [], hasMore: false };

  // A pasted card id is an exact answer; try it before guessing at names.
  if (looksLikeCardId(trimmed)) {
    const id = toCardId(trimmed);
    if (id) {
      try {
        const exact = await cardDetail(id);
        return { hits: [{ id: exact.id, localId: exact.localId, name: exact.name, image: exact.image }], hasMore: false };
      } catch {
        // Not a real id after all; fall through, where the set code is recognised and the
        // number is matched inside that one set instead.
      }
    }
  }

  const terms = hasLatin(trimmed) ? japaneseCandidates(trimmed, names) : [trimmed];
  if (terms.length === 0) {
    // Nothing recognisable as a species; try it verbatim in case it is a trainer or an
    // item card, whose names are not in the species table.
    terms.push(trimmed);
  }

  const scoped = await parseScoped(trimmed);
  const hits = scoped ? await searchSet(scoped, terms) : await searchCatalog(trimmed, terms, names, page);

  // Cards TCGdex has no artwork for sort last. Ordering by id put the 1996 sets first,
  // so the first screenful of any search was blank frames — the cards least likely to be
  // the one in your hand. Stand-ins sort after real entries for the same reason: they
  // are the answer only when nothing above them is.
  const sorted = hits.sort((a, b) => {
    const art = Number(Boolean(b.image)) - Number(Boolean(a.image));
    if (art !== 0) return art;
    const standIn = Number(Boolean(a.mirrorOf)) - Number(Boolean(b.mirrorOf));
    return standIn !== 0 ? standIn : a.id.localeCompare(b.id);
  });

  // A whole set arrives in one request, so paging through it costs nothing more.
  if (scoped) {
    return { hits: sorted.slice(0, page * PAGE_SIZE), hasMore: sorted.length > page * PAGE_SIZE };
  }

  return { hits: sorted, hasMore: hits.length >= PAGE_SIZE };
}

/** One named set, filtered by whatever followed the code. One request, cached. */
async function searchSet(scoped: ScopedQuery, terms: string[]): Promise<CardHit[]> {
  if (scoped.english) {
    const cards = withinSet(await cardsInSet(EN, scoped.english), scoped.rest, terms);
    return cards.map((card) => ({
      ...card,
      mirrorOf: {
        setCode: scoped.setCode,
        setName: MIRRORED_SETS.find((entry) => entry.english === scoped.english)?.setName ?? scoped.setCode,
      },
    }));
  }

  return withinSet(await cardsInSet(JA, scoped.setCode), scoped.rest, terms);
}

/** The whole catalog by name, plus a short tail of stand-ins on the first page. */
async function searchCatalog(
  trimmed: string,
  terms: string[],
  names: NameTable,
  page: number,
): Promise<CardHit[]> {
  const results = await Promise.all(terms.map((term) => query(JA, term, page).catch(() => [])));
  const unique = new Map<string, CardHit>();
  for (const hit of results.flat()) unique.set(hit.id, hit);

  // Always, not only when the Japanese search came up empty: a set the catalog is
  // missing holds cards whose species appear in plenty of sets it does have.
  if (page === 1) {
    for (const hit of await mirrorTail(trimmed, names)) unique.set(hit.id, hit);
  }

  return [...unique.values()];
}

export async function cardDetail(cardId: string, language: 'ja' | 'en' = 'ja'): Promise<CardDetail> {
  const response = await fetch(`${language === 'en' ? EN : JA}/cards/${encodeURIComponent(cardId)}`);
  if (!response.ok) throw new Error(`Could not load ${cardId} (${response.status})`);
  return (await response.json()) as CardDetail;
}

/**
 * The printing to record.
 *
 * Pricing hangs off the variant, so storing a card without one values a different
 * product. When nothing is priced there is no useful choice, and the card falls through
 * to a manual override instead.
 */
export function pricedVariantId(detail: CardDetail): string | undefined {
  const priced = (detail.variants_detailed ?? []).filter((variant) => variant.pricing?.cardmarket);
  return priced[0]?.variantId;
}
