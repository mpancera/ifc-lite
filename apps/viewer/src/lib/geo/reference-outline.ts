/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A reference outline read from a file the user brought.
 *
 * {@link ParcelSource} fetches an official boundary by identifier, and for
 * parcels that works. For a BUILDING it does not: the federal services expose
 * parcels by E-GRID, but not building footprints by EGID — the footprint lives
 * in the national 3D building model, behind tile traversal and mesh decoding.
 *
 * So the outline arrives as a file instead, produced by whatever already knows
 * how to get it. That keeps this side free of one country's service, and it
 * keeps the viewer free of the network for this feature entirely — the fit is
 * the same fit either way, because it only ever wanted two rings.
 *
 * ## Why the CRS is checked rather than assumed
 *
 * RFC 7946 says GeoJSON coordinates are WGS84 longitude and latitude. Exports
 * of national data routinely ignore that and carry projected metres, because
 * that is what the data is in and what the recipient needs. Reading LV95
 * eastings as longitude does not fail — it puts the building in the Gulf of
 * Guinea, and a fit against it reports a shift of two million metres, which
 * looks like a broken model rather than a misread file.
 *
 * Degrees and projected metres are three orders of magnitude apart, so telling
 * them apart is safe. What is NOT safe is guessing WHICH projected system, and
 * that is not attempted: the file says so, or the caller does.
 */

import type { Point2 } from './fit-outline';

export interface ReferenceOutline {
  /** Boundary vertices in `crsName`, without a repeated closing point. */
  ring: Point2[];
  /** EPSG name of `ring`, e.g. "EPSG:2056". */
  crsName: string;
  /** Identifier carried by the file, e.g. an EGID. `null` when it carries none. */
  identifier: string | null;
  /** Rings found in the file. More than one means a choice was made. */
  candidateCount: number;
}

export type ReferenceOutlineFailure =
  | 'not-json'
  | 'no-polygon'
  | 'too-few-vertices'
  /** Coordinates look like degrees; a projected ring is needed to fit against. */
  | 'degrees-not-projected'
  /** Projected, but nothing said which system, and it cannot be guessed. */
  | 'crs-unknown';

export type ReferenceOutlineResult =
  | { ok: true; outline: ReferenceOutline }
  | { ok: false; reason: ReferenceOutlineFailure };

export interface ParseOutlineOptions {
  /**
   * CRS to assume when the file does not name one. This is the caller saying
   * what it knows — never a default, because the wrong projected system is the
   * one error this module cannot detect.
   */
  assumeCrs?: string;
}

/** Above this, a coordinate cannot be a degree. */
const DEGREE_LIMIT = 400;

export function parseOutlineGeoJson(
  text: string,
  options: ParseOutlineOptions = {},
): ReferenceOutlineResult {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }

  const rings = collectRings(payload);
  if (rings.length === 0) return { ok: false, reason: 'no-polygon' };

  // The largest ring by extent. A building export may carry several parts, and
  // a courtyard arrives as an inner ring of the same polygon; the outer one is
  // always the bigger. Picking silently is safe HERE because every candidate
  // describes the same building — unlike the layer choice in a drawing, where
  // the candidates are different things.
  let ring = rings[0];
  let bestSpan = -Infinity;
  for (const candidate of rings) {
    const span = extentSpan(candidate);
    if (span > bestSpan) { bestSpan = span; ring = candidate; }
  }

  if (ring.length < 3) return { ok: false, reason: 'too-few-vertices' };

  // GeoJSON repeats the first vertex to close the ring; the fit treats rings as
  // implicitly closed and a duplicate would weight that vertex twice.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.x === last.x && first.y === last.y) ring = ring.slice(0, -1);
  if (ring.length < 3) return { ok: false, reason: 'too-few-vertices' };

  const projected = ring.some(p => Math.abs(p.x) > DEGREE_LIMIT || Math.abs(p.y) > DEGREE_LIMIT);
  const declared = declaredCrs(payload);
  if (!projected && !declared) return { ok: false, reason: 'degrees-not-projected' };

  const crsName = declared ?? options.assumeCrs;
  if (!crsName) return { ok: false, reason: 'crs-unknown' };

  return {
    ok: true,
    outline: {
      ring,
      crsName,
      identifier: findIdentifier(payload),
      candidateCount: rings.length,
    },
  };
}

/** Largest side of the axis-aligned extent — enough to rank rings by size. */
function extentSpan(ring: readonly Point2[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return Math.max(maxX - minX, maxY - minY);
}

/**
 * Every ring in the document, whatever it is wrapped in.
 *
 * Deliberately structural rather than schema-driven: a FeatureCollection, a
 * bare Feature, a bare geometry and a raw coordinate array all turn up, and
 * the difference between them says nothing about the boundary. A position is
 * the deepest pair of numbers; a ring is the array of positions above it.
 */
export function collectRings(node: unknown): Point2[][] {
  const rings: Point2[][] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (isRing(value)) {
        rings.push((value as Array<[number, number]>).map(([x, y]) => ({ x, y })));
        return;
      }
      for (const child of value) walk(child);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value)) walk(child);
    }
  };

  walk(node);
  return rings;
}

function isRing(value: unknown[]): boolean {
  if (value.length < 3) return false;
  return value.every(
    item => Array.isArray(item)
      && item.length >= 2
      && typeof item[0] === 'number'
      && typeof item[1] === 'number',
  );
}

/**
 * The CRS the file names, if it names one.
 *
 * RFC 7946 removed the `crs` member, but exporters of projected data still
 * write it precisely because the alternative is silence about the one thing
 * the recipient must know. Also accepts a plain `crs: "EPSG:2056"` string,
 * which is what hand-rolled exports tend to produce.
 */
export function declaredCrs(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const crs = (payload as { crs?: unknown }).crs;
  if (typeof crs === 'string') return normaliseEpsg(crs);
  if (typeof crs === 'object' && crs !== null) {
    const name = (crs as { properties?: { name?: unknown } }).properties?.name;
    if (typeof name === 'string') return normaliseEpsg(name);
  }
  return null;
}

/**
 * `urn:ogc:def:crs:EPSG::2056` and `EPSG:2056` name the same thing.
 *
 * Returns `null` for a name carrying no code — `CH1903+ / LV95` ends in two
 * digits, not four, and comparing such a name to another by string would be
 * guesswork rather than a check.
 */
export function normaliseEpsg(raw: string): string | null {
  const match = /(\d{4,6})\s*$/.exec(raw.trim());
  return match ? `EPSG:${match[1]}` : null;
}

/** An EGID or similar carried in feature properties, if there is one. */
export function findIdentifier(payload: unknown): string | null {
  let found: string | null = null;

  const walk = (value: unknown): void => {
    if (found !== null) return;
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (typeof value !== 'object' || value === null) return;

    for (const [key, child] of Object.entries(value)) {
      if (found !== null) return;
      if (/^(egid|identifier|id)$/i.test(key)
        && (typeof child === 'string' || typeof child === 'number')) {
        const text = String(child).trim();
        if (text.length > 0) { found = text; return; }
      }
      walk(child);
    }
  };

  walk(payload);
  return found;
}
