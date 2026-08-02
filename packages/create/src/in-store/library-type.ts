/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Anchored builder for a generic `IfcTypeObject` subtype (e.g. `IfcSensorType`)
 * — the "catalog product" counterpart to `library-element.ts`'s per-instance
 * builder. Default attributes/technical data belong here, on the Type, once
 * per distinct catalog entry; instances then just reference it via
 * `emitRelDefinesByType` instead of repeating the same properties on every
 * placement. ifclite's own property reader already resolves Type-level
 * properties/quantities onto each related instance
 * (`extractTypePropertiesOnDemand` / `extractTypeQuantitiesOnDemand` in
 * `@ifc-lite/parser`), so nothing downstream needs to change to see this.
 *
 * Covers any entity shaped like `IfcTypeObject` → `IfcTypeProduct` →
 * `IfcElementType` (header: GlobalId, OwnerHistory, Name, Description,
 * ApplicableOccurrence, HasPropertySets, RepresentationMaps, Tag,
 * ElementType) plus an optional single `PredefinedType` enum — the Type-side
 * mirror of the shape `library-element.ts` assumes for instances. `PredefinedType`
 * only exists from IFC4 onward, same caveat as the instance builder.
 *
 * `HasPropertySets` is deliberately left `$` here; the technical-data Pset
 * is attached afterward via `StoreEditor.addPropertySet` (the same path the
 * Properties panel's own "add property set" UI uses), which is what the
 * rest of the app actually reads — emitting the raw entities and hoping the
 * `HasPropertySets` list line up would be a second, easy-to-drift source of
 * truth for the same data.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { generateIfcGuid, type RandomSource } from '@ifc-lite/encoding';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';

/**
 * Mirrors `@ifc-lite/mutations`' `PropertyKind` (not re-exported from that
 * package's public index, so duplicated here as a small literal union
 * rather than reaching into its internal `store-editor.js` path).
 */
type PropertyKind = 'TEXT' | 'LABEL' | 'REAL' | 'INTEGER' | 'BOOLEAN';

export interface LibraryTypeInStoreParams {
  /** The IFC Type entity to emit, e.g. `'IfcSensorType'`. */
  IfcEntity: string;
  Name?: string;
  Description?: string;
  /** Carries the catalog entry id in this codebase's convention — lets callers find-or-reuse a Type across placements. */
  Tag?: string;
  /** Free-text sub-type label (IfcElementType.ElementType). */
  ElementType?: string;
  /** PredefinedType enum value (without dots). Ignored on IFC2X3. */
  PredefinedType?: string;
  /** Flat "Technical Data"-style property bag, attached as a Pset once the Type entity exists. */
  TechnicalData?: Record<string, string | number | boolean>;
  /** Pset name for `TechnicalData`. Deliberately not `Pset_`-prefixed — that prefix is reserved for buildingSMART-standard sets. */
  TechnicalDataPsetName?: string;
}

export interface LibraryTypeBuildResult {
  typeId: number;
}

const DEFAULT_TECHNICAL_DATA_PSET = 'CustomTechnicalData';

export function addLibraryTypeToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: LibraryTypeInStoreParams,
): LibraryTypeBuildResult {
  if (!params.IfcEntity) {
    throw new Error('addLibraryTypeToStore: IfcEntity is required');
  }

  const isIFC2X3 = (anchor.schema ?? 'IFC4') === 'IFC2X3';
  const defaultName = params.IfcEntity.replace(/^Ifc/, '').replace(/Type$/, '');
  const attrs: unknown[] = [
    generateIfcGuid(anchor.guidRandom),
    ownerHistoryRef(anchor.ownerHistoryId),
    params.Name ?? defaultName,
    params.Description ?? null,
    null, // ApplicableOccurrence
    null, // HasPropertySets — see file doc: attached via editor.addPropertySet instead
    null, // RepresentationMaps
    params.Tag ?? null,
    params.ElementType ?? null,
  ];
  if (!isIFC2X3 && params.PredefinedType) {
    attrs.push(`.${params.PredefinedType}.`);
  }

  const typeId = editor.addEntity(params.IfcEntity, attrs as Parameters<StoreEditor['addEntity']>[1]).expressId;

  if (params.TechnicalData && Object.keys(params.TechnicalData).length > 0) {
    const properties = Object.entries(params.TechnicalData).map(([name, value]) => ({
      name,
      value,
      type: propertyKindFor(value),
    }));
    editor.addPropertySet(typeId, params.TechnicalDataPsetName ?? DEFAULT_TECHNICAL_DATA_PSET, properties);
  }

  return { typeId };
}

function propertyKindFor(value: string | number | boolean): PropertyKind {
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  return 'LABEL';
}

/**
 * Links one or more instances to a Type via a fresh `IfcRelDefinesByType`
 * (a new small rel per call rather than mutating an existing one, matching
 * `emitRelContainedInSpatialStructure`'s reasoning in `_emit-helpers.ts`).
 * ifclite resolves an instance's Type via the inverse of this relationship,
 * so this is what makes `addLibraryTypeToStore`'s Pset actually apply.
 */
export function emitRelDefinesByType(
  editor: StoreEditor,
  ownerHistoryId: number | null,
  relatedObjectIds: readonly number[],
  relatingTypeId: number,
  random?: RandomSource,
): number {
  return editor.addEntity('IfcRelDefinesByType', [
    generateIfcGuid(random),
    ownerHistoryRef(ownerHistoryId),
    null,
    null,
    relatedObjectIds.map((id) => `#${id}`),
    `#${relatingTypeId}`,
  ]).expressId;
}
