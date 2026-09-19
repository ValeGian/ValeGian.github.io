/**
 * Inline SVG, drawn in the current text colour.
 *
 * Not emoji: those render differently on every platform, can come out monochrome or
 * missing, and would be the only pictographs on a site that is otherwise typographic.
 */
const svg = (children: string, label: string): SVGSVGElement => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 16 16');
  node.setAttribute('width', '16');
  node.setAttribute('height', '16');
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', '1.6');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.innerHTML = children;
  node.dataset.icon = label;
  return node;
};

/** A rising line over an axis — the shape of what the button reveals. */
export const chartIcon = (): SVGSVGElement => svg('<path d="M2 13.5h12" /><path d="M3 11l3.5-4 3 2.5L14 3.5" />', 'chart');
