/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading storeys out of a loaded model, with the provenance of each figure.
 *
 * The parser already resolves storey elevations and even falls back to the
 * placement when `Elevation` is null — but it does not record WHICH it used,
 * and for a reference height system that is exactly the interesting part. A
 * level read from the attribute is what the architect wrote; one computed from
 * the placement is an inference, and a reader of the exported system deserves
 * to be able to tell them apart.
 *
 * So this reads the attribute itself, and leans on the parser's already-scaled
 * map only for the fallback — reusing its proven placement walk rather than
 * reimplementing the chain.
 */

import { EntityExtractor, describeLengthUnit, extractLengthUnitScale, type IfcDataStore } from '@ifc-lite/parser';
import { IFC_BUILDING_STOREY_ELEVATION_INDEX } from '@ifc-lite/data';
import type { RawStorey } from './derive.js';

/** `IfcBuildingStorey.Name` — index 2 on every `IfcRoot` subtype. */
const NAME_INDEX = 2;

export interface ReadStoreysResult {
  /** Elevations in the FILE's unit, so one scale applies to all of them. */
  storeys: RawStorey[];
  /** Metres per file unit. */
  lengthUnitScale: number;
  /** `null` when the file's unit could not be determined — the derivation
   *  refuses on this rather than assuming metres. */
  lengthUnitName: string | null;
}

/**
 * Every `IfcBuildingStorey` in the model, in file units, with provenance.
 *
 * `modelId` prefixes the ids so a federated project cannot collide two
 * storeys that happen to share an express id.
 */
export function readRawStoreys(store: IfcDataStore, modelId: string): ReadStoreysResult {
  const scale = readScale(store);
  const unit = store.source && store.entityIndex
    ? describeLengthUnit(store.source, store.entityIndex)
    : null;

  const storeyIds = store.entityIndex?.byType?.get('IFCBUILDINGSTOREY') ?? [];
  const storeys: RawStorey[] = [];

  const extractor = store.source ? new EntityExtractor(store.source) : null;

  for (const expressId of storeyIds) {
    const id = `${modelId}:${expressId}`;
    const name = store.entities?.getName?.(expressId) || `#${expressId}`;

    const fromAttribute = extractor && store.entityIndex
      ? readElevationAttribute(extractor, store, expressId)
      : undefined;

    if (fromAttribute !== undefined) {
      storeys.push({ id, name, elevation: fromAttribute, source: 'ifc-elevation-attribute' });
      continue;
    }

    // The parser's map is already in METRES and already includes its placement
    // fallback. Expressing it back in file units keeps one scale valid for the
    // whole list, which is what `deriveHeightSystem` expects.
    const metres = store.spatialHierarchy?.storeyElevations?.get(expressId);
    if (metres !== undefined && scale > 0) {
      storeys.push({ id, name, elevation: metres / scale, source: 'object-placement' });
      continue;
    }

    // No elevation anywhere. Reported at zero and flagged as manual, because
    // dropping the storey would hide it from the very list meant to reveal
    // that it needs attention.
    storeys.push({ id, name, elevation: 0, source: 'manual' });
  }

  return { storeys, lengthUnitScale: scale, lengthUnitName: unit?.name ?? null };
}

/** `Elevation` as written, in file units, or `undefined` when absent. */
function readElevationAttribute(
  extractor: EntityExtractor,
  store: IfcDataStore,
  expressId: number,
): number | undefined {
  const ref = store.entityIndex?.byId?.get(expressId);
  if (!ref) return undefined;

  const entity = extractor.extractEntity(ref);
  const raw = entity?.attributes?.[IFC_BUILDING_STOREY_ELEVATION_INDEX];
  // Deliberately not `Number(raw)`: '' and null both coerce to 0, which would
  // turn "no elevation given" into "ground floor".
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function readScale(store: IfcDataStore): number {
  if (!store.source || !store.entityIndex) return 1;
  try {
    const scale = extractLengthUnitScale(store.source, store.entityIndex);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  } catch {
    return 1;
  }
}
