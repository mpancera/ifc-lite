/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Binds `prealignDxf` to an underlay and the drawing it belongs over.
 *
 * The estimator works on polylines in ONE space; getting both into that space
 * is the only thing it cannot do for itself, because the render frame — the
 * origin shift, the mirror of a flipped section, the map transform of a
 * georeferenced drawing — is the viewer's knowledge. So the underlay is mapped
 * through the same `dxfUnderlayToDrawing` the renderer uses, with the
 * placement neutralised: the question is which placement to produce, and
 * feeding in the old one would ask the estimator to correct its own answer.
 */

import { DEFAULT_DXF_PLACEMENT, prealignDxf, type Point2D, type PrealignResult } from '@ifc-lite/drawing-2d';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import type { DxfUnderlayState } from '@/store/slices/drawing2DSlice';
import { dxfUnderlayToDrawing } from './dxfUnderlayMath.js';

/**
 * Below this share of overlapping line work the estimate is not an alignment.
 *
 * Set where the message and the decision can both see it: the caller must not
 * apply a placement this file would then describe as not fitting.
 */
export const PREALIGN_MIN_FIT = 0.35;

export interface PrealignInput {
  entry: DxfUnderlayState;
  drawing: Drawing2D;
  shift: { x: number; y: number };
  mirrorX: boolean;
  mapToWorld?: (p: Point2D) => Point2D;
  georeferenceAvailable?: boolean;
}

/**
 * What the model offers as line work to match against.
 *
 * The CUT polygons first: those are the walls where the plan slices them, the
 * same lines a drawing's orientation is legible from. Projected lines below
 * the cut — a stair nosing, a kerb — point in directions the building does
 * not, and including them blurs exactly the peaks this reads.
 */
function modelLines(drawing: Drawing2D): Point2D[][] {
  const out: Point2D[][] = [];
  for (const polygon of drawing.cutPolygons) {
    if (!polygon.isCut) continue;
    const outer = polygon.polygon.outer;
    if (outer.length >= 2) out.push([...outer, outer[0]]);
  }
  if (out.length > 0) return out;
  // A drawing with no cut polygons at all — an elevation, or a plan through a
  // storey with nothing in it. The plain lines are then all there is.
  for (const line of drawing.lines) out.push([line.line.start, line.line.end]);
  return out;
}

/**
 * The placement that lays the underlay roughly over the drawing.
 *
 * `null` when there is nothing to work from, which the caller should treat as
 * "leave it alone" rather than as an identity placement — moving a drawing to
 * the origin is worse than not moving it.
 */
export function prealignUnderlay(input: PrealignInput): PrealignResult | null {
  const { entry, drawing, shift, mirrorX, mapToWorld, georeferenceAvailable } = input;
  const neutral: DxfUnderlayState = { ...entry, placement: { ...DEFAULT_DXF_PLACEMENT } };
  const rendered = dxfUnderlayToDrawing(
    neutral, shift, mirrorX, mapToWorld, georeferenceAvailable ?? false,
  );
  const source = rendered.lines.map((line) => line.points);
  if (source.length === 0) return null;

  const target = modelLines(drawing);
  if (target.length === 0) return null;

  return prealignDxf(source, target);
}

/**
 * What to tell the user, in one line.
 *
 * The FIT leads, because it is the one number that says whether this drawing
 * belongs over this plan at all. A poor fit with a confident-sounding angle is
 * the failure worth guarding against: the estimator turned a basement plan 171
 * degrees over a ground-floor drawing and reported it as an alignment, which
 * is how somebody ends up verifying rooms against the wrong storey.
 *
 * The scale is named whenever it is not one, for the reason the two-point
 * solver names it: a factor absorbed in silence is a fact nobody learns. The
 * angle is named always — it is the number they can check against the drawing
 * in front of them.
 */
export function describePrealign(result: PrealignResult): string {
  const turn = `${result.rotationDeg.toFixed(2)}° gedreht`;
  const scale = result.scale === 1
    ? ''
    : `, Massstab ${result.scale} — die Zeichnung war offenbar in anderen Einheiten`;

  if (result.fit < PREALIGN_MIN_FIT) {
    return `Die Zeichnung deckt sich nicht mit diesem Grundriss `
      + `(nur ${Math.round(result.fit * 100)} % der Linien liegen auf). `
      + `Stimmt das Geschoss? Sonst über Referenz- und Passlinie ausrichten.`;
  }
  if (result.sharpness < 1.5) {
    return 'Nur zentriert — die Zeichnung gibt keine klare Richtung her. '
      + 'Über Referenz- und Passlinie ausrichten.';
  }
  return `Grob ausgerichtet: ${turn}${scale}, `
    + `${Math.round(result.fit * 100)} % der Linien liegen auf. `
    + `Feinschliff über Referenz- und Passlinie.`;
}
