/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage C, interpretation: from strokes to candidates.
 *
 * What is built here is the cheap, high-yield part of the stage: rooms that
 * are already drawn as closed outlines (C2), texts inside them as their names
 * (C3), block references as devices (C8), door swings from arcs (C5, partial)
 * and columns from small circles (C7). Walls from double lines and the room
 * finder over stroke topology come after; they need the spatial index.
 *
 * Every candidate carries a confidence that is the product of named factors,
 * so a reviewer can see WHY it is 0.6 and not just that it is. Nothing here
 * is a verdict: an outline on a layer nobody marked as outlines is still a
 * candidate, only a weaker one.
 */

import type { DxfDocument } from '@ifc-lite/drawing-2d';
import type { LayerRole } from '../detect/layer-roles.js';
import type { PdfPageStats } from '../detect/pdf-page.js';
import { candidateId } from '../ids/stable-id.js';
import type { Candidate, Point2 } from '../types.js';
import { arcPoints, area, centroid, geometryHandle, normaliseLoop, pointInPolygon, regionWidth } from './geometry.js';
import { parseLabel } from './labels.js';
import { classifyBlock, isAnonymousBlock, type SymbolRule } from './symbols.js';

export interface InterpretOptions {
  sourceFile: string;
  storeyGlobalId?: string;
  /** Regions narrower than this (2·A/P) are wall cavities, not rooms. Default 0.35 m. */
  minRegionWidthM?: number;
  /** Regions smaller than this are not rooms. Default 1 m². */
  minAreaM2?: number;
  /** Door swing radii accepted, in metres. Default 0.6–1.3. */
  doorRadiusM?: [number, number];
  /** Column circles up to this radius, in metres. Default 0.3. */
  maxColumnRadiusM?: number;
  symbolRules?: readonly SymbolRule[];
}

export interface InterpretStats {
  spaces: number;
  named: number;
  labels: number;
  symbols: number;
  doors: number;
  columns: number;
  /** Closed loops that were looked at but did not become a space, and why. */
  rejected: Array<{ reason: 'narrow' | 'small'; handle: string }>;
}

export interface InterpretResult {
  candidates: Candidate[];
  stats: InterpretStats;
}

interface Loop {
  points: Point2[];
  layer?: string;
  /** How much the layer's role vouches for this being a room outline. */
  layerFactor: number;
  handle: string;
  page?: number;
}

interface Label {
  text: string;
  position: Point2;
  layer?: string;
  handle: string;
  page?: number;
}

function product(factors: Record<string, number>): number {
  return Object.values(factors).reduce((p, f) => p * f, 1);
}

/** Rooms from closed loops, names from the labels inside them. Shared by DXF and PDF. */
function buildSpaces(loops: Loop[], labels: Label[], opts: InterpretOptions, route: Candidate['route']): { spaces: Candidate[]; usedLabels: Set<Label>; stats: Pick<InterpretStats, 'spaces' | 'named' | 'rejected'> } {
  const minWidth = opts.minRegionWidthM ?? 0.35;
  const minArea = opts.minAreaM2 ?? 1;
  const spaces: Candidate[] = [];
  const usedLabels = new Set<Label>();
  const rejected: InterpretStats['rejected'] = [];

  for (const loop of loops) {
    const poly = normaliseLoop(loop.points);
    if (poly.length < 3) continue;
    const a = area(poly);
    const w = regionWidth(poly);
    if (a < minArea) {
      rejected.push({ reason: 'small', handle: loop.handle });
      continue;
    }
    if (w < minWidth) {
      rejected.push({ reason: 'narrow', handle: loop.handle });
      continue;
    }
    const inside = labels.filter((l) => !usedLabels.has(l) && pointInPolygon(l.position, poly));
    const parsed = inside.map((l) => ({ label: l, parsed: parseLabel(l.text) }));
    const number = parsed.find((p) => p.parsed.kind === 'number');
    const name = parsed.find((p) => p.parsed.kind === 'name');
    const areaLabel = parsed.find((p) => p.parsed.kind === 'area');
    for (const p of parsed) usedLabels.add(p.label);

    const factors: Record<string, number> = {
      layer: loop.layerFactor,
      closed: 1,
      area: 1,
      slenderness: w >= minWidth * 2 ? 1 : 0.8,
      'text-inside': name || number ? 1 : inside.length > 0 ? 0.8 : 0.6,
    };
    if (areaLabel?.parsed.areaM2 && areaLabel.parsed.areaM2 > 0) {
      // A drawn area label is a check: the polygon should measure about the same.
      const ratio = a / areaLabel.parsed.areaM2;
      factors['area-label'] = ratio > 0.8 && ratio < 1.25 ? 1 : 0.5;
    }
    const handles = [loop.handle, ...parsed.map((p) => p.label.handle)];
    const text = [number?.parsed.value, name?.parsed.value].filter(Boolean).join(' ');
    spaces.push({
      id: candidateId(opts.sourceFile, opts.storeyGlobalId, handles),
      type: 'space',
      geometry: poly,
      ...(text ? { text } : {}),
      confidence: product(factors),
      confidenceReasons: factors,
      source: { ...(loop.layer !== undefined ? { layer: loop.layer } : {}), handles, ...(loop.page !== undefined ? { page: loop.page } : {}) },
      route,
    });
  }
  return { spaces, usedLabels, stats: { spaces: spaces.length, named: spaces.filter((s) => s.text).length, rejected } };
}

