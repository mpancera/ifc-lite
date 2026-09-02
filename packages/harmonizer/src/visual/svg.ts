/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Small SVG toolkit for the stage visuals.
 *
 * Every visual is a self-contained SVG string: no fonts to load, no scripts,
 * no external references, so a document manager can drop it into a preview,
 * a viewer into a panel, and a protocol file can carry it as text. Colours
 * are fixed rather than themed, because a picture that is saved next to the
 * draft has to look the same in five years as it did on the day.
 */

export const INK = '#1f2933';
export const MUTED = '#6b7280';
export const LINE = '#d1d5db';
export const PAPER = '#ffffff';
export const PANEL = '#f3f4f6';
export const MICRO = '#f59e0b';
export const SYMBOL = '#7c3aed';

/** One colour per route and per page kind, used everywhere a route is shown. */
export const ROUTE_COLORS: Record<string, string> = {
  vector: '#2563eb',
  raster: '#b45309',
  hybrid: '#7c3aed',
  unavailable: '#dc2626',
  empty: '#9ca3af',
};

/** One colour per suggested layer role. */
export const ROLE_COLORS: Record<string, string> = {
  wall: '#1f2933',
  outline: '#2563eb',
  text: '#059669',
  exclude: '#cbd5e1',
  unknown: '#9ca3af',
};

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Integers with thousands grouping; decimals with a fixed number of digits. */
export function fmt(n: number, digits = 0): string {
  const fixed = n.toFixed(digits);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)} %`;
}

export function attrs(a: Record<string, string | number | undefined>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? round(v) : esc(String(v))}"`)
    .join('');
}

export function round(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

export function el(tag: string, a: Record<string, string | number | undefined>, children = ''): string {
  return children ? `<${tag}${attrs(a)}>${children}</${tag}>` : `<${tag}${attrs(a)}/>`;
}

export interface TextOptions {
  size?: number;
  weight?: number | 'bold';
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
  mono?: boolean;
}

export function text(x: number, y: number, s: string, o: TextOptions = {}): string {
  return el(
    'text',
    {
      x,
      y,
      'font-size': o.size ?? 12,
      'font-weight': o.weight,
      fill: o.fill ?? INK,
      'text-anchor': o.anchor,
      'font-family': o.mono ? MONO : undefined,
    },
    esc(s),
  );
}

/** Rounded label on a coloured pill. Returns the markup and the pill width. */
export function badge(x: number, y: number, label: string, color: string, size = 11): { svg: string; width: number } {
  const width = Math.round(label.length * size * 0.62 + 14);
  const height = size + 8;
  const svg =
    el('rect', { x, y, width, height, rx: height / 2, fill: color }) +
    text(x + width / 2, y + height - 6, label, { size, fill: PAPER, weight: 'bold', anchor: 'middle' });
  return { svg, width };
}

/** Horizontal bar with a light track; `fraction` is clamped to 0-1. */
export function bar(x: number, y: number, w: number, h: number, fraction: number, color: string): string {
  const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  return (
    el('rect', { x, y, width: w, height: h, rx: h / 2, fill: PANEL }) +
    (f > 0 ? el('rect', { x, y, width: Math.max(h, w * f), height: h, rx: h / 2, fill: color }) : '')
  );
}

/** Cut a string to `max` characters with an ellipsis. */
export function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Word-wrap into lines of at most `max` characters. */
export function wrap(s: string, max: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line.length === 0) line = w;
    else if (line.length + 1 + w.length <= max) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The outer element. `label` is the accessible name of the picture. */
export function root(width: number, height: number, body: string, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" role="img" aria-label="${esc(label)}" font-family="${FONT}">` +
    el('rect', { x: 0, y: 0, width, height, fill: PAPER }) +
    body +
    '</svg>'
  );
}

/** Strip the outer `<svg>` of a finished visual so it can be nested in another. */
export function inner(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
}
