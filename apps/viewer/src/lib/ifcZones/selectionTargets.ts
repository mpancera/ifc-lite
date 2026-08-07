/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which of the selected entities may actually join a zone.
 *
 * IFC restricts `IfcZone` membership to spaces, spatial zones and other zones —
 * a detector cannot be a direct member, and does not need to be: "the detectors
 * in this zone" follows from the rooms the zone groups and the containment the
 * detectors already have.
 *
 * So a selection of forty elements is usually mostly ineligible, and the panel
 * has to say so rather than silently assigning the four that qualify. This
 * splits the selection and counts what was left out, by type, so the message
 * can name it.
 *
 * Pure: refs and a type lookup in, ids and a tally out. Shared by the brush
 * (one entity) and the assign-selection buttons (many), so the two can never
 * disagree about what counts as a room.
 */

/** Types IFC allows as members of an `IfcZone`. */
export const ZONE_MEMBER_TYPES: ReadonlySet<string> = new Set([
  'IfcSpace',
  'IfcSpatialZone',
  'IfcZone',
]);

export interface EntityRefLike {
  modelId: string;
  expressId: number;
}

export interface ZoneTargets {
  /** Express ids that may join the zone, in selection order, deduplicated. */
  eligible: number[];
  /** How many were refused, by IFC type — `'?'` when the type is unknown. */
  refusedByType: Map<string, number>;
  /** Refused because they belong to a different model than the zone. */
  otherModel: number;
}

/**
 * Split a selection into what can join `modelId`'s zone and what cannot.
 *
 * `typeOf` returning `null` (an entity the store cannot name) counts as
 * refused: assigning something whose class is unknown is how a wall ends up in
 * a fire zone.
 */
export function eligibleZoneMembers(
  refs: Iterable<EntityRefLike>,
  modelId: string,
  typeOf: (modelId: string, expressId: number) => string | null,
): ZoneTargets {
  const eligible: number[] = [];
  const seen = new Set<number>();
  const refusedByType = new Map<string, number>();
  let otherModel = 0;

  for (const ref of refs) {
    if (ref.modelId !== modelId) {
      otherModel += 1;
      continue;
    }
    if (seen.has(ref.expressId)) continue;

    const type = typeOf(ref.modelId, ref.expressId);
    if (type !== null && ZONE_MEMBER_TYPES.has(type)) {
      seen.add(ref.expressId);
      eligible.push(ref.expressId);
      continue;
    }
    const key = type ?? '?';
    refusedByType.set(key, (refusedByType.get(key) ?? 0) + 1);
  }

  return { eligible, refusedByType, otherModel };
}

/**
 * One sentence about what a stroke did and what it skipped, or `null` when
 * there is nothing worth saying.
 *
 * Kept next to the split so the wording and the counting stay in step. German,
 * like the rest of the authoring surface.
 */
export function describeZoneTargets(
  targets: ZoneTargets,
  applied: { added: number; removed: number } | null,
): string | null {
  const parts: string[] = [];

  if (applied && applied.added > 0) parts.push(`${applied.added} zugewiesen`);
  if (applied && applied.removed > 0) parts.push(`${applied.removed} entfernt`);
  if (applied && applied.added === 0 && applied.removed === 0) {
    parts.push('nichts geändert');
  }

  if (targets.otherModel > 0) {
    parts.push(`${targets.otherModel} aus einem anderen Modell übersprungen`);
  }

  const refused = [...targets.refusedByType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${count}× ${type === '?' ? 'unbekannter Typ' : type}`);
  if (refused.length > 0) {
    parts.push(`nicht zonenfähig: ${refused.join(', ')}`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