function labelCandidates(labels: Label[], used: Set<Label>, opts: InterpretOptions, route: Candidate['route']): Candidate[] {
  return labels
    .filter((l) => !used.has(l))
    .map((l) => {
      const parsed = parseLabel(l.text);
      const factors = { text: parsed.kind === 'other' ? 0.4 : 0.7, 'in-space': 0.5 };
      return {
        id: candidateId(opts.sourceFile, opts.storeyGlobalId, [l.handle]),
        type: 'label' as const,
        geometry: [l.position],
        text: l.text,
        confidence: product(factors),
        confidenceReasons: factors,
        source: { ...(l.layer !== undefined ? { layer: l.layer } : {}), handles: [l.handle], ...(l.page !== undefined ? { page: l.page } : {}) },
        route,
      };
    });
}

// ---------------------------------------------------------------------------
// DXF

function layerFactorFor(role: LayerRole | undefined): number {
  switch (role) {
    case 'outline':
      return 1;
    case 'wall':
      return 0.6;
    case 'unknown':
    case undefined:
      return 0.5;
    default:
      return 0;
  }
}

/**
 * Interpret a parsed DXF. `roles` decide which layers contribute: outline
 * and wall layers give loops, excluded layers give nothing, texts come from
 * every layer that is not excluded.
 */
