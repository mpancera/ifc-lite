/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a DXF is made of, layer by layer.
 *
 * The parser in `@ifc-lite/drawing-2d` already reads the file; this module
 * counts. The counts are what a person decides on when choosing layers (a
 * wall layer of one storey has hundreds of segments and almost no text, a
 * label layer the reverse) and what the protocol records so the decision can
 * be retraced. Two findings are flagged because they change the answer: block
 * references without a block definition (the drawing depends on xrefs that
 * were not delivered) and a missing `$INSUNITS`.
 */

import type { DxfDocument, DxfEntity } from '@ifc-lite/drawing-2d';
import { MessageCodes, message } from '../messages.js';
import { INSUNITS_NAMES, estimateMetresPerUnit, metresPerInsunit } from '../units/insunits.js';
import type { HarmonizerMessage, UnitResolution } from '../types.js';

export interface DxfLayerStats {
  name: string;
  entities: number;
  lines: number;
  polylines: number;
  /** Closed polylines: candidates for room outlines drawn as such. */
  closedPolylines: number;
  arcs: number;
  circles: number;
  texts: number;
  inserts: number;
  hatches: number;
  dimensions: number;
  /** Straight segments across lines and polylines. */
  segments: number;
  /** Straight segments shorter than the micro threshold. */
  microSegments: number;
}

export type DxfConfidence = 'high' | 'review' | 'poor';

export interface DxfQuality {
  insunits: number;
  units: UnitResolution;
  /** Extent of the drawing in drawing units, largest side. */
  extent: number;
  entities: number;
  layers: DxfLayerStats[];
  /** Block names referenced by INSERT but not defined in the file. */
  unresolvedBlocks: string[];
  /** Entity types the parser skipped, with counts. */
  skipped: Record<string, number>;
  confidence: DxfConfidence;
  messages: HarmonizerMessage[];
}

export interface AnalyzeDxfOptions {
  /** Segments shorter than this, in metres, are micro-segments. Default 0.05. */
  microThresholdM?: number;
}

function emptyLayer(name: string): DxfLayerStats {
  return {
    name,
    entities: 0,
    lines: 0,
    polylines: 0,
    closedPolylines: 0,
    arcs: 0,
    circles: 0,
    texts: 0,
    inserts: 0,
    hatches: 0,
    dimensions: 0,
    segments: 0,
    microSegments: 0,
  };
}

export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function grow(e: Extent, x: number, y: number): void {
  if (x < e.minX) e.minX = x;
  if (y < e.minY) e.minY = y;
  if (x > e.maxX) e.maxX = x;
  if (y > e.maxY) e.maxY = y;
}

function growForEntity(extent: Extent, e: DxfEntity): void {
  switch (e.kind) {
    case 'line':
      grow(extent, e.x1, e.y1);
      grow(extent, e.x2, e.y2);
      break;
    case 'polyline':
      for (const v of e.vertices) grow(extent, v.x, v.y);
      break;
    case 'arc':
    case 'circle':
      grow(extent, e.cx - e.r, e.cy - e.r);
      grow(extent, e.cx + e.r, e.cy + e.r);
      break;
    case 'text':
    case 'insert':
      grow(extent, e.x, e.y);
      break;
    case 'solid':
      for (const c of e.corners) grow(extent, c.x, c.y);
      break;
    case 'hatch':
      for (const p of e.paths) for (const v of p.vertices) grow(extent, v.x, v.y);
      break;
    default:
      break;
  }
}

/** Bounding box of the drawing in drawing units, or null for a file without geometry. */
export function dxfBounds(doc: DxfDocument): Extent | null {
  const extent: Extent = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const e of doc.entities) growForEntity(extent, e);
  return Number.isFinite(extent.maxX) ? extent : null;
}

