/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared vocabulary of the harmonizer.
 *
 * A plan goes through stages: detection (what is this file, can it be read as
 * geometry), units and placement (how long is a drawing unit, where does the
 * plan sit in the project), interpretation (which strokes are walls, which
 * closed loops are spaces), and finally a draft IFC in which every element
 * carries its provenance and a confidence. This module holds the types the
 * stages hand to one another. It knows nothing about IFC entities: that is the
 * writer's business, and it comes last.
 */

import type { DxfPlacement } from '@ifc-lite/drawing-2d';
import type { StageVisual } from './visual/stage-visual.js';

/** How the file can be turned into geometry, if at all. */
export type Route = 'vector' | 'raster' | 'unavailable';

/** What the file is, judged from its name; the content check comes after. */
export type InputKind = 'dxf' | 'dwg' | 'pdf' | 'image' | 'unknown';

/** What an interpreted stroke or loop is believed to be. */
export type CandidateType =
  | 'wall'
  | 'space'
  | 'door'
  | 'window'
  | 'column'
  | 'label'
  | 'symbol'
  | 'escape-route'
  | 'unknown';

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Where a plan sits relative to the project: the same four numbers the DXF
 * underlay already uses (offset in metres, rotation in degrees, an extra
 * scale on top of the file's unit). Re-exported so a caller does not have to
 * know that the underlay type is the canonical one.
 */
export type PlanPlacement = DxfPlacement;

/** Where a length unit came from, from most to least trustworthy. */
export type UnitSource =
  | 'insunits'
  | 'calibration'
  | 'manual'
  | 'titleblock'
  | 'filename'
  | 'estimated'
  | 'unknown';

export interface UnitResolution {
  source: UnitSource;
  /** Metres per drawing unit (DXF) or per PDF point. 0 when unknown. */
  metresPerUnit: number;
  /** The paper scale denominator when one was read (100 for 1:100). */
  scaleDenominator?: number;
}

/** Provenance of one candidate: which parts of the source produced it. */
export interface CandidateSource {
  /** DXF layer, when the source has layers. */
  layer?: string;
  /** DXF entity handles or PDF path indices that produced the candidate. */
  handles: string[];
  /** PDF page index (0-based), when the source has pages. */
  page?: number;
}

/**
 * One interpreted element before it is written. Geometry is in plan
 * coordinates in metres with the placement NOT applied; the writer applies it
 * last, so that re-aligning the plan never accumulates into the geometry.
 */
export interface Candidate {
  /** Deterministic: derived from source file, storey and handles. */
  id: string;
  type: CandidateType;
  geometry: Point2[];
  /** Walls only: axis-to-face distance when a double line was recognised. */
  thickness?: number;
  /** Symbols only: the block that was inserted and what it was taken for. */
  symbol?: { blockName: string; rotationDeg: number; classified?: string };
  /** Labels and spaces: text read from the plan. */
  text?: string;
  /** 0-1, the product of the named factors below. */
  confidence: number;
  /** Each factor in 0-1 with a name a reviewer can read ("closed", "layer"). */
  confidenceReasons: Record<string, number>;
  source: CandidateSource;
  route: Exclude<Route, 'unavailable'>;
}

/** One recorded decision of a run; together they are the protocol. */
export interface Decision {
  step: string;
  message: string;
  data?: unknown;
}

export type MessageSeverity = 'info' | 'warning' | 'error';

/**
 * A message meant for a person. `code` is stable and what a UI keys its
 * translations on; `text` is a readable English default.
 */
export interface HarmonizerMessage {
  code: string;
  severity: MessageSeverity;
  text: string;
  data?: Record<string, unknown>;
}

/** The result of one run over one file. */
export interface HarmonizerResult {
  harmonizerVersion: string;
  sourceFile: string;
  inputKind: InputKind;
  detectedRoute: Route;
  units: UnitResolution;
  placement?: PlanPlacement;
  storeyGlobalId?: string;
  candidates: Candidate[];
  decisions: Decision[];
  messages: HarmonizerMessage[];
  timings: Record<string, number>;
  /** One picture per stage, so the run can be walked through step by step. */
  visuals: StageVisual[];
}
