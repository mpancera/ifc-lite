/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Answers "does this saved work still apply to the file that is now open?"
 *
 * Deliberately not a yes/no. A new model version usually changes one area and
 * leaves the rest alone, so most of a planning state still fits while a few
 * pieces do not — and which is which is exactly what a person needs to see
 * before deciding. Nothing here mutates anything; it only classifies.
 *
 * Three verdicts:
 *   ok        — self-contained, or its anchor is still in the file unchanged
 *   suspect   — the anchor exists but its surroundings changed, so the
 *               element's position is geometrically valid and probably wrong
 *   orphaned  — there is no storey to hang it on. `restoreOverlaySnapshot`
 *               skips the registration and the mesh for those, so applying one
 *               puts an entity in the model that has no place in the hierarchy
 *               and is not drawn.
 *
 * # An absent identifier is not a deleted one
 * A placement saved without a storey and a placement whose storey has since
 * been deleted both end up unhangeable — but they are not the same finding,
 * and reporting the second when the first is true accuses an architect of
 * deleting a storey they never touched. The same holds for the room: an
 * element that never sat in one is not an element whose room is unchanged, and
 * saying so would claim a check that never ran. Each case is its own bucket.
 *
 * # Work that is already in the file
 * Exporting writes the authored objects into a new file, with their GlobalIds.
 * That file has a new hash, so nothing matches it exactly and this same saved
 * state comes back as a candidate — for work the file already contains.
 * Restoring it again would insert everything twice, so anything found in the
 * open file under its own GlobalId is excluded from the buckets, and a state
 * that is entirely present is reported as `materialised` for the caller to
 * retire instead of offering.
 *
 * The sentences live in `reconcileMessages` — what is true here, how it is
 * said there.
 */

import { compareAnchor, type AnchorState } from './referenceIndex';
import { RECONCILE_TEXT as TEXT, fileLabel } from './reconcileMessages';
import type { OverlaySnapshot, ReconcileItem, ReconcileReport, ReconcileVerdict } from './types';

/** What reconciliation needs to read from the newly opened model. */
export interface ReconcileTarget {
  /** Express id for a stable identifier, or -1 when the file has no such entity. */
  expressIdOfGlobalId: (globalId: string) => number;
  /**
   * Geometry fingerprint of an entity in the OPEN model, or `null` when it has
   * none. Optional: without it the check falls back to existence only, and
   * says so rather than claiming a room is unchanged.
   */
  geometryHashOfGlobalId?: (globalId: string) => string | null;
}

export interface ReconcileOptions {
  /**
   * Name of the file now open. Every message quotes it, because "the storey
   * does not exist" invites "in what?" — and when the claim is wrong, naming
   * the file is what makes that obvious. Callers without a name get a wording
   * that is still true; see `fileLabel`.
   */
  currentModelName?: string;
}

