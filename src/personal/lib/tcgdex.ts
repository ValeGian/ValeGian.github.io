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
const LIMIT = 24;

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
 * Japanese sets TCGdex has not published yet, and the English set that mirrors each.
 *
 * TCGdex publishes the English side of a worldwide release first. Four days after the
 * 30th Anniversary launch it carried the English set complete with artwork for all 158
 * cards, and no Japanese M6a at all — so a card bought on release day could not be found
 * by name, by number, or at all.
 *
 * The English twin is the same illustration at the same number, which is enough to
 * identify the card and picture it. It is not the same Cardmarket product, so a card
 * found this way is recorded as pending, under its Japanese set code, and priced only
 * once the Japanese catalog catches up.
 *
 * Delete a row when its Japanese set appears; the search then finds it directly and
 * scripts/resolve-pending.mjs fills in everything that was recorded while it was absent.
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

/**
 * One mirror set, whole, fetched at most once per session.
 *
 * A set is 158 cards and the search runs on every keystroke, so refetching it would be
 * the most wasteful thing in the app. A failure is cached as an empty set rather than
 * retried, because the alternative is retrying on every keystroke too.
 */
const mirrorCache = new Map<string, Promise<CardHit[]>>();

function cached<T>(store: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  const existing = store.get(key);
  if (existing) return existing;
  const fresh = make();
  store.set(key, fresh);
  return fresh;
}

function mirrorCards(englishSetId: string): Promise<CardHit[]> {
  return cached(mirrorCache, englishSetId, async () => {
    try {
      const response = await fetch(`${EN}/sets/${englishSetId}`);
      if (!response.ok) return [];
      const set = (await response.json()) as { cards?: CardHit[] };
      return set.cards ?? [];
    } catch {
      return [];
    }
  });
}

/**
 * Whether the Japanese set has arrived, in which case its mirror stands down.
 *
 * Without this, a row left in the table after the set is published would put an English
 * card beside its own Japanese original in the results, and the English one would be the
 * wrong thing to pick. The table still wants pruning, but forgetting costs nothing.
 */
const japaneseSetCache = new Map<string, Promise<boolean>>();

function japaneseSetExists(setCode: string): Promise<boolean> {
  return cached(japaneseSetCache, setCode, async () => {
    try {
      return (await fetch(`${JA}/sets/${encodeURIComponent(setCode)}`)).ok;
    } catch {
      // Offline: assume it is still missing, which is what it was last time we looked.
      return false;
    }
  });
}

/** True when the query opens with this set's code, so `M6a 45` means card 45 of M6a. */
function namesSet(text: string, setCode: string): boolean {
  return new RegExp(`^${setCode}\\b`, 'i').test(text.trim());
}

/**
 * Searches the mirror sets by English name, by printed number, or by set code alone.
 *
 * Scoped to those sets rather than the whole English catalog: a plain English search for
 * Pikachu returns thirty years of Pikachus and buries the one card this is for.
 */
async function searchMirrors(text: string, names: NameTable): Promise<CardHit[]> {
  const trimmed = text.trim();
  const needle = toEnglish(trimmed, names).toLowerCase();
  const number = trimmed.match(/([0-9]{1,3})$/)?.[1]?.padStart(3, '0');

  const hits: CardHit[] = [];

  for (const mirror of MIRRORED_SETS) {
    if (await japaneseSetExists(mirror.japanese)) continue;

    const bySetCode = namesSet(trimmed, mirror.japanese);
    const cap = bySetCode ? LIMIT : MIRROR_TAIL;
    const cards = await mirrorCards(mirror.english);

    for (const card of cards) {
      const matches = bySetCode
        ? !number || card.localId === number
        : card.name.toLowerCase().includes(needle);
      if (!matches) continue;
      hits.push({ ...card, mirrorOf: { setCode: mirror.japanese, setName: mirror.setName } });
      if (hits.length >= cap) break;
    }
  }

  return hits;
}

async function query(base: string, name: string): Promise<CardHit[]> {
  const response = await fetch(
    `${base}/cards?name=like:${encodeURIComponent(name)}&pagination:itemsPerPage=${LIMIT}`,
  );
  if (!response.ok) throw new Error(`Catalog search failed (${response.status})`);
  return (await response.json()) as CardHit[];
}

export async function searchCards(text: string, names: NameTable): Promise<CardHit[]> {
  const trimmed = text.trim();
  if (trimmed.length < 2) return [];

  // A pasted card id is an exact answer; try it before guessing at names.
  if (looksLikeCardId(trimmed)) {
    const id = toCardId(trimmed);
    if (id) {
      try {
        const exact = await cardDetail(id);
        return [{ id: exact.id, localId: exact.localId, name: exact.name, image: exact.image }];
      } catch {
        // Not a real id after all. A code from a set the catalog is missing lands here,
        // so try the mirrors before falling through to a name search.
        const mirrored = await searchMirrors(trimmed, names);
        if (mirrored.length > 0) return mirrored;
      }
    }
  }

  const terms = hasLatin(trimmed) ? japaneseCandidates(trimmed, names) : [trimmed];
  if (terms.length === 0) {
    // Nothing recognisable as a species; try it verbatim in case it is a trainer or an
    // item card, whose names are not in the species table.
    terms.push(trimmed);
  }

  const results = await Promise.all(terms.map((term) => query(JA, term).catch(() => [])));
  const unique = new Map<string, CardHit>();
  for (const hit of results.flat()) unique.set(hit.id, hit);

  // Always, not only when the Japanese search came up empty: a set the catalog is
  // missing holds cards whose species appear in plenty of sets it does have.
  for (const hit of await searchMirrors(trimmed, names)) unique.set(hit.id, hit);

  // Cards TCGdex has no artwork for sort last. Ordering by id put the 1996 sets first,
  // so the first screenful of any search was blank frames — the cards least likely to
  // be the one in your hand. Stand-ins sort after real entries for the same reason: they
  // are the answer only when nothing above them is.
  return [...unique.values()].sort((a, b) => {
    const art = Number(Boolean(b.image)) - Number(Boolean(a.image));
    if (art !== 0) return art;
    const standIn = Number(Boolean(a.mirrorOf)) - Number(Boolean(b.mirrorOf));
    return standIn !== 0 ? standIn : a.id.localeCompare(b.id);
  });
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