export function analyzeDxf(doc: DxfDocument, options: AnalyzeDxfOptions = {}): DxfQuality {
  const microThresholdM = options.microThresholdM ?? 0.05;
  const messages: HarmonizerMessage[] = [];

  // First pass: extent, because the unit of a unitless file is guessed from it.
  const extent = dxfBounds(doc);
  const extentSize = extent ? Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY) : 0;

  let units: UnitResolution;
  const fromHeader = metresPerInsunit(doc.insunits);
  if (doc.insunits !== 0 && fromHeader !== undefined) {
    units = { source: 'insunits', metresPerUnit: fromHeader };
  } else {
    const est = estimateMetresPerUnit(extentSize);
    units = { source: 'estimated', metresPerUnit: est.metresPerUnit };
    messages.push(message(MessageCodes.DXF_NO_UNITS, 'warning', { assumed: est.assumed, insunits: doc.insunits }));
  }
  const microThresholdUnits = microThresholdM / units.metresPerUnit;

  // Second pass: per-layer counts.
  const layers = new Map<string, DxfLayerStats>();
  const unresolved = new Set<string>();
  const known = new Set<string>();
  for (const name of doc.blocks.keys()) known.add(name.toUpperCase());

  for (const e of doc.entities) {
    let layer = layers.get(e.layer);
    if (!layer) {
      layer = emptyLayer(e.layer);
      layers.set(e.layer, layer);
    }
    layer.entities += 1;
    switch (e.kind) {
      case 'line': {
        layer.lines += 1;
        layer.segments += 1;
        if (Math.hypot(e.x2 - e.x1, e.y2 - e.y1) < microThresholdUnits) layer.microSegments += 1;
        break;
      }
      case 'polyline': {
        layer.polylines += 1;
        if (e.closed) layer.closedPolylines += 1;
        const v = e.vertices;
        const count = e.closed ? v.length : v.length - 1;
        for (let i = 0; i < count; i++) {
          const a = v[i];
          const b = v[(i + 1) % v.length];
          layer.segments += 1;
          if (Math.hypot(b.x - a.x, b.y - a.y) < microThresholdUnits) layer.microSegments += 1;
        }
        break;
      }
      case 'arc':
        layer.arcs += 1;
        break;
      case 'circle':
        layer.circles += 1;
        break;
      case 'text':
        layer.texts += 1;
        break;
      case 'insert': {
        layer.inserts += 1;
        if (!known.has(e.blockName.toUpperCase())) unresolved.add(e.blockName);
        break;
      }
      case 'hatch':
        layer.hatches += 1;
        break;
      case 'dimension':
        layer.dimensions += 1;
        break;
      default:
        break;
    }
  }

  const layerList = [...layers.values()].sort((a, b) => b.entities - a.entities);
  const unresolvedBlocks = [...unresolved].sort();
  if (unresolvedBlocks.length > 0) {
    messages.push(
      message(MessageCodes.DXF_UNRESOLVED_BLOCKS, 'warning', {
        count: unresolvedBlocks.length,
        names: unresolvedBlocks.slice(0, 5).join(', ') + (unresolvedBlocks.length > 5 ? ', ...' : ''),
      }),
    );
  }

  const totalSegments = layerList.reduce((s, l) => s + l.segments, 0);
  const totalMicro = layerList.reduce((s, l) => s + l.microSegments, 0);
  const microFraction = totalSegments > 0 ? totalMicro / totalSegments : 0;
  if (microFraction >= 0.3) {
    messages.push(
      message(MessageCodes.MICRO_SEGMENTS, 'info', {
        fraction: microFraction,
        thresholdMm: microThresholdM * 1000,
      }),
    );
  }

  let confidence: DxfConfidence;
  if (doc.entities.length < 20 || totalSegments < 20) {
    confidence = 'poor';
  } else if (unresolvedBlocks.length > 0 || units.source !== 'insunits' || microFraction >= 0.3) {
    confidence = 'review';
  } else {
    confidence = 'high';
  }

  return {
    insunits: doc.insunits,
    units,
    extent: extentSize,
    entities: doc.entities.length,
    layers: layerList,
    unresolvedBlocks,
    skipped: { ...doc.skipped },
    confidence,
    messages,
  };
}

/** Readable name of the declared unit, for the protocol. */
export function insunitsName(code: number): string {
  return INSUNITS_NAMES[code] ?? `code ${code}`;
}
