/**
 * The smallest amount of DOM plumbing this app needs.
 *
 * No framework: the site ships no JavaScript anywhere else, and a dependency that has to
 * be kept current for years is exactly the maintenance this project is trying to avoid.
 * Views are pure functions from state to elements, and the whole view is rebuilt when
 * state changes — at a few hundred rows that is imperceptible and removes every class of
 * bug that comes from patching the DOM by hand.
 */

type Child = Node | string | number | null | false | undefined;

interface Props {
  class?: string;
  text?: string;
  html?: never;
  [attribute: string]: unknown;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in node && typeof value !== 'string') {
      // Properties such as `hidden`, `disabled`, `value` must be set, not attributed.
      (node as unknown as Record<string, unknown>)[key] = value;
    } else {
      node.setAttribute(key, String(value));
    }
  }

  for (const child of children.flat(Infinity as 1)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }

  return node;
}

export const frag = (...children: Child[]): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  for (const child of children.flat(Infinity as 1)) {
    if (child === null || child === undefined || child === false) continue;
    fragment.append(child instanceof Node ? child : String(child));
  }
  return fragment;
};

/**
 * Rebuilds the view without throwing away what the person was doing.
 *
 * Views are rebuilt wholesale, which is simple and fast but replaces the element the
 * caret is sitting in — so a search box lost focus on every keystroke and only ever
 * received one character. The focused control is identified by its id, which is why
 * every input the app renders carries a stable one, and its caret position is put back
 * where it was.
 */
export function rebuildPreservingFocus(rebuild: () => void): void {
  const active = document.activeElement;
  const id = active instanceof HTMLElement ? active.id : '';
  const text = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
  const start = text?.selectionStart ?? null;
  const end = text?.selectionEnd ?? null;

  rebuild();

  if (!id) return;
  const restored = document.getElementById(id);
  if (!(restored instanceof HTMLElement)) return;

  restored.focus({ preventScroll: true });

  if (start !== null && (restored instanceof HTMLInputElement || restored instanceof HTMLTextAreaElement)) {
    try {
      restored.setSelectionRange(start, end);
    } catch {
      // Date, number and colour inputs refuse a selection range; focus alone is enough.
    }
  }
}

export function need<T extends Element>(selector: string, within: ParentNode = document): T {
  const found = within.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}
