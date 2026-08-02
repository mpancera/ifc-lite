/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Replays a snapshot into a live overlay.
 *
 * Restoring is three separate jobs, and skipping any one of them leaves the
 * session subtly wrong rather than obviously broken:
 *   1. the overlay entities and edits, so the data is back;
 *   2. the spatial hierarchy registration, so the Hierarchy tree, Solo mode
 *      and every overlay-aware reader (lists, lens) see the elements;
 *   3. the preview meshes, so the elements are actually visible in 3D rather
 *      than existing only in tables.
 *
 * `keep` narrows what comes back. Reconciliation decides which authored
 * entities are unambiguous; anything left out stays in the snapshot untouched,
 * so declining a few elements never destroys them.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { MutablePropertyView, NewEntity } from '@ifc-lite/mutations';
import type { OverlaySnapshot } from './types';

export interface RestoreHooks {
  /** Re-register an authored product against its storey. */
  registerElement: (args: {
    expressId: number;
    storeyExpressId: number;
    ifcType: string;
    name: string;
  }) => void;
  /** Express id for a stable identifier, or -1 when absent from this file. */
  expressIdOfGlobalId: (globalId: string) => number;
  /** Hand restored preview meshes back to the renderer. */
  appendMeshes: (meshes: MeshData[]) => void;
}

export interface RestoreResult {
  entitiesRestored: number;
  mutationsApplied: number;
  elementsRegistered: number;
  meshesRestored: number;
  /** Authored entities the caller excluded, or whose storey no longer exists. */
  skipped: number;
}

export function restoreOverlaySnapshot(
  snapshot: OverlaySnapshot,
  view: MutablePropertyView,
  hooks: RestoreHooks,
  keep?: ReadonlySet<number>,
): RestoreResult {
  const wanted = (expressId: number) => keep === undefined || keep.has(expressId);

  const restoredEntities = new Set<number>();
  for (const entity of snapshot.newEntities) {
    if (!wanted(entity.expressId)) continue;
    view.restoreNewEntity(entity as NewEntity);
    restoredEntities.add(entity.expressId);
  }

  // A mutation on an entity that was not restored would attach properties to
  // an id this session never allocated, so those are dropped with it. Edits on
  // BASE entities are keyed by express id, which is only meaningful for the
  // file they were authored against — hence the guard on the caller's lookup.
  const editable = new Map(snapshot.editedBaseEntities.map((r) => [r.expressId, r.globalId] as const));
  const applicable = snapshot.mutations.filter((mutation) => {
    if (mutation.type === 'CREATE_ENTITY') return false;
    if (restoredEntities.has(mutation.entityId)) return true;
    const globalId = editable.get(mutation.entityId);
    if (globalId === undefined) return false;
    return hooks.expressIdOfGlobalId(globalId) === mutation.entityId;
  });
  if (applicable.length > 0) view.applyMutations(applicable);

  let elementsRegistered = 0;
  const restoredMeshIds = new Set<number>();
  for (const placement of snapshot.placements) {
    if (!restoredEntities.has(placement.expressId)) continue;
    if (placement.storeyGlobalId === null) continue;
    const storeyExpressId = hooks.expressIdOfGlobalId(placement.storeyGlobalId);
    if (storeyExpressId < 0) continue;
    hooks.registerElement({
      expressId: placement.expressId,
      storeyExpressId,
      ifcType: placement.ifcType,
      name: placement.name,
    });
    elementsRegistered += 1;
    restoredMeshIds.add(placement.expressId);
  }

  const meshes = snapshot.meshes
    .filter((entry) => restoredMeshIds.has(entry.expressId))
    .map((entry) => entry.mesh);
  if (meshes.length > 0) hooks.appendMeshes(meshes);

  return {
    entitiesRestored: restoredEntities.size,
    mutationsApplied: applicable.length,
    elementsRegistered,
    meshesRestored: meshes.length,
    skipped: snapshot.newEntities.length - restoredEntities.size,
  };
}
