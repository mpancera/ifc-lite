/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Rooms from a drawing rather than from walls:
 *
 *   2D segments (from an imported plan)
 *     → enclosed regions (`detectEnclosedAreas`)
 *     → IfcSpace per region (`addSpaceToStore` polygon mode)
 *
 * The second half is the same pipeline {@link generateSpacesFromWalls} uses.
 * Only the source differs — and that difference changes what the detected
 * outline MEANS, which is why this is a separate function rather than a flag.
 *
 * ## Why a drawing's outline is not a wall axis outline
 *
 * Walls give the detector their CENTRELINES, so a detected region runs to the
 * middle of the surrounding walls. That is a gross measure, and the wall path
 * insets it to the room face afterwards using each wall's thickness.
 *
 * A drawing has no thicknesses. What it has instead is both wall faces drawn
 * as two parallel lines — which is better: the region the detector finds
 * between them is ALREADY the room face. So there is no inset here, and none
 * is wanted; applying one would shrink the room by a thickness that was never
 * measured.
 *
 * Two consequences follow, and both are honoured below:
 *
 *  - **No `GrossFloorArea` is written.** The area is a net measure. Recording
 *    it under a gross name would be a wrong number in a quantity take-off,
 *    which is worse than a missing one.
 *  - **No space boundaries are written.** `IfcRelSpaceBoundary` points at the
 *    building element bounding the space, and a line on a drawing is not one.
 *    An empty relationship would claim a link to nothing.
 *
 * ## What this does not know
 *
 * Segments must arrive in **model-local metres** — the frame
 * `extractWallSegmentsForStorey` produces and the frame a storey's placement
 * is relative to. Getting a plan into that frame is the caller's job (that is
 * what aligning an underlay to the model is FOR); this function cannot check
 * it and will happily build rooms in the wrong place if it is wrong.
 */

import type { RandomSource } from '@ifc-lite/encoding';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import {
  detectEnclosedAreasWithStats,
  type DetectedSpace,
  type DetectStats,
  type Segment,
  type Vec2,
} from './auto-space-detect.js';
import {
  addSpaceToStore,
  type SpaceBuildResult,
  type SpaceInStoreParams,
} from './space.js';
import { pointInPolygon } from './generate-spaces.js';

/**
 * Marks a space as having come from a drawing, not from a model.
 *
 * Deliberately distinct from the wall-derived marker. The provenance decides
 * how much the geometry is worth: a room traced from a sales-stage plan is a
 * placeholder, one derived from modelled walls is a measurement, and a later
 * reader that cannot tell them apart will trust the wrong one.
 */
export const DRAWING_SPACE_OBJECTTYPE = 'IfcLite:DrawingSpace';

export interface GenerateSpacesFromDrawingOptions {
  /** Distance below which two endpoints are merged, in metres. Default 0.1 m. */
  snapTolerance?: number;
  /** Drop detected regions below this area, m². Default 0.5 m². */
  minArea?: number;
  /**
   * Drop regions narrower than this, metres. Default 0.35 m.
   *
   * The filter the wall path does not need. A plan draws both faces of a wall,
   * so the cavity between them is a closed region too — and a 6 m run of a
   * 0.2 m wall is 1.2 m², comfortably ABOVE any sensible minimum area. Left to
   * `minArea` alone, every wall in the drawing becomes a room.
   *
   * Width is measured as `2 × area / perimeter`, which for a long thin shape is
   * its thickness and for a compact one is roughly half its smaller side. A
   * 6 × 0.2 m cavity scores 0.19; a 1.2 × 1.5 m WC scores 0.67. Set `0` to keep
   * everything.
   */
  minWidth?: number;
  /**
   * Extrusion height, metres. Default 3.
   *
   * Normally the storey's own height, so the rooms fill the storey rather than
   * float in it — but this function does not look it up, because the caller
   * knows whether a measured height or a nominal one is meant.
   */
  height?: number;
  /** Naming pattern; `{n}` is a 1-based index. Default `'Room {n}'`. */
  namePattern?: string;
  /** Optional IfcSpacePredefinedType. Defaults to INTERNAL downstream. */
  predefinedType?: string;
  /** Optional IfcSpace.LongName, applied to every space. */
  longName?: string;
  /**
   * Footprints of spaces that already exist, model-local metres. A detected
   * room whose centroid falls inside one is not emitted.
   */
  skipFootprints?: Vec2[][];
  /** Detect and report without writing anything. */
  dryRun?: boolean;
  /** Seed for deterministic GUIDs in tests. */
  guidRandom?: RandomSource;
  /** Trace the pipeline to `console.debug`. */
  debug?: boolean;
}

export interface GenerateSpacesFromDrawingResult {
  /** Segments the detector was given. */
  segmentsConsidered: number;
  /** Enclosed regions found, after the min-area and outer-face filters. */
  detected: DetectedSpace[];
  detectionStats: DetectStats;
  /** One entry per emitted space. Empty on a dry run. */
  emitted: Array<{ region: DetectedSpace; result: SpaceBuildResult; name: string }>;
  /** Regions dropped because a space already covers them. */
  skippedExisting: number;
  /** Regions dropped as too narrow to be a room — almost all wall cavities. */
  skippedNarrow: number;
}

