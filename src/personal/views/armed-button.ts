import { el } from '../lib/dom.ts';

/**
 * A button for something that cannot be undone, which asks in two taps.
 *
 * The first tap arms it and the label says so; the second does the thing. This is here
 * instead of `confirm()`, which blocks the tab until it is answered and, on a phone, is
 * a grey box with two identical grey buttons — the least legible way to ask about the
 * one action on screen that has no undo.
 *
 * It disarms itself after a few seconds, so a button left armed on a pocketed phone is
 * not still waiting when it comes out.
 */
const ARMED_MS = 5000;

export function armedButton(options: {
  label: string;
  /** What it says once armed. Short: it replaces the label in the same space. */
  armedLabel: string;
  className: string;
  title?: string;
  onConfirm: () => void;
}): HTMLButtonElement {
  let armed = false;
  let forget: ReturnType<typeof setTimeout> | undefined;

  const disarm = () => {
    armed = false;
    button.textContent = options.label;
    button.classList.remove('armed');
  };

  const button = el('button', {
    type: 'button',
    class: options.className,
    text: options.label,
    title: options.title,
    onClick: () => {
      if (armed) {
        clearTimeout(forget);
        options.onConfirm();
        return;
      }

      armed = true;
      button.textContent = options.armedLabel;
      button.classList.add('armed');
      forget = setTimeout(disarm, ARMED_MS);
    },
  });

  return button;
}
