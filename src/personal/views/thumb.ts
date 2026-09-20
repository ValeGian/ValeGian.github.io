import { el } from '../lib/dom.ts';
import { thumbnail } from '../lib/data.ts';
import { artwork } from './artwork.ts';

/**
 * A card thumbnail that degrades quietly.
 *
 * The catalog can list a card before its artwork exists — normal for a set published
 * days ago — so a missing image and a failed one both end as the same empty frame rather
 * than a broken-image icon.
 */
export function cardThumb(
  item: { imageBase?: string; photoUrl?: string; cardId?: string; setId?: string; number?: string },
  size = { width: 40, height: 56 },
  /**
   * Search results are eager: they appear because someone just asked for them, and
   * deferring the one thing that tells the cards apart defeats the search. A long
   * collection list stays lazy.
   */
  loading: 'lazy' | 'eager' = 'lazy',
): HTMLElement {
  const source = thumbnail(item);
  const empty = () => el('span', { class: 'thumb thumb-empty', 'aria-hidden': 'true' });
  if (!source) return empty();

  return artwork({ source, alt: '', className: 'thumb', loading, size, whenBroken: empty });
}
