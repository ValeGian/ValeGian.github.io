/**
 * Turns a Japanese card name into an English one.
 *
 * A card name is a species name wrapped in decorations: a regional or Mega form prefix,
 * a trainer's name, and a suffix like ex or VSTAR. Peel those off, translate the species
 * with the generated table, and put the decorations back in English. When the species is
 * not in the table the Japanese name is returned unchanged — a readable fallback beats a
 * wrong guess.
 */

/** Longest first, so メガ is not matched inside a longer prefix. */
const FORM_PREFIXES = [
  ['オリジンディアルガ', 'Origin Forme Dialga'],
  ['オリジンパルキア', 'Origin Forme Palkia'],
  ['ヒスイ', 'Hisuian '],
  ['アローラ', 'Alolan '],
  ['ガラル', 'Galarian '],
  ['パルデア', 'Paldean '],
  ['メガ', 'Mega '],
];

/** Longest first, so VSTAR is not matched as V. */
const SUFFIXES = ['V-UNION', 'VSTAR', 'VMAX', 'GX', 'EX', 'ex', 'V'];

/**
 * @param {string} japanese
 * @param {{ species: Record<string, string>, ownerPrefixes?: Record<string, string> }} table
 * @returns {string}
 */
export function toEnglish(japanese, table) {
  let rest = japanese.trim();
  let owner = '';
  let form = '';
  let suffix = '';

  for (const [kana, english] of Object.entries(table.ownerPrefixes ?? {})) {
    if (rest.startsWith(kana)) {
      owner = english;
      rest = rest.slice(kana.length);
      break;
    }
  }

  for (const suffixToken of SUFFIXES) {
    if (rest.endsWith(suffixToken)) {
      suffix = ` ${suffixToken}`;
      rest = rest.slice(0, -suffixToken.length);
      break;
    }
  }

  // A form prefix is only a prefix if what remains is a species we know; otherwise the
  // kana were part of the species name itself.
  for (const [kana, english] of FORM_PREFIXES) {
    if (!rest.startsWith(kana)) continue;
    const core = rest.slice(kana.length).trim();
    if (english.endsWith(' ') ? table.species[core] : core === '') {
      form = english;
      rest = core;
      break;
    }
  }

  const species = table.species[rest.trim()];
  if (!species && !form) return japanese;

  return `${owner}${form}${species ?? ''}${suffix}`.replace(/\s+/g, ' ').trim();
}