/**
 * A region's characteristic width, metres: `2 × area / perimeter`.
 *
 * For a long thin shape this is its thickness; for a compact one, roughly half
 * its smaller side. It needs no assumption about the shape being rectangular,
 * which matters because rooms in a drawing rarely are.
 */
export function regionWidth(outline: Vec2[]): number {
  if (outline.length < 3) return 0;

  let perimeter = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  if (perimeter === 0) return 0;

  let twiceArea = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    twiceArea += x1 * y2 - x2 * y1;
  }

  return Math.abs(twiceArea) / perimeter;
}

export function generateSpacesFromDrawing(
  editor: StoreEditor,
  store: IfcDataStore,
  storeyExpressId: number,
  segments: Segment[],
  options: GenerateSpacesFromDrawingOptions = {},
): GenerateSpacesFromDrawingResult {
  const height = options.height ?? 3;
  const namePattern = options.namePattern ?? 'Room {n}';
  if (height <= 0) {
    throw new Error('generateSpacesFromDrawing: height must be positive');
  }

  const debug = !!options.debug;
  const log = debug
    ? (...args: unknown[]) => console.debug('[drawing-spaces]', ...args)
    : () => {};
  log(`storey #${storeyExpressId}: ${segments.length} segment(s) from a drawing`);

  const detection = detectEnclosedAreasWithStats(segments, {
    snapTolerance: options.snapTolerance ?? 0.1,
    minArea: options.minArea ?? 0.5,
    debug,
  });
  const detected = detection.spaces;

  // Narrow first: a wall cavity is not a room, so it should not then be
  // reported as one that an existing space happened to cover.
  const minWidth = options.minWidth ?? 0.35;
  const wideEnough = minWidth <= 0
    ? detected
    : detected.filter((r) => regionWidth(r.outline) >= minWidth);
  const skippedNarrow = detected.length - wideEnough.length;

  // One line at info level, so the common "no rooms" outcome explains itself in
  // devtools without anyone having to turn debugging on.
  console.info(
    `[drawing-spaces] storey #${storeyExpressId}: ${detected.length} region(s) from ` +
    `${segments.length} segment(s) — ${detection.stats.vertices}v / ` +
    `${detection.stats.segmentsAfterSplit}e / ${detection.stats.faces}f ` +
    `(dropped ${detection.stats.outerFacesDropped} outer + ` +
    `${detection.stats.belowMinAreaDropped} small); ${skippedNarrow} too narrow.`,
  );

  const skipFootprints = options.skipFootprints ?? [];
  const rooms = skipFootprints.length === 0
    ? wideEnough
    : wideEnough.filter((r) => !overlapsExisting(r.outline, skipFootprints));
  const skippedExisting = wideEnough.length - rooms.length;

  const emitted: GenerateSpacesFromDrawingResult['emitted'] = [];
  if (options.dryRun || rooms.length === 0) {
    return {
      segmentsConsidered: segments.length,
      detected,
      detectionStats: detection.stats,
      emitted,
      skippedExisting,
      skippedNarrow,
    };
  }

  const anchor = resolveSpatialAnchor(store, storeyExpressId);
  if (!anchor) {
    throw new Error(
      `generateSpacesFromDrawing: no resolvable spatial anchor for storey #${storeyExpressId}`,
    );
  }
  if (options.guidRandom !== undefined) anchor.guidRandom = options.guidRandom;

  rooms.forEach((region, i) => {
    const params = drawingSpaceParams(region, i, height, namePattern, options);
    const result = addSpaceToStore(editor, anchor, params);
    emitted.push({ region, result, name: params.Name as string });
  });

  return {
    segmentsConsidered: segments.length,
    detected,
    detectionStats: detection.stats,
    emitted,
    skippedExisting,
    skippedNarrow,
  };
}

/**
 * What one detected region becomes.
 *
 * Separate from the loop because this is where the drawing path DIFFERS from
 * the wall path, and a difference that matters is worth being able to check
 * without a parsed model behind it.
 */
export function drawingSpaceParams(
  region: DetectedSpace,
  index: number,
  height: number,
  namePattern: string,
  options: Pick<GenerateSpacesFromDrawingOptions, 'longName' | 'predefinedType'> = {},
): SpaceInStoreParams {
  return {
    Profile: 'polygon',
    // The detected outline, unmodified. No inset: the lines a plan draws are
    // already the wall faces, so this IS the room.
    OuterCurve: region.outline,
    Height: height,
    Name: namePattern.replace('{n}', String(index + 1)),
    ObjectType: DRAWING_SPACE_OBJECTTYPE,
    LongName: options.longName,
    PredefinedType: options.predefinedType,
    // No `boundaries`, no `grossFloorArea` — see the note at the top of the file.
  };
}

function overlapsExisting(outline: Vec2[], skipFootprints: Vec2[][]): boolean {
  let cx = 0;
  let cy = 0;
  for (const p of outline) { cx += p[0]; cy += p[1]; }
  cx /= outline.length;
  cy /= outline.length;
  return skipFootprints.some((fp) => pointInPolygon(cx, cy, fp));
}
