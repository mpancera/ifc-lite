/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A catalogue symbol as geometry, for the exports that cannot take a picture.
 *
 * # Why a parser and not the image
 * On screen a symbol is an `<image>` with a data URI, which keeps its fills
 * and costs nothing. A DXF has no such thing: a CAD file carries entities, and
 * a receiving draughtsman wants to snap to them, put them on a layer and count
 * them. So the drawing has to arrive as polylines and circles.
 *
 * This is only possible because the catalogue's drawing rules were written for
 * it: **paths use `M`, `L` and `Z` only, and the sole other element is
 * `<circle>`**. Measured across all 76 drawings — 3603 `L`, 387 `M`, 167 `Z`,
 * 77 circles, no curve command anywhere. A parser for the general SVG path
 * grammar would be a great deal more code for cases the catalogue forbids, and
 * would quietly accept a drawing that later exports wrong.
 *
 * Anything the rules do not allow makes this abstain (`null`) rather than
 * guess: half a symbol in a CAD file is worse than the family glyph, because
 * it looks like a complete symbol.
 *
 * # Two sources, two looks
 * The association's drawings (SES) arrive alongside the authority's (VKF) and
 * are black line art where the VKF ones are red plates with white strokes. So
 * the COLOURS are read from the drawing rather than assumed: a symbol used by
 * permission has to leave here looking like itself, and re-colouring it would
 * be a modified drawing. Ellipses are read for the same reason - four of the
 * association's symbols are genuinely not circular.
 *
 * # Coordinates
 * Returned in the SVG's own units with Y pointing DOWN, exactly as written in
 * the file. Placing them — scale, flip, offset — is the caller's, because only
 * the caller knows the paper scale and which way its axes run.
 */

import { viewBoxOf } from './symbolSvg.js';

export interface SymbolPoint {
  readonly x: number;
  readonly y: number;
}

/** The colours a shape was drawn with, as written. */
export interface SymbolPaint {
  /** The `fill` was a colour rather than `none`. */
  readonly filled: boolean;
  /** That colour, or `null` when nothing was filled. */
  readonly fill: string | null;
  /** The stroke colour, or `null` when none was given. */
  readonly stroke: string | null;
}

export interface SymbolPolyline extends SymbolPaint {
  readonly points: readonly SymbolPoint[];
  /** The path ended with `Z` — the receiver should close the loop. */
  readonly closed: boolean;
}

export interface SymbolCircle extends SymbolPaint {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** A round shape that is NOT round. Kept apart from circles because a CAD
 *  receiver draws the two with different entities. */
export interface SymbolEllipse extends SymbolPaint {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

export interface SymbolGeometry {
  /** The drawing's own frame, so a caller can scale it into a mark box. */
  readonly viewBox: { minX: number; minY: number; width: number; height: number };
  readonly polylines: readonly SymbolPolyline[];
  readonly circles: readonly SymbolCircle[];
  readonly ellipses: readonly SymbolEllipse[];
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attributes);
  return match ? match[1].trim() : null;
}

/** The colours as written. `fill="none"` and an absent fill both mean
 *  "not filled"; the colour itself is kept because two sources draw in two
 *  palettes and neither may be repainted on the way out. */
function paintOf(attributes: string): SymbolPaint {
  const fill = attribute(attributes, 'fill');
  const stroke = attribute(attributes, 'stroke');
  const filled = fill !== null
    && fill.length > 0
    && fill.toLowerCase() !== 'none'
    && fill.toLowerCase() !== 'transparent';
  return {
    filled,
    fill: filled ? fill : null,
    stroke: stroke && stroke.toLowerCase() !== 'none' ? stroke : null,
  };
}

function numbersIn(text: string): number[] {
  const found = text.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  return found ? found.map(Number) : [];
}

/**
 * Split a path's `d` into polylines.
 *
 * `M` starts a run, `L` extends it, `Z` closes it. A run with fewer than two
 * points is dropped — it draws nothing, and a one-point polyline in a DXF is
 * an entity a CAD user has to hunt down and delete.
 *
 * Returns `null` when the path uses any other command, which is the abstain
 * described at the top of this file.
 */
function parsePath(d: string, paint: SymbolPaint): SymbolPolyline[] | null {
  // Commands and their operands, in order.
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return [];

  const out: SymbolPolyline[] = [];
  let current: SymbolPoint[] = [];
  let closed = false;

  const flush = () => {
    if (current.length >= 2) out.push({ points: current, closed, ...paint });
    current = [];
    closed = false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!/[A-Za-z]/.test(token)) continue;
    const command = token;
    if (command === 'M' || command === 'L') {
      // Repeated coordinate pairs are legal after one command letter.
      while (i + 2 < tokens.length + 1
        && !/[A-Za-z]/.test(tokens[i + 1] ?? 'x')
        && !/[A-Za-z]/.test(tokens[i + 2] ?? 'x')) {
        const x = Number(tokens[i + 1]);
        const y = Number(tokens[i + 2]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (command === 'M' && current.length > 0) flush();
        current.push({ x, y });
        i += 2;
      }
      continue;
    }
    if (command === 'Z' || command === 'z') {
      closed = true;
      flush();
      continue;
    }
    // A curve, a relative command, an arc — outside the catalogue's rules.
    return null;
  }
  flush();
  return out;
}

/**
 * The drawing as geometry, or `null` when it uses anything the rules forbid.
 */
export function symbolGeometryOf(svg: string): SymbolGeometry | null {
  const raw = viewBoxOf(svg);
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) return null;

