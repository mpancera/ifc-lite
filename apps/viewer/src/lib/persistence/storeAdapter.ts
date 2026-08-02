/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bridges the viewer's store to the snapshot layer's narrow read/write
 * interfaces, so capture, reconcile and restore stay free of store and
 * renderer knowledge and can be tested without either.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SnapshotSource } from './captureSnapshot';
import type { ReconcileTarget } from './reconcileSnapshot';

/**
 * The spatial element an authored element was contained in, read back off the
 * overlay's own `IfcRelContainedInSpatialStructure`
 * (GlobalId, OwnerHistory, Name, Description, RelatedElements, RelatingStructure).
 * This is the room when one enclosed the placement, else the storey.
 */
export function overlayContainerOf(view: MutablePropertyView, expressId: number): number | undefined {
  for (const entity of view.getNewEntities()) {
    if (entity.type !== 'IfcRelContainedInSpatialStructure') continue;
    const related = entity.attributes[4];
    const structure = entity.attributes[5];
    if (!Array.isArray(related) || typeof structure !== 'string') continue;
    if (!related.includes(`#${expressId}`)) continue;
    const containerId = Number(structure.replace('#', ''));
    return Number.isNaN(containerId) ? undefined : containerId;
  }
  return undefined;
}

export interface SnapshotSourceArgs {
  store: IfcDataStore;
  view: MutablePropertyView;
  meshes: readonly MeshData[];
  /** Local express id -> the federated id the renderer keyed its mesh by. */
  toGlobalId: (expressId: number) => number;
}

export function makeSnapshotSource(args: SnapshotSourceArgs): SnapshotSource {
  const { store, view, meshes, toGlobalId } = args;

  // Meshes are keyed by federated id; index once rather than scanning the
  // model's full mesh list per authored element.
  const meshByGlobalId = new Map<number, MeshData>();
  for (const mesh of meshes) meshByGlobalId.set(mesh.expressId, mesh);

  const typeByExpressId = new Map<number, string>();
  for (const entity of view.getNewEntities()) typeByExpressId.set(entity.expressId, entity.type);

  return {
    globalIdOf: (expressId) => store.entities.getGlobalId(expressId) || '',
    storeyOf: (expressId) => store.spatialHierarchy?.elementToStorey.get(expressId),
    typeNameOf: (expressId) => typeByExpressId.get(expressId) ?? '',
    meshOf: (expressId) => meshByGlobalId.get(toGlobalId(expressId)),
    containerOf: (expressId) => overlayContainerOf(view, expressId),
  };
}

/**
 * Resolving a stable identifier back to this file's express id is what decides
 * whether saved work still applies, so a store without the lookup must report
 * "not found" rather than appear to match everything.
 */
export function makeReconcileTarget(store: IfcDataStore): ReconcileTarget {
  return {
    expressIdOfGlobalId: (globalId) => store.entities.getExpressIdByGlobalId?.(globalId) ?? -1,
  };
}
