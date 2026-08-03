/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turns a live authoring overlay into a durable snapshot.
 *
 * Pure apart from the reads it is handed, so the whole capture is testable
 * without a browser, a parsed model or IndexedDB.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { ReferenceModelIndex } from './referenceIndex';
import {
  SNAPSHOT_VERSION,
  type OverlaySnapshot,
  type SnapshotBaseRef,
  type SnapshotMesh,
  type SnapshotPlacement,
} from './types';

/** The reads capture needs from a parsed model, narrowed for testability. */
export interface SnapshotSource {
  /** Stable identifier of a base entity, or '' when it has none. */
  globalIdOf: (expressId: number) => string;
  /** Storey an authored element was registered against, if any. */
  storeyOf: (expressId: number) => number | undefined;
  /** IFC class of an authored element, for the hierarchy rebuild. */
  typeNameOf: (expressId: number) => string;
  /**
   * Preview mesh of an authored element, if it has one.
   *
   * Moves need no special handling here, which is not obvious: `translateEntity`
   * rewrites the IFC coordinate and hands the renderer a delta, and reading the
   * mesh immediately afterwards still shows the OLD position — the renderer
   * applies the shift to the shared buffer on the next frame. By the time a
   * debounced capture runs, the mesh holds the moved position, so passing it
   * through is correct. Offsetting it here as well double-counts the move and
   * restores the element at twice the distance (measured: a 5 m move stored as
   * 10 m). The positional mutation is replayed independently, so data and
   * geometry agree either way.
   */
  meshOf: (expressId: number) => MeshData | undefined;
  /** Spatial element the IFC containment points at, if resolvable. */
  containerOf: (expressId: number) => number | undefined;
  /**
   * Record the reference model against the anchors this snapshot leans on.
   * Optional so capture stays usable without a parsed model.
   */
  buildReference?: (anchorExpressIds: Iterable<number>) => ReferenceModelIndex;
}

export interface CaptureArgs {
  view: MutablePropertyView;
  source: SnapshotSource;
  sourceHash: string;
  modelName: string;
  /** Injectable for deterministic tests. */
  now?: () => number;
}

/**
 * `null` when there is nothing worth saving — an untouched model must not
 * leave a snapshot behind that would later prompt about restoring nothing.
 */
export function captureOverlaySnapshot(args: CaptureArgs): OverlaySnapshot | null {
  const { view, source, sourceHash, modelName } = args;

  const newEntities = view.getNewEntities();
  const mutations = view.getMutations();
  const tombstones = view.getTombstones();
  if (newEntities.length === 0 && mutations.length === 0 && tombstones.size === 0) {
    return null;
  }

  const authoredIds = new Set(newEntities.map((e) => e.expressId));

  // Only entities the hierarchy knows about are products; the placements,
  // profiles and solids created alongside them are geometry plumbing that the
  // overlay restores as plain entities.
  const placements: SnapshotPlacement[] = [];
  const meshes: SnapshotMesh[] = [];
  /** Reference entities the work hangs off — the storeys and rooms it anchors to. */
  const anchorExpressIds = new Set<number>();
  for (const entity of newEntities) {
    const storeyId = source.storeyOf(entity.expressId);
    if (storeyId === undefined) continue;
    const containerId = source.containerOf(entity.expressId);
    anchorExpressIds.add(storeyId);
    // An authored container (a space sketched this session) is restored with
    // the snapshot, so it is not a reference-model anchor.
    if (containerId !== undefined && !authoredIds.has(containerId)) anchorExpressIds.add(containerId);
    const rawName = entity.attributes[2];
    placements.push({
      expressId: entity.expressId,
      ifcType: source.typeNameOf(entity.expressId) || entity.type,
      name: typeof rawName === 'string' ? rawName : '',
      storeyGlobalId: source.globalIdOf(storeyId) || null,
      containerGlobalId: containerId === undefined ? null : source.globalIdOf(containerId) || null,
    });
    const mesh: MeshData | undefined = source.meshOf(entity.expressId);
    if (mesh) meshes.push({ expressId: entity.expressId, mesh });
  }

  const toBaseRef = (expressId: number): SnapshotBaseRef | null => {
    // An authored entity is restored with us and needs no stable identifier;
    // only references INTO the source file have to survive a re-export.
    if (authoredIds.has(expressId)) return null;
    const globalId = source.globalIdOf(expressId);
    return globalId ? { expressId, globalId } : null;
  };

  const deleted: SnapshotBaseRef[] = [];
  for (const expressId of tombstones) {
    const ref = toBaseRef(expressId);
    if (ref) deleted.push(ref);
  }

  const editedBaseEntities: SnapshotBaseRef[] = [];
  const seenEdited = new Set<number>();
  for (const mutation of mutations) {
    if (mutation.type === 'CREATE_ENTITY' || mutation.type === 'DELETE_ENTITY') continue;
    if (seenEdited.has(mutation.entityId)) continue;
    seenEdited.add(mutation.entityId);
    const ref = toBaseRef(mutation.entityId);
    if (ref) {
      editedBaseEntities.push(ref);
      // An edited entity is an anchor too: a correction to a wall is only
      // meaningful while that wall is the wall it was written against.
      anchorExpressIds.add(mutation.entityId);
    }
  }

  return {
    version: SNAPSHOT_VERSION,
    sourceHash,
    modelName,
    savedAt: (args.now ?? Date.now)(),
    newEntities,
    mutations,
    deleted,
    editedBaseEntities,
    placements,
    reference: source.buildReference?.(anchorExpressIds),
    meshes,
  };
}
