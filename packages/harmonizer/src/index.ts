/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/harmonizer: from a 2D plan to a draft IFC with provenance.
 *
 * Stage A, detection, is what this version ships: what a file is, whether a
 * PDF page is a drawing or a picture of one, what a DXF is made of layer by
 * layer, where the paper scale can be read from, and ids that stay the same
 * from run to run. Interpretation and the IFC writer follow.
 */

export type {
  Route,
  InputKind,
  CandidateType,
  Point2,
  PlanPlacement,
  UnitSource,
  UnitResolution,
  CandidateSource,
  Candidate,
  Decision,
  MessageSeverity,
  HarmonizerMessage,
  HarmonizerResult,
} from './types.js';

export { MessageCodes, message, type MessageCode } from './messages.js';
export { Protocol } from './protocol.js';

export { inputKindFromName, routeByKind, type InputRouting } from './detect/input-kind.js';
export {
  classifyPdfPage,
  routeForPages,
  DEFAULT_PDF_PAGE_THRESHOLDS,
  type PdfPageStats,
  type PdfDensityGrid,
  type PdfBox,
  type PdfTextItem,
  type PdfPageKind,
  type PdfPageThresholds,
  type PdfPageClassification,
} from './detect/pdf-page.js';
export {
  collectPdfPageStats,
  type PdfPageLike,
  type PdfOpsTable,
  type PdfOperatorList,
  type PdfTextContentLike,
  type CollectPdfPageStatsOptions,
} from './detect/pdf-adapter.js';
export {
  analyzeDxf,
  dxfBounds,
  insunitsName,
  type Extent,
  type DxfQuality,
  type DxfLayerStats,
  type DxfConfidence,
  type AnalyzeDxfOptions,
} from './detect/dxf-quality.js';
export { suggestLayerRoles, type LayerRole, type LayerRoleSuggestion, type LayerReasonCode } from './detect/layer-roles.js';

export { findScaleHints, metresPerPoint, resolvePdfUnits, type ScaleHint } from './units/scale.js';
export { metresPerInsunit, estimateMetresPerUnit, INSUNITS_NAMES } from './units/insunits.js';

export { stableUuid, stableGlobalId, candidateId } from './ids/stable-id.js';

export {
  interpretDxf,
  interpretPdfPage,
  confidenceBand,
  type ConfidenceBand,
  type InterpretOptions,
  type InterpretResult,
  type InterpretStats,
} from './interpret/interpret.js';
export { spacesFromLoops, addTopologySpaces, dxfLabels, type Loop, type Label } from './interpret/interpret.js';
export { parseLabel, type LabelKind, type ParsedLabel } from './interpret/labels.js';
export {
  findEnclosedAreas,
  type TopologyOptions,
  type TopologyResult,
  type TopologyStats,
  type Face,
  type RejectedFace,
} from './topology/enclosed-areas.js';
export { SegmentGrid, cellSizeFor, type SegmentLike } from './topology/spatial-hash.js';
export type { PlanarGraph, PlanarEdge, PlanarFace } from './topology/enclosed-areas.js';
export {
  buildSpaceGraph,
  neighboursOf,
  OUTSIDE_ID,
  type SpaceGraph,
  type SpaceGraphNode,
  type SpaceGraphEdge,
  type SpaceGraphNodeKind,
  type SpaceGraphEdgeKind,
  type SpaceGraphOptions,
} from './topology/space-graph.js';
export { renderTopologyVisual } from './visual/topology-visual.js';
export { renderSpaceGraphVisual, GRAPH_COLORS } from './visual/space-graph-visual.js';
export { classifyBlock, isAnonymousBlock, DEFAULT_SYMBOL_RULES, type SymbolClass, type SymbolRule, type SymbolClassification } from './interpret/symbols.js';
export { area, perimeter, regionWidth, centroid, pointInPolygon, bounds, normaliseLoop, type Bounds } from './interpret/geometry.js';

export type { StageVisual } from './visual/stage-visual.js';
export { renderCandidatesVisual, BAND_COLORS } from './visual/candidates-visual.js';
export { renderRouteVisual } from './visual/route-visual.js';
export { renderPdfPageVisual, renderPdfDocumentVisual, drawPageThumb, type PdfPageVisualInput } from './visual/pdf-visual.js';
export { renderDxfVisual, type DxfVisualOptions } from './visual/dxf-visual.js';
export { renderScaleVisual } from './visual/scale-visual.js';
export { renderIdVisual, type IdVisualInput } from './visual/id-visual.js';
export { renderStoryboard, type StoryboardOptions } from './visual/storyboard.js';

export const HARMONIZER_VERSION = '0.1.0';
