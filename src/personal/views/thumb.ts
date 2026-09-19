import { el } from '../lib/dom.ts';
import { thumbnail } from '../lib/data.ts';

/**
 * A card thumbnail that degrades quietly.
 *
 * The catalog can list a card before its artwork exists — normal for a set published
 * days ago — so a missing image and a failed one both end as the same empty frame rather
 * than a broken-image icon.
 */
export function cardThumb(item: { imageBase?: string }, size = { width: 40, height: 56 }): HTMLElement {
  const source = thumbnail(item);
  if (!source) return el('span', { class: 'thumb thumb-empty', 'aria-hidden': 'true' });

  const image = el('img', {
    class: 'thumb',
    src: source,
    alt: '',
    loading: 'lazy',
    ...size,
    onError: () => image.replaceWith(el('span', { class: 'thumb thumb-empty', 'aria-hidden': 'true' })),
  });

  return image;
}
