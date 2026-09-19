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

export function need<T extends Element>(selector: string, within: ParentNode = document): T {
  const found = within.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}
