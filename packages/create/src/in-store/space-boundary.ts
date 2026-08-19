/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `IfcRelSpaceBoundary` for elements that already exist.
 *
 * The space builder writes boundaries for the walls a new room was found
 * between; this writes one for a pairing decided later — a door and the two
 * rooms it joins, say, which is a statement the model cannot make any other
 * way. Both go through the same emit so the attribute order is written down
 * once.
 *
 * Attribute order is stable across IFC2X3 and IFC4: GlobalId, OwnerHistory,
 * Name, Description, RelatingSpace, RelatedBuildingElement, ConnectionGeometry,
 * PhysicalOrVirtualBoundary, InternalOrExternalBoundary.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { generateIfcGuid } from '@ifc-lite/encoding';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';

export interface SpaceBoundaryParams {
  /** The `IfcSpace` the boundary belongs to. */
  spaceId: number;
  /** The bounding element — a wall, a door, a virtual separator. */
  elementId: number;
  /** INTERNAL (another space beyond), EXTERNAL (the outside), NOTDEFINED. */
  internalOrExternal?: 'INTERNAL' | 'EXTERNAL' | 'NOTDEFINED';
  /** PHYSICAL (a real element) or VIRTUAL. Defaults to PHYSICAL. */
  physicalOrVirtual?: 'PHYSICAL' | 'VIRTUAL';
  /** Optional label, e.g. the door number the boundary was created for. */
  name?: string;
}

export interface SpaceBoundaryResult {
  boundaryId: number;
}

export function addSpaceBoundaryToStore(
  editor: StoreEditor,
  anchor: SpatialAnchor,
  params: SpaceBoundaryParams,
): SpaceBoundaryResult {
  const boundaryId = editor.addEntity('IfcRelSpaceBoundary', [
    generateIfcGuid(anchor.guidRandom),
    ownerHistoryRef(anchor.ownerHistoryId),
    params.name ?? null,
    null,
    `#${params.spaceId}`,
    `#${params.elementId}`,
    null,
    `.${params.physicalOrVirtual ?? 'PHYSICAL'}.`,
    `.${params.internalOrExternal ?? 'NOTDEFINED'}.`,
  ] as Parameters<StoreEditor['addEntity']>[1]).expressId;

  return { boundaryId };
}

export default addSpaceBoundaryToStore;
