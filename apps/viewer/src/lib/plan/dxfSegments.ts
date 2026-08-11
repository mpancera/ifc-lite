/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning an imported plan into the line segments a room detector can use.
 *
 * The detector is already there and is not tied to IFC: it takes plain 2D
 * segments and returns the enclosed regions between them. What it has been fed
 * so far is wall axes out of a model. A drawing is the other source of the same
 * thing — so this is an adapter, not a second detector.
 *
 * Underlay geometry arrives already tessellated: the DXF converter flattens
 * arcs, splines and polylines into point sequences, so a path is a polyline and
 * a segment is a consecutive pair. Nothing here re-approximates curves.
 *
 * ## Layers are the whole problem
 *
 * A sales-stage floor plan carries furniture, dimension lines, hatching, north
 * arrows and text. Feeding all of it to the detector produces regions bounded
 * by a dimension line and half a desk — technically enclosed, and meaningless
 * as rooms. Choosing which layers describe the BUILDING is the one judgement a
 * person has to make, and it cannot be guessed reliably from names: offices
 * name their layers `A-WALL`, `WAND`, `01_Waende`, `S-WALL-FULL`.
 *
 * So this takes an explicit selection. {@link suggestWallLayers} offers a
 * starting point from common naming, clearly as a SUGGESTION — accepting it
 * blindly would produce a confident wrong answer, which is worse than an empty
 * one somebody has to fix.
 */

import { applyDxfPlacement } from '@ifc-lite/drawing-2d';
import type { DxfUnderlayState } from '@/store/slices/drawing2DSlice';

/** What the detector consumes. Matches `Segment` in the auto-space detector. */
export interface PlanSegment {
  a: [number, number];
  b: [number, number];
}

export interface DxfSegmentOptions {
  /**
   * Which layers to read. Empty means none — deliberately not "all", because
   * everything-by-default is exactly the setting that yields nonsense regions
   * on the first try and teaches people the feature does not work.
   */
  layers: readonly string[];
  /**
   * Drop segments shorter than this, in metres. Hatching and text outlines
   * arrive as thousands of tiny segments that cost time and close nothing.
   * `0` keeps everything.
   */
  minLength?: number;
}

const DEFAULT_MIN_LENGTH = 0.02;

/**
 * The segments of the chosen layers, in drawing space.
 *
 * Placement is applied, so the segments sit where the plan is SEEN — the same
 * space the model's own geometry is in, which is what makes a detected room
 * comparable with the model at all.
 */
export function dxfSegments(
  state: DxfUnderlayState,
  options: DxfSegmentOptions,
): PlanSegment[] {
  const wanted = new Set(options.layers);
  if (wanted.size === 0) return [];

  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  const segments: PlanSegment[] = [];

  for (const layer of state.underlay.layers) {
    if (!wanted.has(layer.name)) continue;

    for (const path of layer.paths) {
      const points = path.points;
      if (points.length < 2) continue;

      // A closed path's last vertex does not repeat the first, so the closing
      // edge has to be added explicitly — leaving it out opens every room that
      // was drawn as one polyline.
      const count = path.closed ? points.length : points.length - 1;

      for (let i = 0; i < count; i += 1) {
        const from = applyDxfPlacement(points[i], state.placement);
        const to = applyDxfPlacement(points[(i + 1) % points.length], state.placement);

        if (Math.hypot(to.x - from.x, to.y - from.y) < minLength) continue;
        segments.push({ a: [from.x, from.y], b: [to.x, to.y] });
      }
    }
  }

  return segments;
}

/** What one layer contributes, for a picker that has to be decided in a glance. */
export interface LayerSummary {
  name: string;
  /** Segments it would contribute at the current settings. */
  segments: number;
  /** Text items on it — a layer that is mostly text is a labelling layer. */
  texts: number;
  /** Whether the DXF itself starts it hidden. */
  visible: boolean;
  /** True when the name looks like a wall layer. A hint, never a decision. */
  suggested: boolean;
}

/**
 * Every layer with enough about it to choose from.
 *
 * Counts rather than names are what makes this decidable: a wall layer of a
 * whole floor has hundreds of segments and almost no text, a furniture layer
 * has thousands, a room-label layer is nearly all text.
 */
export function summariseLayers(
  state: DxfUnderlayState,
  minLength = DEFAULT_MIN_LENGTH,
): LayerSummary[] {
  return state.underlay.layers.map((layer) => {
    let segments = 0;
    for (const path of layer.paths) {
      const points = path.points;
      if (points.length < 2) continue;
      const count = path.closed ? points.length : points.length - 1;
      for (let i = 0; i < count; i += 1) {
        const from = points[i];
        const to = points[(i + 1) % points.length];
        if (Math.hypot(to.x - from.x, to.y - from.y) >= minLength) segments += 1;
      }
    }

    return {
      name: layer.name,
      segments,
      texts: layer.texts.length,
      visible: state.layerVisibility[layer.name] ?? layer.visible,
      suggested: looksLikeWallLayer(layer.name),
    };
  });
}

/**
 * Layer names that commonly carry walls, as a starting selection.
 *
 * Offered, never applied on its own. The naming is an office convention, not a
 * standard — `A-WALL`, `WAND`, `01_Waende`, `S-WALL-FULL` all occur — so a
 * match is a reason to look, and a miss is not a reason to exclude.
 */
export function suggestWallLayers(state: DxfUnderlayState): string[] {
  return state.underlay.layers
    .filter((l) => looksLikeWallLayer(l.name) && l.paths.length > 0)
    .map((l) => l.name);
}

const WALL_WORDS = ['wall', 'wand', 'waende', 'wände', 'mur', 'muro', 'parete'];

function looksLikeWallLayer(name: string): boolean {
  const lower = name.toLowerCase();
  // Substring, not equality: real names are `A-WALL-FULL`, `01_Waende_tragend`.
  return WALL_WORDS.some((word) => lower.includes(word));
}