export function interpretDxf(doc: DxfDocument, roles: Readonly<Record<string, LayerRole>>, metresPerUnit: number, opts: InterpretOptions): InterpretResult {
  const m = (v: number) => v * metresPerUnit;
  const loops: Loop[] = [];
  const labels: Label[] = [];
  const others: Candidate[] = [];
  const [doorMin, doorMax] = opts.doorRadiusM ?? [0.6, 1.3];
  const maxColumn = opts.maxColumnRadiusM ?? 0.3;
  let symbols = 0;
  let doors = 0;
  let columns = 0;

  for (const e of doc.entities) {
    const role = roles[e.layer];
    if (role === 'exclude' || e.invisible) continue;
    if (e.kind === 'text') {
      const position = { x: m(e.x), y: m(e.y) };
      labels.push({ text: e.text, position, layer: e.layer, handle: geometryHandle('text', e.layer, [position]) + `:${e.text}` });
      continue;
    }
    if (role === 'text') continue;
    switch (e.kind) {
      case 'polyline': {
        if (!e.closed || e.vertices.length < 3) break;
        const points = e.vertices.map((v) => ({ x: m(v.x), y: m(v.y) }));
        loops.push({ points, layer: e.layer, layerFactor: layerFactorFor(role), handle: geometryHandle('loop', e.layer, points) });
        break;
      }
      case 'arc': {
        const r = m(e.r);
        if (r < doorMin || r > doorMax) break;
        let sweep = e.endDeg - e.startDeg;
        if (sweep <= 0) sweep += 360;
        if (sweep < 60 || sweep > 120) break;
        const points = arcPoints(m(e.cx), m(e.cy), r, e.startDeg, e.endDeg);
        const handle = geometryHandle('arc', e.layer, [points[0], points[points.length - 1]]);
        const factors = { 'arc-radius': 1, 'arc-sweep': Math.abs(sweep - 90) < 5 ? 1 : 0.8, 'wall-gap': 0.6 };
        others.push({
          id: candidateId(opts.sourceFile, opts.storeyGlobalId, [handle]),
          type: 'door',
          geometry: [{ x: m(e.cx), y: m(e.cy) }, ...points],
          thickness: r,
          confidence: product(factors),
          confidenceReasons: factors,
          source: { layer: e.layer, handles: [handle] },
          route: 'vector',
        });
        doors += 1;
        break;
      }
      case 'circle': {
        const r = m(e.r);
        if (r > maxColumn || r < 0.05) break;
        const points = arcPoints(m(e.cx), m(e.cy), r, 0, 360, 16);
        const handle = geometryHandle('circle', e.layer, [{ x: m(e.cx), y: m(e.cy) }, { x: r, y: 0 }]);
        const factors = { 'circle-radius': 1, layer: role === 'wall' ? 1 : 0.6 };
        others.push({
          id: candidateId(opts.sourceFile, opts.storeyGlobalId, [handle]),
          type: 'column',
          geometry: points,
          confidence: product(factors),
          confidenceReasons: factors,
          source: { layer: e.layer, handles: [handle] },
          route: 'vector',
        });
        columns += 1;
        break;
      }
      case 'insert': {
        if (isAnonymousBlock(e.blockName)) break;
        const position = { x: m(e.x), y: m(e.y) };
        const cls = classifyBlock(e.blockName, opts.symbolRules);
        const handle = geometryHandle('insert', e.layer, [position]) + `:${e.blockName}`;
        const factors = { 'block-known': cls.confidence, 'block-defined': doc.blocks.has(e.blockName) ? 1 : 0.5 };
        others.push({
          id: candidateId(opts.sourceFile, opts.storeyGlobalId, [handle]),
          type: 'symbol',
          geometry: [position],
          symbol: { blockName: e.blockName, rotationDeg: e.rotationDeg, classified: cls.class },
          confidence: product(factors),
          confidenceReasons: factors,
          source: { layer: e.layer, handles: [handle] },
          route: 'vector',
        });
        symbols += 1;
        break;
      }
      default:
        break;
    }
  }

  // Outline layers first, so a room drawn twice keeps the better source.
  loops.sort((a, b) => b.layerFactor - a.layerFactor);
  const built = buildSpaces(loops, labels, opts, 'vector');
  const labelCands = labelCandidates(labels, built.usedLabels, opts, 'vector');
  return {
    candidates: [...built.spaces, ...others, ...labelCands],
    stats: { ...built.stats, labels: labelCands.length, symbols, doors, columns },
  };
}

// ---------------------------------------------------------------------------
// PDF

/**
 * Interpret one PDF page from the geometry the adapter collected. Closed
 * paths are room candidates, text items are labels. Coordinates come in as
 * sheet points (top-left origin, y down) and leave as plan metres with y up.
 */
export function interpretPdfPage(stats: PdfPageStats, metresPerPoint: number, opts: InterpretOptions): InterpretResult {
  // Without a scale, 1:100 is assumed so that thresholds in metres still mean
  // something; the `units` factor marks every room down for it.
  const k = metresPerPoint > 0 ? metresPerPoint : (100 * 0.0254) / 72;
  const toPlan = (p: Point2): Point2 => ({ x: p.x * k, y: (stats.heightPt - p.y) * k });
  const unitsFactor = metresPerPoint > 0 ? 1 : 0.3;
  const loops: Loop[] = (stats.closedPaths ?? []).map((path) => {
    const points = path.map(toPlan);
    return { points, layerFactor: 0.7, handle: geometryHandle('loop', undefined, points), page: stats.pageIndex };
  });
  const labels: Label[] = (stats.texts ?? []).map((t) => {
    const position = toPlan({ x: t.x, y: t.y });
    return { text: t.text, position, handle: geometryHandle('text', undefined, [position]) + `:${t.text}`, page: stats.pageIndex };
  });
  const built = buildSpaces(loops, labels, opts, 'vector');
  for (const s of built.spaces) {
    s.confidenceReasons.units = unitsFactor;
    s.confidence *= unitsFactor;
  }
  const labelCands = labelCandidates(labels, built.usedLabels, opts, 'vector');
  return {
    candidates: [...built.spaces, ...labelCands],
    stats: { ...built.stats, labels: labelCands.length, symbols: 0, doors: 0, columns: 0 },
  };
}

/** Confidence band a host colours by. */
export type ConfidenceBand = 'high' | 'review' | 'low';

export function confidenceBand(c: number): ConfidenceBand {
  return c >= 0.8 ? 'high' : c >= 0.5 ? 'review' : 'low';
}

export { centroid as candidateCentroid };
