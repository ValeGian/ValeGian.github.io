/**
 * A line chart, drawn as SVG by hand.
 *
 * One series, so there is no legend: the title names it. The axes and grid are solid
 * hairlines a shade off the surface, the line is thin, and only the last point carries a
 * label — a number beside every point is noise that goes unread. Everything else is in
 * the crosshair tooltip.
 *
 * Written rather than pulled in, for the same reason the rest of the app is: a charting
 * library would be a dependency to keep current for years, and this is one polyline.
 */
import { el } from '../lib/dom.ts';
import { money } from '../lib/money.ts';
import type { Point, Range } from '../lib/history.ts';

const WIDTH = 720;
const PLOT_HEIGHT = 200;
/** Room for the date labels, so the axis is never cropped out of a fixed-height box. */
const AXIS_HEIGHT = 26;
const PAD = { top: 12, right: 56, bottom: 8, left: 8 };

const svgEl = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

const shortDate = (at: number, bucket: Range['bucket']): string =>
  new Intl.DateTimeFormat('en-GB', bucket === 'month' ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }).format(at);

/** Four ticks is enough to read a level without the grid competing with the line. */
function ticks(min: number, max: number): number[] {
  if (min === max) return [min];
  const step = (max - min) / 3;
  return [0, 1, 2, 3].map((i) => min + step * i);
}

export interface ChartOptions {
  points: Point[];
  range: Range;
  label: string;
}

export function renderChart({ points, range, label }: ChartOptions): HTMLElement {
  if (points.length < 2) {
    // One reading is a figure, not a trend. Drawing a line through it would imply a
    // shape that has not been measured.
    return el('p', {
      class: 'chart-empty ui',
      text:
        points.length === 0
          ? 'No readings in this range yet.'
          : 'One reading so far. The line starts once there are two — the series began the day tracking did.',
    });
  }

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // A flat series would otherwise divide by zero; give it a band to sit in the middle of.
  const pad = rawMax === rawMin ? Math.max(rawMax * 0.1, 1) : (rawMax - rawMin) * 0.12;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const innerWidth = WIDTH - PAD.left - PAD.right;
  const x = (index: number) => PAD.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => PAD.top + (1 - (value - min) / (max - min)) * (PLOT_HEIGHT - PAD.top - PAD.bottom);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${WIDTH} ${PLOT_HEIGHT + AXIS_HEIGHT}`,
    class: 'chart',
    role: 'img',
    'aria-label': `${label}, ${points.length} readings`,
    preserveAspectRatio: 'none',
  });

  for (const value of ticks(rawMin, rawMax)) {
    const at = y(value);
    svg.append(svgEl('line', { x1: PAD.left, x2: WIDTH - PAD.right, y1: at, y2: at, class: 'chart-grid' }));
    const text = svgEl('text', { x: WIDTH - PAD.right + 8, y: at + 4, class: 'chart-axis' });
    text.textContent = money(value);
    svg.append(text);
  }

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`).join(' ');
  svg.append(svgEl('path', { d: path, class: 'chart-line' }));

  const last = points.at(-1) as Point;
  svg.append(svgEl('circle', { cx: x(points.length - 1), cy: y(last.value), r: 4, class: 'chart-point' }));

  for (const [index, point] of points.entries()) {
    if (index !== 0 && index !== points.length - 1 && points.length > 6) continue;
    const text = svgEl('text', { x: x(index), y: PLOT_HEIGHT + 18, class: 'chart-axis chart-axis-x' });
    text.setAttribute('text-anchor', index === 0 ? 'start' : 'end');
    text.textContent = shortDate(point.at, range.bucket);
    svg.append(text);
  }

  const crosshair = svgEl('line', { y1: PAD.top, y2: PLOT_HEIGHT - PAD.bottom, class: 'chart-crosshair', opacity: 0 });
  const marker = svgEl('circle', { r: 5, class: 'chart-hover', opacity: 0 });
  svg.append(crosshair, marker);

  const tooltip = el('div', { class: 'chart-tooltip ui', hidden: true });
  const frame = el('div', { class: 'chart-frame' }, svg, tooltip);

  const show = (event: PointerEvent) => {
    const box = svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    const index = Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))));
    const point = points[index];

    crosshair.setAttribute('x1', String(x(index)));
    crosshair.setAttribute('x2', String(x(index)));
    crosshair.setAttribute('opacity', '1');
    marker.setAttribute('cx', String(x(index)));
    marker.setAttribute('cy', String(y(point.value)));
    marker.setAttribute('opacity', '1');

    tooltip.hidden = false;
    tooltip.textContent = `${shortDate(point.at, range.bucket)} · ${money(point.value)}`;
    tooltip.style.left = `${(x(index) / WIDTH) * 100}%`;
  };

  const hide = () => {
    crosshair.setAttribute('opacity', '0');
    marker.setAttribute('opacity', '0');
    tooltip.hidden = true;
  };

  frame.addEventListener('pointermove', show);
  frame.addEventListener('pointerleave', hide);

  return frame;
}

export function renderRangeTabs(current: Range, ranges: Range[], onPick: (range: Range) => void): HTMLElement {
  return el(
    'div',
    { class: 'chips range-tabs', role: 'tablist' },
    ...ranges.map((range) =>
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(range.key === current.key),
        class: range.key === current.key ? 'chip on' : 'chip',
        text: range.label,
        onClick: () => onPick(range),
      }),
    ),
  );
}
