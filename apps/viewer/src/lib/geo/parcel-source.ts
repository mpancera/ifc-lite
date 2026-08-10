/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where an official parcel boundary comes from.
 *
 * The outline fit is country-agnostic — it takes two rings and returns a
 * transform. Everything that knows about a particular country's cadastre sits
 * behind {@link ParcelSource}, so adding a second country means adding a
 * source, not touching the fit, the solver, or the panel.
 *
 * Only Switzerland is implemented. The interface exists anyway because the
 * alternative is Swiss URLs appearing in the general path and never leaving.
 */

import type { Point2 } from './fit-outline';
import { externalRequestsAllowed } from '@/lib/privacy/externalRequests';

export interface ParcelOutline {
  /** The identifier this was fetched by, normalised. */
  identifier: string;
  /** Boundary vertices in the source's CRS, without a repeated closing point. */
  ring: Point2[];
  /** EPSG name of `ring`, e.g. "EPSG:2056". */
  crsName: string;
}

export type FetchParcelResult =
  | { ok: true; parcel: ParcelOutline }
  | { ok: false; reason: FetchParcelFailure };

export type FetchParcelFailure =
  /** The privacy gate is closed. Nothing was sent. */
  | 'external-requests-disabled'
  | 'invalid-identifier'
  | 'not-found'
  | 'network';

export interface ParcelSource {
  id: string;
  /** Shown in the UI, e.g. "Schweiz — Amtliche Vermessung". */
  label: string;
  /** What an identifier looks like here, shown as the field's placeholder. */
  identifierHint: string;
  crsName: string;
  fetchParcel(identifier: string): Promise<FetchParcelResult>;
}

// ── Switzerland ────────────────────────────────────────────────────────────

/** E-GRID: "CH" plus twelve digits, the federal parcel identifier. */
const EGRID_PATTERN = /^CH\d{12}$/;

const SWISS_ENDPOINT = 'https://api3.geo.admin.ch/rest/services/api/MapServer/find';

/**
 * Pull the boundary out of a geo.admin.ch `find` response.
 *
 * Exported for its own tests: the response nests coordinates differently for a
 * simple plot and for one with several parts, and the flattening is the part
 * that would quietly return an empty ring.
 *
 * Takes the first result. A single E-GRID identifies a single real estate, so
 * more than one row means the search matched something unexpected rather than
 * that a choice is needed.
 */
export function parseParcelGeometry(payload: unknown): Point2[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;

  const geometry = (results[0] as { geometry?: unknown }).geometry;
  if (typeof geometry !== 'object' || geometry === null) return null;

  const ring: Point2[] = [];
  const collect = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.length === 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      ring.push({ x: node[0], y: node[1] });
      return;
    }
    for (const child of node) collect(child);
  };
  collect((geometry as { coordinates?: unknown }).coordinates);

  if (ring.length < 3) return null;

  // GeoJSON repeats the first vertex to close the ring; the fit treats rings
  // as implicitly closed and a duplicate would weight that vertex twice.
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.x === last.x && first.y === last.y) ring.pop();

  return ring.length >= 3 ? ring : null;
}

export const swissParcelSource: ParcelSource = {
  id: 'ch-av',
  label: 'Schweiz — Amtliche Vermessung',
  identifierHint: 'E-GRID, z. B. CH775979211712',
  crsName: 'EPSG:2056',

  async fetchParcel(identifier: string): Promise<FetchParcelResult> {
    const egrid = identifier.trim().toUpperCase();
    if (!EGRID_PATTERN.test(egrid)) return { ok: false, reason: 'invalid-identifier' };

    // Asked before anything leaves: the E-GRID alone names the plot, so the
    // request is itself the disclosure this gate exists for.
    if (!externalRequestsAllowed()) return { ok: false, reason: 'external-requests-disabled' };

    const query = new URLSearchParams({
      layer: 'ch.kantone.cadastralwebmap-farbe',
      searchText: egrid,
      searchField: 'egris_egrid',
      sr: '2056',
      returnGeometry: 'true',
      geometryFormat: 'geojson',
    });

    try {
      const response = await fetch(`${SWISS_ENDPOINT}?${query}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        console.warn(`[parcel-source] geo.admin.ch answered HTTP ${response.status}`);
        return { ok: false, reason: 'network' };
      }
      const ring = parseParcelGeometry(await response.json());
      if (!ring) return { ok: false, reason: 'not-found' };
      return { ok: true, parcel: { identifier: egrid, ring, crsName: 'EPSG:2056' } };
    } catch (error) {
      console.warn('[parcel-source] parcel lookup failed', error);
      return { ok: false, reason: 'network' };
    }
  },
};

export const PARCEL_SOURCES: ReadonlyArray<ParcelSource> = [swissParcelSource];

/** The source whose CRS matches the model's, or `null` when none does. */
export function parcelSourceForCrs(crsName: string | undefined): ParcelSource | null {
  if (!crsName) return null;
  const normalised = crsName.trim().toUpperCase();
  return PARCEL_SOURCES.find(source => source.crsName.toUpperCase() === normalised) ?? null;
}