export function reconcileSnapshot(
  snapshot: OverlaySnapshot,
  currentSourceHash: string,
  target: ReconcileTarget,
  options: ReconcileOptions = {},
): ReconcileReport {
  const identical = snapshot.sourceHash === currentSourceHash;
  const file = fileLabel(options.currentModelName);
  const exists = (globalId: string | null): boolean =>
    globalId !== null && target.expressIdOfGlobalId(globalId) >= 0;

  const items: ReconcileItem[] = [];

  if (identical) {
    // Same bytes: every express id still means what it meant, so there is
    // nothing to weigh up.
    const all = snapshot.newEntities.map((e) => e.expressId);
    if (all.length > 0 || snapshot.mutations.length > 0) {
      items.push({
        verdict: 'ok',
        ...TEXT.allChanges(all.length + snapshot.mutations.length, file),
        count: all.length + snapshot.mutations.length,
        expressIds: all,
      });
    }
    return { identical, items, counts: countBy(items), materialised: false };
  }

  // An authored object carries its own GlobalId, so the open file can be asked
  // whether it already holds it. Two kinds of authored entity cannot be asked,
  // and both would otherwise answer "missing" and defeat the check:
  //
  //   - geometry plumbing (points, placements, profiles) has no GlobalId at
  //     all; it rides with the product it belongs to, which does have one;
  //   - `IfcRel*` relationships DO carry a GlobalId, but the parser's
  //     GlobalId index holds products, not relationships. Verified against a
  //     real export: the file plainly contains the GlobalId of an authored
  //     `IfcRelAggregates`, and looking it up still answers -1. Counting those
  //     as absent made a fully exported state look half-restored.
  const guidOf = (entity: { attributes: readonly unknown[] }): string | null => {
    const first = entity.attributes[0];
    return typeof first === 'string' && first.length === 22 ? first : null;
  };
  const isRelationship = (type: string) => type.toLowerCase().startsWith('ifcrel');
  const checkable = snapshot.newEntities.filter(
    (e) => guidOf(e) !== null && !isRelationship(e.type),
  );
  const presentIds = new Set(
    checkable.filter((e) => exists(guidOf(e))).map((e) => e.expressId),
  );
  // Conservative on purpose: only "every checkable object is already there"
  // counts as materialised. A false negative merely asks a question that was
  // already answered; a false positive would retire a saved state whose work
  // is nowhere on disk.
  const materialised = checkable.length > 0 && presentIds.size === checkable.length;
  if (materialised) {
    // Nothing to decide and nothing to restore: this is the file that state was
    // exported to. Reported rather than silently dropped so the caller can
    // retire the snapshot instead of offering it again on the next open.
    return { identical, items, counts: countBy(items), materialised };
  }

  // A relationship pointing at an object the file already holds belongs to
  // that object and is in the file with it. Restoring it alone would attach a
  // second copy of the relationship to nothing.
  const refersToPresent = (entity: { attributes: readonly unknown[] }): boolean =>
    entity.attributes.some((attribute) => {
      const values = Array.isArray(attribute) ? attribute : [attribute];
      return values.some((value) => (
        typeof value === 'string' && value.startsWith('#') && presentIds.has(Number(value.slice(1)))
      ));
    });

  // Authored entities that no anchor can invalidate: they are ours end to end.
  const placementIds = new Set(snapshot.placements.map((p) => p.expressId));
  const selfContained = snapshot.newEntities
    .filter((e) => !placementIds.has(e.expressId) && !presentIds.has(e.expressId)
      && !(isRelationship(e.type) && refersToPresent(e)))
    .map((e) => e.expressId);
  if (presentIds.size > 0) {
    items.push({
      verdict: 'ok',
      ...TEXT.alreadyPresent(presentIds.size, file),
      count: presentIds.size,
      expressIds: [],
      // Nothing is applied for these — the row exists to explain why the
      // number on the button is smaller than the number of objects the saved
      // state holds.
      informational: true,
    });
  }
  if (selfContained.length > 0) {
    items.push({
      verdict: 'ok',
      ...TEXT.selfContained(selfContained.length, file),
      count: selfContained.length,
      expressIds: selfContained,
    });
  }

  // Anchors carry the reference model's state at save time, so a room that was
  // RESHAPED (same GlobalId, new geometry — what an architect actually does)
  // is caught. Without them only disappearance is detectable.
  const anchorByGlobalId = new Map(
    (snapshot.reference?.anchors ?? []).map((a) => [a.globalId, a] as const),
  );
  const anchorState = (globalId: string): AnchorState => {
    if (!exists(globalId)) return 'missing';
    const anchor = anchorByGlobalId.get(globalId);
    if (!anchor) return 'unknown';
    return compareAnchor(anchor, {
      exists: true,
      geometryHash: target.geometryHashOfGlobalId?.(globalId) ?? null,
    });
  };

  const placed = {
    /** Storey and room both there, room provably unchanged. */
    ok: [] as number[],
    /** No room was involved — the element hangs on the storey itself. */
    directOnStorey: [] as number[],
    /** Room is there; whether it was reshaped cannot be known from this save. */
    unverified: [] as number[],
    reshaped: [] as number[],
    /** Room gone, storey still there. */
    roomGone: [] as number[],
    /** Storey recorded and gone. */
    storeyGone: [] as number[],
    /** No storey was recorded at save time — a different statement entirely. */
    storeyUnrecorded: [] as number[],
  };

  for (const placement of snapshot.placements) {
    if (presentIds.has(placement.expressId)) continue;
    if (placement.storeyGlobalId === null) {
      placed.storeyUnrecorded.push(placement.expressId);
      continue;
    }
    if (!exists(placement.storeyGlobalId)) {
      placed.storeyGone.push(placement.expressId);
      continue;
    }
    if (placement.containerGlobalId === null) {
      placed.directOnStorey.push(placement.expressId);
      continue;
    }
    const state = anchorState(placement.containerGlobalId);
    if (state === 'missing') placed.roomGone.push(placement.expressId);
    else if (state === 'reshaped') placed.reshaped.push(placement.expressId);
    else if (state === 'unknown') placed.unverified.push(placement.expressId);
    else placed.ok.push(placement.expressId);
  }

  const push = (
    verdict: ReconcileVerdict,
    ids: number[],
    text: (n: number, file: string) => { label: string; detail: string },
  ) => {
    if (ids.length === 0) return;
    items.push({ verdict, ...text(ids.length, file), count: ids.length, expressIds: ids });
  };

  push('suspect', placed.reshaped, TEXT.reshapedRoom);
  push('ok', placed.ok, TEXT.placedOk);
  push('ok', placed.directOnStorey, TEXT.directOnStorey);
  push('ok', placed.unverified, TEXT.unverifiedRoom);
  push('suspect', placed.roomGone, TEXT.deletedRoom);
  push('orphaned', placed.storeyGone, TEXT.storeyGone);
  push('orphaned', placed.storeyUnrecorded, TEXT.storeyUnrecorded);

  // Edits carry no authored entity, so they contribute no express ids: they
  // ride along with `applyMutations`, gated on the same GlobalId lookup.
  const editsOrphaned = snapshot.editedBaseEntities.filter((ref) => !exists(ref.globalId));
  const editsReshaped = snapshot.editedBaseEntities.filter(
    (ref) => exists(ref.globalId) && anchorState(ref.globalId) === 'reshaped',
  );
  const editsOk = snapshot.editedBaseEntities.length - editsOrphaned.length - editsReshaped.length;
  if (editsOk > 0) {
    items.push({ verdict: 'ok', ...TEXT.editsOk(editsOk, file), count: editsOk, expressIds: [] });
  }
  if (editsReshaped.length > 0) {
    items.push({
      verdict: 'suspect',
      ...TEXT.editsReshaped(editsReshaped.length, file),
      count: editsReshaped.length,
      expressIds: [],
    });
  }
  if (editsOrphaned.length > 0) {
    items.push({
      verdict: 'orphaned',
      ...TEXT.editsOrphaned(editsOrphaned.length, file),
      count: editsOrphaned.length,
      expressIds: [],
    });
  }

  const deletionsOrphaned = snapshot.deleted.filter((ref) => !exists(ref.globalId));
  if (deletionsOrphaned.length > 0) {
    items.push({
      verdict: 'orphaned',
      ...TEXT.deletionsOrphaned(deletionsOrphaned.length, file),
      count: deletionsOrphaned.length,
      expressIds: [],
    });
  }

  return { identical, items, counts: countBy(items), materialised };
}

