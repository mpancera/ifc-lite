/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The shape of a saved authoring session.
 *
 * Everything authored in a session lives in the mutation overlay, which is
 * memory only — closing the tab loses it. A snapshot is that overlay written
 * somewhere durable, plus exactly enough context to answer, when a file is
 * opened later, "does this still apply?".
 *
 * That question is why entity references are stored TWICE. Express ids are what
 * the overlay actually uses, but they are assigned per export and are not
 * stable: `#14130` may be a storey in one export of a building and a geometry
 * point in the next. GlobalIds are stable by design, so every reference into
 * the *source file* also carries one. References between authored entities
 * (an element to its type, a system to its members) stay express-id only —
 * those ids are allocated by us and restored together, so they cannot drift.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { Mutation, NewEntity } from '@ifc-lite/mutations';
import type { ReferenceModelIndex } from './referenceIndex';

/** Current snapshot format. Bumped when the shape changes incompatibly. */
export const SNAPSHOT_VERSION = 1;

/**
 * An authored product and where it was put. `registerAuthoredElement` needs
 * this to rebuild the spatial hierarchy, and reconciliation needs it to tell
 * "the storey is still there" from "the storey is gone".
 */
export interface SnapshotPlacement {
  expressId: number;
  ifcType: string;
  name: string;
  /** Storey the element was registered against, as a GlobalId. */
  storeyGlobalId: string | null;
  /**
   * The spatial element the IFC containment points at — the enclosing
   * `IfcSpace` when there was one, else the storey. Distinct from
   * `storeyGlobalId`: a device in a room is contained in the room but still
   * belongs to the storey, and only the room tells us whether the element sits
   * in an area the architect has since changed.
   */
  containerGlobalId: string | null;
}

/** A base-file entity an edit refers to, carried by its stable identifier. */
export interface SnapshotBaseRef {
  expressId: number;
  globalId: string;
}

export interface OverlaySnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** SHA-256 of the source file this was authored against. */
  sourceHash: string;
  /** File name at save time — shown in the reconciliation dialog. */
  modelName: string;
  savedAt: number;

  /** Overlay-created entities, verbatim. Restored via `restoreNewEntity`. */
  newEntities: NewEntity[];
  /** Mutation history. `applyMutations` replays it; CREATE_ENTITY is skipped. */
  mutations: Mutation[];

  /** Base entities deleted during the session. */
  deleted: SnapshotBaseRef[];
  /**
   * Base entities an attribute/property mutation touches. A mutation whose
   * entity is missing from a newly opened file is orphaned, and applying it
   * would silently write onto whatever now holds that express id.
   */
  editedBaseEntities: SnapshotBaseRef[];

  placements: SnapshotPlacement[];
  /**
   * Hashes of files that were found to already contain this state — the
   * exports it has been written into.
   *
   * A small history rather than a delete: exporting a restored state produces
   * a file that holds all of it, and offering the state back for that file
   * would insert everything twice. Recording the file instead of dropping the
   * state keeps the state available everywhere else — above all for the file
   * it was authored against, where it is still the crash-recovery copy it was
   * saved as.
   */
  materialisedIn?: string[];
  /**
   * The reference model as it stood when this was saved. Existence alone
   * cannot tell "unchanged" from "re-planned" — an architect who reshapes a
   * room keeps its GlobalId — so the anchors carry fingerprints too.
   *
   * Optional: snapshots written before this existed load without it, and
   * reconciliation falls back to the existence-only check.
   */
  reference?: ReferenceModelIndex;
  /**
   * Preview meshes for authored products, baked in renderer frame. Stored
   * rather than re-derived: duplication clones its source's geometry, which no
   * parametric record can reproduce. `MeshData` is typed arrays and numbers,
   * so IndexedDB's structured clone stores it as-is.
   *
   * Keyed by the LOCAL express id, not by position in `placements`: not every
   * placement has a mesh, so parallel arrays would silently shift. `MeshData`'s
   * own `expressId` is the federated global id (local + model offset), which is
   * why it cannot serve as the key.
   */
  meshes: SnapshotMesh[];
}

export interface SnapshotMesh {
  /** Local express id of the authored element this mesh belongs to. */
  expressId: number;
  mesh: MeshData;
}

/** How a snapshot entry relates to the file that is now open. */
export type ReconcileVerdict =
  /** Applies unchanged — either self-contained, or its anchor is still there. */
  | 'ok'
  /** Anchor still exists, but sits in an area that changed. Worth a look. */
  | 'suspect'
  /** The entity it refers to is not in this file. Cannot be applied. */
  | 'orphaned';

export interface ReconcileItem {
  verdict: ReconcileVerdict;
  /** What this covers, in the user's terms. Always states its own count. */
  label: string;
  /** Why it got this verdict, and what applying it would do. */
  detail: string;
  /**
   * How many things this row covers — the number its label states.
   *
   * Not the same as `expressIds.length`: an edit or a deletion refers to a
   * base entity by GlobalId and restores no authored object at all, so those
   * rows carry a count and no ids. A button that added up ids alone told a
   * reader it would apply "0" while it was about to replay their correction.
   */
  count: number;
  /**
   * Authored entities this item would restore. Empty for rows about edits and
   * deletions — those ride along with `applyMutations`.
   */
  expressIds: number[];
}

export interface ReconcileReport {
  /** True when the open file is byte-identical to the authored-against one. */
  identical: boolean;
  items: ReconcileItem[];
  /** Convenience counts for the dialog header. */
  counts: Record<ReconcileVerdict, number>;
  /**
   * Every authored object of this saved state is ALREADY in the open file,
   * under the same GlobalIds — which is what a file exported out of that state
   * looks like.
   *
   * Without this the app asked to restore work into the very file that work
   * had just been written to: the export gets a new hash, no snapshot matches
   * it exactly, and the same saved state comes back as a candidate on every
   * open. Accepting it a second time would insert every object twice.
   */
  materialised: boolean;
}
