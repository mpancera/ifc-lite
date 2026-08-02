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
 *   ok        — self-contained, or its anchor is still in the file
 *   suspect   — the anchor exists but the enclosing room does not, so the
 *               element's position is geometrically valid and probably wrong
 *   orphaned  — the entity it refers to is gone; applying it would write onto
 *               whatever now holds that express id
 */

import { compareAnchor, type AnchorState } from './referenceIndex';
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

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function reconcileSnapshot(
  snapshot: OverlaySnapshot,
  currentSourceHash: string,
  target: ReconcileTarget,
): ReconcileReport {
  const identical = snapshot.sourceHash === currentSourceHash;
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
        label: 'Alle Änderungen',
        detail: 'Unveränderte Datei',
        expressIds: all,
      });
    }
    return { identical, items, counts: countBy(items) };
  }

  // Authored entities that no anchor can invalidate: they are ours end to end.
  const placementIds = new Set(snapshot.placements.map((p) => p.expressId));
  const selfContained = snapshot.newEntities
    .map((e) => e.expressId)
    .filter((id) => !placementIds.has(id));
  if (selfContained.length > 0) {
    items.push({
      verdict: 'ok',
      label: 'Produkttypen, Anlagen und Verknüpfungen',
      detail: 'Hängen an keinem Bauteil des Architekturmodells',
      expressIds: selfContained,
    });
  }

  // Anchors carry the reference model's state at save time, so a room that was
  // RESHAPED (same GlobalId, new geometry — what an architect actually does)
  // is caught. Without them only disappearance is detectable.
  const anchorByGlobalId = new Map(
    (snapshot.reference?.anchors ?? []).map((a) => [a.globalId, a] as const),
  );
  const anchorState = (globalId: string | null): AnchorState => {
    if (globalId === null) return 'unchanged';
    if (!exists(globalId)) return 'missing';
    const anchor = anchorByGlobalId.get(globalId);
    if (!anchor) return 'unknown';
    return compareAnchor(anchor, {
      exists: true,
      geometryHash: target.geometryHashOfGlobalId?.(globalId) ?? null,
    });
  };

  const placed = {
    ok: [] as number[],
    reshaped: [] as number[],
    suspect: [] as number[],
    orphaned: [] as number[],
  };
  for (const placement of snapshot.placements) {
    if (!exists(placement.storeyGlobalId)) {
      placed.orphaned.push(placement.expressId);
      continue;
    }
    const state = anchorState(placement.containerGlobalId);
    if (state === 'missing') placed.suspect.push(placement.expressId);
    else if (state === 'reshaped') placed.reshaped.push(placement.expressId);
    else placed.ok.push(placement.expressId);
  }

  if (placed.reshaped.length > 0) {
    items.push({
      verdict: 'suspect',
      label: `${plural(placed.reshaped.length, 'Bauteil steht', 'Bauteile stehen')} in einem umgebauten Raum`,
      detail: 'Der Raum existiert noch, wurde aber geändert — Position prüfen',
      expressIds: placed.reshaped,
    });
  }

  if (placed.ok.length > 0) {
    items.push({
      verdict: 'ok',
      label: `${plural(placed.ok.length, 'platziertes Bauteil', 'platzierte Bauteile')}`,
      detail: 'Geschoss und Raum unverändert',
      expressIds: placed.ok,
    });
  }
  if (placed.suspect.length > 0) {
    items.push({
      verdict: 'suspect',
      label: `${plural(placed.suspect.length, 'Bauteil steht', 'Bauteile stehen')} in einem geänderten Bereich`,
      detail: 'Der Raum existiert in dieser Version nicht mehr — Position prüfen',
      expressIds: placed.suspect,
    });
  }
  if (placed.orphaned.length > 0) {
    items.push({
      verdict: 'orphaned',
      label: `${plural(placed.orphaned.length, 'Bauteil ohne Geschoss', 'Bauteile ohne Geschoss')}`,
      detail: 'Das Geschoss existiert in dieser Version nicht mehr',
      expressIds: placed.orphaned,
    });
  }

  const editsOrphaned = snapshot.editedBaseEntities.filter((ref) => !exists(ref.globalId));
  const editsReshaped = snapshot.editedBaseEntities.filter(
    (ref) => anchorState(ref.globalId) === 'reshaped',
  );
  const editsOk = snapshot.editedBaseEntities.length - editsOrphaned.length - editsReshaped.length;
  if (editsOk > 0) {
    items.push({
      verdict: 'ok',
      label: `${plural(editsOk, 'bearbeitetes Bauteil', 'bearbeitete Bauteile')}`,
      detail: 'Bauteil in dieser Version wiedergefunden',
      expressIds: [],
    });
  }
  if (editsReshaped.length > 0) {
    items.push({
      verdict: 'suspect',
      label: `${plural(editsReshaped.length, 'Korrektur betrifft', 'Korrekturen betreffen')} ein geändertes Bauteil`,
      detail: 'Das Bauteil existiert noch, wurde aber überarbeitet',
      expressIds: [],
    });
  }
  if (editsOrphaned.length > 0) {
    items.push({
      verdict: 'orphaned',
      label: `${plural(editsOrphaned.length, 'Attributkorrektur', 'Attributkorrekturen')} ohne Bezugsbauteil`,
      detail: 'Das bearbeitete Bauteil existiert in dieser Version nicht mehr',
      expressIds: [],
    });
  }

  const deletionsOrphaned = snapshot.deleted.filter((ref) => !exists(ref.globalId));
  if (deletionsOrphaned.length > 0) {
    items.push({
      verdict: 'orphaned',
      label: `${plural(deletionsOrphaned.length, 'Löschung', 'Löschungen')} ohne Bezugsbauteil`,
      detail: 'Bereits in dieser Version nicht mehr vorhanden',
      expressIds: [],
    });
  }

  return { identical, items, counts: countBy(items) };
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
