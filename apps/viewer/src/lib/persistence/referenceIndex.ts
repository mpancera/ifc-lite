/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A record of the reference model as it stood when work was saved against it.
 *
 * The discipline work is additive: elements are placed, grouped and typed, and
 * the only coupling to the architecture model is by reference — this element
 * sits in that room, that room is on that storey. So the question a later
 * version has to answer is not "is my work still valid" but "did the thing I
 * anchored to change".
 *
 * Existence alone cannot answer that. An architect who re-plans a room keeps
 * its GlobalId and changes its geometry — that is what GlobalIds are for. A
 * check that only asks "does this id still exist" reports such a room as
 * unchanged and silently restores a detector that now sits inside a wall.
 * Recording the anchor's geometry hash turns that false pass into a flag.
 *
 * Deliberately cheap: GlobalIds come straight off the columnar table and
 * geometry hashes off meshes that were already computed. Nothing here re-reads
 * the STEP source, so it can run on every save.
 */

import { IfcTypeEnum } from '@ifc-lite/data';
import type { MeshData } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';

/** A reference-model entity this snapshot's work hangs off. */
export interface ReferenceAnchor {
  globalId: string;
  ifcType: string;
  name: string;
  /**
   * Geometry fingerprint at save time, as a string (`bigint` has no JSON or
   * structured-clone-friendly form here). `null` for entities without a mesh —
   * storeys, most notably, which is fine: a storey's identity is what matters,
   * not its shape.
   */
  geometryHash: string | null;
}

/**
 * Which project the reference model belongs to.
 *
 * `IfcProject.GlobalId` is issued once and carried through every export of
 * that project, which makes it the one field that distinguishes "a newer
 * version of what I was working on" from "a different building entirely".
 * Without it, saved work looks partly applicable to any file at all: a product
 * type and its system reference nothing in the architecture model, so they
 * always survive reconciliation and always suggest there is something to
 * restore.
 */
export interface ReferenceProject {
  globalId: string;
  name: string;
}

export interface ReferenceModelIndex {
  /** Every GlobalId present in the reference model at save time. */
  globalIds: string[];
  /** The entities this snapshot anchors to, with their fingerprints. */
  anchors: ReferenceAnchor[];
  /** Identity of the project this was authored against. */
  project?: ReferenceProject;
}

export interface BuildReferenceIndexArgs {
  store: IfcDataStore;
  meshes: readonly MeshData[];
  /** Local express id -> federated id, to match a mesh to its entity. */
  toGlobalId: (expressId: number) => number;
  /** Express ids of the reference entities the snapshot anchors to. */
  anchorExpressIds: Iterable<number>;
}

export function buildReferenceIndex(args: BuildReferenceIndexArgs): ReferenceModelIndex {
  const { store, meshes, toGlobalId, anchorExpressIds } = args;

  const geometryByFederatedId = new Map<number, bigint>();
  for (const mesh of meshes) {
    if (mesh.geometryHash === undefined) continue;
    if (!geometryByFederatedId.has(mesh.expressId)) {
      geometryByFederatedId.set(mesh.expressId, mesh.geometryHash);
    }
  }

  const globalIds: string[] = [];
  const column = store.entities.expressId;
  for (let i = 0; i < column.length; i++) {
    const expressId = column[i];
    if (!expressId) continue;
    const globalId = store.entities.getGlobalId(expressId);
    if (globalId) globalIds.push(globalId);
  }

  const anchors: ReferenceAnchor[] = [];
  const seen = new Set<number>();
  for (const expressId of anchorExpressIds) {
    if (seen.has(expressId)) continue;
    seen.add(expressId);
    const globalId = store.entities.getGlobalId(expressId);
    if (!globalId) continue;
    const hash = geometryByFederatedId.get(toGlobalId(expressId));
    anchors.push({
      globalId,
      ifcType: store.entities.getTypeName(expressId) || '',
      name: store.entities.getName(expressId) || '',
      geometryHash: hash === undefined ? null : hash.toString(),
    });
  }

  return { globalIds, anchors, project: readProject(store) };
}

/** Identity of the file's `IfcProject`, or `undefined` when it has none. */
export function readProject(store: IfcDataStore): ReferenceProject | undefined {
  const ids = store.entities.getByType(IfcTypeEnum.IfcProject);
  if (ids.length === 0) return undefined;
  const globalId = store.entities.getGlobalId(ids[0]) || '';
  if (!globalId) return undefined;
  return { globalId, name: store.entities.getName(ids[0]) || '' };
}

/**
 * Is the open file a version of the project this snapshot was authored
 * against?
 *
 * Answered on `IfcProject.GlobalId`, which an authoring tool carries across
 * exports of the same project. When either side has no project identity — an
 * older snapshot, or a file without an `IfcProject` — fall back to asking
 * whether the storeys the work is anchored to are present: work that fits
 * nowhere in this file is not worth offering, and work that fits everywhere
 * was never anchored to begin with.
 */
export function isSameProject(
  reference: ReferenceModelIndex | undefined,
  current: ReferenceProject | undefined,
  anchorExists: (globalId: string) => boolean,
): boolean {
  const saved = reference?.project;
  if (saved && current) return saved.globalId === current.globalId;

  const anchors = reference?.anchors ?? [];
  if (anchors.length === 0) return false;
  return anchors.some((anchor) => anchorExists(anchor.globalId));
}

/** How an anchor compares to the model that is now open. */
export type AnchorState = 'unchanged' | 'reshaped' | 'missing' | 'unknown';

/**
 * `unknown` is reported when neither side has a geometry hash, so a caller can
 * say "cannot tell" instead of claiming an unchanged room. Silence about a
 * change that might exist is worse than admitting the check could not run.
 */
export function compareAnchor(
  anchor: ReferenceAnchor,
  current: { exists: boolean; geometryHash: string | null },
): AnchorState {
  if (!current.exists) return 'missing';
  if (anchor.geometryHash === null || current.geometryHash === null) {
    return anchor.geometryHash === null && current.geometryHash === null ? 'unchanged' : 'unknown';
  }
  return anchor.geometryHash === current.geometryHash ? 'unchanged' : 'reshaped';
}