function countBy(items: ReconcileItem[]): Record<ReconcileVerdict, number> {
  const counts: Record<ReconcileVerdict, number> = { ok: 0, suspect: 0, orphaned: 0 };
  for (const item of items) counts[item.verdict] += 1;
  return counts;
}

/**
 * The express ids to restore when the user takes only what is unambiguous —
 * everything an `ok` item covers, and nothing from a suspect or orphaned one.
 */
export function undisputedExpressIds(report: ReconcileReport): Set<number> {
  const ids = new Set<number>();
  for (const item of report.items) {
    if (item.verdict !== 'ok') continue;
    for (const id of item.expressIds) ids.add(id);
  }
  return ids;
}

/**
 * How many authored objects each button would bring in — the numbers the
 * dialog puts on its own labels, so "übernehmen" says how much of the saved
 * work it is about to apply and how much it leaves behind.
 */
export function restoreCounts(report: ReconcileReport): { undisputed: number; held: number } {
  let undisputed = 0;
  let held = 0;
  for (const item of report.items) {
    // `count`, not `expressIds.length`: an edit row restores no authored
    // object and would otherwise make the button promise nothing. A row that
    // applies nothing at all is left out of both totals — it is a note, not a
    // decision.
    if (item.informational) continue;
    if (item.verdict === 'ok') undisputed += item.count;
    else held += item.count;
  }
  return { undisputed, held };
}

/**
 * Whether this report is worth putting in front of somebody.
 *
 * A saved state can survive reconciliation with nothing to say: its only edit
 * was on an entity that carries no GlobalId (a unit, a context, anything the
 * capture cannot re-identify across versions), so there is no row to show and
 * nothing that would be applied. Raising the dialog then asks a question about
 * an empty list and offers to "übernehmen (0)" — which is not a decision, just
 * an interruption.
 */
export function hasDecisions(report: ReconcileReport): boolean {
  return report.items.length > 0;
}

/**
 * Whether this saved state is known to be contained in the file with `hash`
 * already, and must therefore not be offered for it.
 *
 * The check is persisted rather than re-derived because it has to survive a
 * reload: the reconciliation can only see that the work is present, which is
 * exactly as true on the tenth open as on the first — without the record, the
 * same prompt would come back every single time.
 */
export function isMutedFor(snapshot: OverlaySnapshot, hash: string): boolean {
  return (snapshot.materialisedIn ?? []).includes(hash);
}

/**
 * The same state, with `hash` recorded as a file that now contains it.
 *
 * Returns a copy — snapshots go to IndexedDB by structured clone, and mutating
 * the one still held in memory would make the stored and the live value
 * disagree about what has been written where.
 */
export function withMaterialisedIn(snapshot: OverlaySnapshot, hash: string): OverlaySnapshot {
  if (isMutedFor(snapshot, hash)) return snapshot;
  return { ...snapshot, materialisedIn: [...(snapshot.materialisedIn ?? []), hash] };
}
