/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading the aggregate parent out of a loaded model, for {@link liftToWholes}.
 *
 * Shared by the store action that performs the move and the dialog that
 * previews it, so the dialog can never count the panes while the action moves
 * the wall.
 */

import { RelationshipType } from '@ifc-lite/data';
import { liftToWholes, type LiftResult } from './lift-to-whole';

/** Spatial structure decomposes through the same relation; the walk stops there. */
export const SPATIAL_STRUCTURE_TYPES: ReadonlySet<string> = new Set([
  'IfcSpace', 'IfcSpatialZone', 'IfcBuildingStorey', 'IfcBuilding', 'IfcSite', 'IfcProject',
]);

export interface DecompositionSource {
  getRelated(
    expressId: number,
    type: RelationshipType,
    direction: 'forward' | 'inverse',
  ): number[];
}

/**
 * Every id replaced by the outermost element it is a part of.
 *
 * `typeOf` decides where the element world ends and the spatial one begins —
 * without it the walk would lift a room to its storey and then try to file the
 * storey under another storey.
 */
export function liftSelectionToWholes(
  ids: readonly number[],
  relationships: DecompositionSource | null | undefined,
  typeOf: (expressId: number) => string | null,
): LiftResult {
  if (!relationships) return { targets: [...new Set(ids)], lifted: [] };
  const parentOf = (id: number): number | null => {
    const parents = relationships.getRelated(id, RelationshipType.Aggregates, 'inverse');
    const parent = parents.length > 0 ? parents[0] : null;
    if (parent === null) return null;
    return SPATIAL_STRUCTURE_TYPES.has(typeOf(parent) ?? '') ? null : parent;
  };
  return liftToWholes(ids, parentOf);
}
