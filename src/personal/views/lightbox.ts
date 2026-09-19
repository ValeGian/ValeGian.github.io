/**
 * The card, as large as the screen allows.
 *
 * Lives on the body rather than inside the view, because the view is rebuilt on every
 * state change and an overlay in that tree would be destroyed mid-look. Opening it is
 * not state worth persisting: it closes on Escape, on a click outside, and on the
 * button, and it puts keyboard focus back where it came from.
 */
import { el } from '../lib/dom.ts';

let open: HTMLElement | null = null;

export function closeLightbox(): void {
  open?.remove();
  open = null;
  document.removeEventListener('keydown', onKey);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLightbox();
  }
}

export function openLightbox(source: string, alt: string): void {
  closeLightbox();

  const returnFocusTo = document.activeElement as HTMLElement | null;

  const close = el('button', {
    type: 'button',
    class: 'lightbox-close',
    'aria-label': 'Close',
    text: 'Close',
    onClick: () => {
      closeLightbox();
      returnFocusTo?.focus?.();
    },
  });

  const overlay = el(
    'div',
    {
      class: 'lightbox',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': alt,
      onClick: (event: MouseEvent) => {
        // Only a click on the backdrop, not on the picture itself.
        if (event.target === overlay) {
          closeLightbox();
          returnFocusTo?.focus?.();
        }
      },
    },
    close,
    el('img', { class: 'lightbox-image', src: source, alt }),
  );

  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  close.focus();
  open = overlay;
}