  const polylines: SymbolPolyline[] = [];
  for (const match of svg.matchAll(/<path\b([^>]*)>/gi)) {
    const attributes = match[1];
    const d = /\bd\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1];
    if (!d) continue;
    const parsed = parsePath(d, paintOf(attributes));
    if (parsed === null) return null;
    polylines.push(...parsed);
  }

  const circles: SymbolCircle[] = [];
  for (const match of svg.matchAll(/<circle\b([^>]*)>/gi)) {
    const attributes = match[1];
    const cx = numbersIn(attribute(attributes, 'cx') ?? '0')[0] ?? 0;
    const cy = numbersIn(attribute(attributes, 'cy') ?? '0')[0] ?? 0;
    const r = numbersIn(attribute(attributes, 'r') ?? '')[0];
    if (!Number.isFinite(r) || r === undefined || r <= 0) return null;
    circles.push({ cx, cy, r, ...paintOf(attributes) });
  }

  const ellipses: SymbolEllipse[] = [];
  for (const match of svg.matchAll(/<ellipse\b([^>]*)>/gi)) {
    const attributes = match[1];
    const cx = numbersIn(attribute(attributes, 'cx') ?? '0')[0] ?? 0;
    const cy = numbersIn(attribute(attributes, 'cy') ?? '0')[0] ?? 0;
    const rx = numbersIn(attribute(attributes, 'rx') ?? '')[0];
    const ry = numbersIn(attribute(attributes, 'ry') ?? '')[0];
    if (rx === undefined || ry === undefined || !(rx > 0) || !(ry > 0)) return null;
    // A round ellipse IS a circle, and saying so spares every receiver the
    // special case - most of the association's are written that way.
    if (Math.abs(rx - ry) < 1e-9) circles.push({ cx, cy, r: rx, ...paintOf(attributes) });
    else ellipses.push({ cx, cy, rx, ry, ...paintOf(attributes) });
  }

  if (polylines.length === 0 && circles.length === 0 && ellipses.length === 0) return null;
  return { viewBox: { minX, minY, width, height }, polylines, circles, ellipses };
}

/**
 * Scale factor that fits a drawing into a mark of `span` across, and the
 * offset that centres it.
 *
 * `meet` semantics, the same as the screen's `preserveAspectRatio` — a plate
 * wider than it is tall keeps its proportions and uses less of the box's
 * height. Getting this wrong in the export and right on screen would give two
 * different drawings of one plan, which is the whole reason this module exists.
 */
export function symbolFit(
  viewBox: SymbolGeometry['viewBox'],
  span: number,
): { scale: number; offsetX: number; offsetY: number } {
  const scale = span / Math.max(viewBox.width, viewBox.height);
  // The viewBox is centred on the origin (the catalogue rule), so its own
  // centre is what the offset has to cancel; computing it rather than assuming
  // zero keeps this correct for a drawing that is only nearly centred.
  const centreX = viewBox.minX + viewBox.width / 2;
  const centreY = viewBox.minY + viewBox.height / 2;
  // `+ 0` turns JavaScript's negative zero back into zero: `-0 * 0.3` is `-0`,
  // which compares equal to 0 but PRINTS as `-0` — and these numbers end up
  // as text in a DXF, where a coordinate reading `-0` is the kind of detail
  // that makes a receiver wonder what else is wrong.
  return { scale, offsetX: -centreX * scale + 0, offsetY: -centreY * scale + 0 };
}
