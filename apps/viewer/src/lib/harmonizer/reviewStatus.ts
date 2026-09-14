/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The review side of the DataHarmonizer loop.
 *
 * A draft written by the harmonizer carries `Pset_DataHarmonizer` on every
 * element it proposed: a confidence, the reasons, and a `Status` that starts
 * as `auto`. Reviewing means moving that status — `confirmed` (it is right),
 * `corrected` (it was changed here), `rejected` (it is wrong and must not
 * come back). The status lives in the file, so the next harmonizer run reads
 * it back and keeps what was confirmed, drops what was rejected, and replaces
 * only what is still `auto`.
 *
 * Rejected elements stay in the file with their status: the tombstone IS the
 * element. Deleting it instead would leave the next run with no way to know
 * it had been refused, and it would propose it again.
 *
 * Nothing here touches the store: the panel hands in the data store and the
 * mutation view, and this module answers with plain data or one mutation.
 */

import { PropertyValueType, type PropertySet } from '@ifc-lite/data';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';

export const HARMONIZER_PSET = 'Pset_DataHarmonizer';

export type ReviewStatus = 'auto' | 'confirmed' | 'corrected' | 'rejected';
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['auto', 'confirmed', 'corrected', 'rejected'];

export type ConfidenceBand = 'high' | 'review' | 'low';

/** The same bands the harmonizer uses: ≥ 0.8 trusted, 0.5–0.8 to look at, below doubtful. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'review';
  return 'low';
}

export interface HarmonizerElement {
  expressId: number;
  globalId: string;
  typeName: string;
  name: string;
  confidence: number;
  band: ConfidenceBand;
  status: ReviewStatus;
  reasons: string;
  sourceLayer: string | null;
  /** The element was edited in this session (attributes) — a hint that `corrected` is the honest status. */
  editedHere: boolean;
}

/** Unknown spellings count as `auto`: nothing gets confirmed by accident. */
export function parseStatus(value: unknown): ReviewStatus {
  const v = String(value ?? '').trim().toLowerCase();
  return (REVIEW_STATUSES as readonly string[]).includes(v) ? (v as ReviewStatus) : 'auto';
}

function propertyOf(pset: PropertySet, name: string): unknown {
  return pset.properties.find((p) => p.name === name)?.value ?? null;
}

/** The view merged with the file, so a status set a minute ago reads back at once. */
interface ReadableView {
  getForEntity(entityId: number): PropertySet[];
  getAttributeMutationsForEntity?(entityId: number): Array<{ name: string; value: string }>;
}

/**
 * Every element of a model that carries the harmonizer's pset, in file order.
 *
 * Walks the type index rather than the property sets: the draft writes a
 * handful of product classes, and asking the view per candidate is cheaper
 * than resolving every IfcRelDefinesByProperties in a large federated model.
 */
export function listHarmonizerElements(dataStore: IfcDataStore, view: ReadableView): HarmonizerElement[] {
  const out: HarmonizerElement[] = [];
  const byType = dataStore.entityIndex?.byType;
  if (!byType) return out;
  for (const [typeName, ids] of byType) {
    const upper = typeName.toUpperCase();
    if (!PRODUCT_TYPES.has(upper)) continue;
    for (const expressId of ids) {
      const pset = view.getForEntity(expressId).find((p) => p.name === HARMONIZER_PSET);
      if (!pset) continue;
      const confidence = Number(propertyOf(pset, 'Confidence') ?? 0);
      out.push({
        expressId,
        globalId: dataStore.entities?.getGlobalId?.(expressId) ?? '',
        typeName: pascalIfc(upper),
        name: dataStore.entities?.getName?.(expressId) ?? '',
        confidence: Number.isFinite(confidence) ? confidence : 0,
        band: confidenceBand(Number.isFinite(confidence) ? confidence : 0),
        status: parseStatus(propertyOf(pset, 'Status')),
        reasons: String(propertyOf(pset, 'ConfidenceReasons') ?? ''),
        sourceLayer: (propertyOf(pset, 'SourceLayer') as string | null) ?? null,
        editedHere: (view.getAttributeMutationsForEntity?.(expressId)?.length ?? 0) > 0,
      });
    }
  }
  out.sort((a, b) => a.expressId - b.expressId);
  return out;
}

/** The product classes the harmonizer's draft writer emits (Spec §6.5). */
const PRODUCT_TYPES = new Set([
  'IFCSPACE',
  'IFCDOOR',
  'IFCWINDOW',
  'IFCWALL',
  'IFCWALLSTANDARDCASE',
  'IFCCOLUMN',
  'IFCSENSOR',
  'IFCALARM',
  'IFCSANITARYTERMINAL',
  'IFCFURNITURE',
  'IFCBUILDINGELEMENTPROXY',
]);

const PASCAL: Record<string, string> = {
  IFCSPACE: 'IfcSpace',
  IFCDOOR: 'IfcDoor',
  IFCWINDOW: 'IfcWindow',
  IFCWALL: 'IfcWall',
  IFCWALLSTANDARDCASE: 'IfcWallStandardCase',
  IFCCOLUMN: 'IfcColumn',
  IFCSENSOR: 'IfcSensor',
  IFCALARM: 'IfcAlarm',
  IFCSANITARYTERMINAL: 'IfcSanitaryTerminal',
  IFCFURNITURE: 'IfcFurniture',
  IFCBUILDINGELEMENTPROXY: 'IfcBuildingElementProxy',
};

function pascalIfc(upper: string): string {
  return PASCAL[upper] ?? upper;
}

/** One status change, recorded as a property mutation on the pset the draft wrote. */
export function setReviewStatus(view: MutablePropertyView, expressId: number, status: ReviewStatus): void {
  view.setProperty(expressId, HARMONIZER_PSET, 'Status', status, PropertyValueType.Label);
}

export interface ReviewSummary {
  total: number;
  byStatus: Record<ReviewStatus, number>;
  byBand: Record<ConfidenceBand, number>;
  /** Still `auto` and trusted: what a block confirmation would take. */
  confirmable: number;
}

export function summarizeReview(elements: readonly HarmonizerElement[]): ReviewSummary {
  const byStatus: Record<ReviewStatus, number> = { auto: 0, confirmed: 0, corrected: 0, rejected: 0 };
  const byBand: Record<ConfidenceBand, number> = { high: 0, review: 0, low: 0 };
  let confirmable = 0;
  for (const e of elements) {
    byStatus[e.status] += 1;
    byBand[e.band] += 1;
    if (e.status === 'auto' && e.band === 'high') confirmable += 1;
  }
  return { total: elements.length, byStatus, byBand, confirmable };
}
