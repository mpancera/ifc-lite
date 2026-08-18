/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Single source of truth for the IFC-class → `typeVisibility` toggle mapping.
 *
 * The same mapping was previously copy-pasted into three places
 * (`ViewportContainer.tsx` mesh filter, `basketVisibleSet.ts` visible-set
 * resolution, and `GLBExportDialog.tsx` export gating). Keeping it in one
 * table means a new class → toggle association is added once and every
 * consumer (viewport, Cesium, basket, export) stays in lockstep.
 */

import type { SpaceKind } from './spaceKind.js';
import type { TypeVisibility } from './types.js';

/** Which `typeVisibility` boolean gates each IFC class. */
type TypeVisibilityKey = keyof Pick<
  TypeVisibility,
  'spaces' | 'rooms' | 'storeySpaces' | 'parking'
  | 'spatialZones' | 'openings' | 'virtualElements' | 'site' | 'ifcAnnotations'
>;

/** Which toggle gates each kind of `IfcSpace`. */
const SPACE_KIND_TO_VISIBILITY_KEY: Readonly<Record<SpaceKind, TypeVisibilityKey>> = {
  room: 'rooms',
  storeySpace: 'storeySpaces',
  parking: 'parking',
};

/**
 * The slice of `typeVisibility` these helpers read — the toggles that gate a
 * whole IFC class. Consumers that only forward the gate (the 2D drawing hook)
 * take this rather than the full `TypeVisibility`, which also carries controls
 * with no class mapping (`ifcGrid`).
 */
export type TypeVisibilityGate = Pick<TypeVisibility, TypeVisibilityKey>;

/**
 * IFC class → toggle key. When the mapped toggle is `false` the class is
 * hidden from the viewport / export.
 *
 * `IfcGeographicElement` (terrain, `.TERRAIN.` etc.) rides the `site` toggle:
 * the Site row is labelled "Terrain & context" and users reasonably expect
 * modelled terrain to disappear with it (issue #1480). It renders as a normal
 * product mesh, so — like `IfcSite` — it is otherwise unaffected by any
 * type-visibility control.
 */
const IFC_TYPE_TO_VISIBILITY_KEY: Readonly<Record<string, TypeVisibilityKey>> = {
  IfcSpace: 'spaces',
  IfcSpatialZone: 'spatialZones',
  IfcOpeningElement: 'openings',
  IfcVirtualElement: 'virtualElements',
  IfcSite: 'site',
  IfcGeographicElement: 'site',
  // IfcAnnotation can carry real 3D solid geometry (Bonsai plan-view boxes,
  // Revit "Model Text" breps) on top of the 2D symbolic curve overlay; the
  // `ifcAnnotations` toggle hides both (issues #1354, #1480).
  IfcAnnotation: 'ifcAnnotations',
};

/**
 * True when a mesh of `ifcType` should be visible under the current
 * `typeVisibility` toggles. Classes with no mapped toggle are always visible.
 */
export function isTypeVisible(
  ifcType: string | undefined,
  typeVisibility: TypeVisibilityGate,
  spaceKind?: SpaceKind,
): boolean {
  if (!ifcType) return true;

  // Spaces split three ways — rooms, the storey-sized gross-area volume, and
  // parking — because they are used completely differently and one toggle for
  // all three was useless. `spaces` remains the master switch above them, so
  // turning it off still hides every space in one move.
  //
  // The KIND is passed in, already classified, rather than the raw
  // PredefinedType: a mesh carries neither, so the caller has to consult an
  // index either way, and classifying in one place keeps `classifySpace` the
  // only thing that knows how the enum maps.
  if (ifcType === 'IfcSpace') {
    if (!typeVisibility.spaces) return false;
    // A caller that cannot resolve the kind gets the coarse answer rather
    // than a guess.
    if (spaceKind === undefined) return true;
    return typeVisibility[SPACE_KIND_TO_VISIBILITY_KEY[spaceKind]];
  }

  const key = IFC_TYPE_TO_VISIBILITY_KEY[ifcType];
  if (key === undefined) return true;
  return typeVisibility[key];
}

/**
 * Build the set of IFC class names that are currently hidden by the toggles —
 * used by the GLB exporter to drop them on a visible-only export so the file
 * matches the viewport.
 */
export function buildHiddenIfcTypes(
  typeVisibility: TypeVisibilityGate,
): Set<string> {
  const out = new Set<string>();
  for (const [ifcType, key] of Object.entries(IFC_TYPE_TO_VISIBILITY_KEY)) {
    if (!typeVisibility[key]) out.add(ifcType);
  }
  return out;
}

/**
 * Whether every kind of space is currently hidden.
 *
 * The GLB export drops whole classes, so it can only exclude `IfcSpace` when
 * NO kind of space is wanted — hiding just the gross-area volumes is a
 * per-entity decision the class-level export cannot express.
 */
export function allSpaceKindsHidden(
  typeVisibility: Pick<TypeVisibility, TypeVisibilityKey>,
): boolean {
  return !typeVisibility.spaces
    || (!typeVisibility.rooms && !typeVisibility.storeySpaces && !typeVisibility.parking);
}
