import { el } from '../lib/dom.ts';
import { openLightbox } from './lightbox.ts';

/**
 * Card artwork that survives a flaky CDN.
 *
 * assets.tcgdex.net answers 503 intermittently when it is asked for several pictures in
 * a row — measured on 2026-09-20, where SV2a 166 gave 200, then 503 on the next pass,
 * then 200 again a minute later, with its neighbours recovering in between. A first
 * failure therefore usually means "ask again", not "there is no such picture", and
 * without a retry a single bad moment leaves a card blank until the page is reloaded.
 *
 * Whatever the outcome, a card never shows a broken-image icon: the image is replaced by
 * the same empty frame used for a card the catalog has no artwork for.
 */
const RETRY_AFTER_MS = 1200;

interface ArtworkOptions {
  source: string;
  alt: string;
  className: string;
  loading: 'lazy' | 'eager';
  size?: { width: number; height: number };
  /** What takes the place of the picture once it has failed twice. */
  whenBroken: () => HTMLElement;
  /**
   * Wraps the image where it needs wrapping. The wrapper is what gets replaced on
   * failure — a lightbox button with no picture in it is a button onto nothing.
   */
  wrap?: (image: HTMLImageElement) => HTMLElement;
}

export function artwork(options: ArtworkOptions): HTMLElement {
  let hasRetried = false;

  const image = el('img', {
    class: options.className,
    src: options.source,
    alt: options.alt,
    loading: options.loading,
    ...options.size,
    onError: () => {
      if (!hasRetried) {
        hasRetried = true;
        setTimeout(() => {
          // Eager for the second attempt: a lazily-loaded image that is re-pointed at a
          // URL deferred the fetch indefinitely — measured in Chrome, where the retry
          // produced no request at all. By now the picture is wanted, so ask for it.
          image.loading = 'eager';
          // The same URL, deliberately: a cache-busting parameter would make every later
          // load miss the cache too, to fix a failure that is usually gone by now.
          image.removeAttribute('src');
          image.src = options.source;
        }, RETRY_AFTER_MS);
        return;
      }
      node.replaceWith(options.whenBroken());
    },
  });

  const node = options.wrap ? options.wrap(image) : image;
  return node;
}

/**
 * The big picture on a card's detail panel, clickable to enlarge.
 *
 * Shared by the collection detail and the wishlist detail, which showed the same picture
 * in the same frame and differed only in the sentence used when there is nothing to show.
 */
export function artworkPanel(options: { source: string | null; alt: string; emptyText: string }): HTMLElement {
  const empty = () => el('div', { class: 'detail-image detail-image-empty ui', text: options.emptyText });
  if (!options.source) return empty();

  const source = options.source;
  return artwork({
    source,
    alt: options.alt,
    className: 'detail-image',
    // Never lazy. The picture is the reason the panel was opened, and a lazily-loaded
    // one measurably did not load at all: inserted into an open detail panel, in the
    // viewport, Chrome made no request for it until the attribute was changed. Cards
    // looked like they had no artwork when the catalog had it all along.
    loading: 'eager',
    whenBroken: empty,
    wrap: (image) =>
      el(
        'button',
        {
          type: 'button',
          class: 'detail-image-button',
          'aria-label': `See ${options.alt} larger`,
          onClick: () => openLightbox(source, options.alt),
        },
        image,
      ),
  });
}
