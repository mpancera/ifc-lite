/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Meldergruppen — one circuit of detectors per Auslösezone.
 *
 * The fire panel's topology is `BMZ → Meldelinie → Meldergruppe → Melder`, and
 * two of those levels are already in the model, holding different things:
 *
 * - the **Auslösezone** is an `IfcZone` over ROOMS — painted by hand, because
 *   which rooms belong together is a judgement nothing can derive;
 * - the **Meldergruppe** is an `IfcDistributionCircuit` over DETECTORS —
 *   derived, because a detector's group follows from the room it stands in.
 *
 * IFC's own word for the second one is a circuit: a partition of a
 * distribution system. It stays an `IfcGroup` subtype, so membership is the
 * same `IfcRelAssignsToGroup` everything else uses, and aggregating it under
 * the fire-detection `IfcDistributionSystem` is what makes it a partition *of
 * that installation* rather than a loose group with a suggestive name.
 *
 * # A group may span storeys, on purpose
 * The stairwell is one escape route and has to be reported as one — two lamps
 * on the panel for one shaft is a fault, not a detail. Nothing here is scoped
 * to a storey.
 *
 * # One relationship per circuit, rewritten in place
 * The rule `ifcZones/membership.ts` sets out, for the same reason: a detector
 * leaving a group has to be as cheap as one joining, and a fresh relationship
 * per assignment makes removal a search.
 *
 * Pure — no store, no React.
 */

/** An overlay entity as `MutablePropertyView.getNewEntities()` returns it. */
export interface OverlayEntity {
  expressId: number;
  type: string;
  attributes: readonly unknown[];
}

/** The entity a Meldergruppe is. */
export const CIRCUIT_ENTITY = 'IfcDistributionCircuit';
/** `ObjectType`, so a reader can tell these from any other circuit. */
export const CIRCUIT_OBJECT_TYPE = 'Meldergruppe';
/** Between the group's name and the detector's counter: `MZ01.03`. */
export const MARK_SEPARATOR = '.';

export interface CircuitInfo {
  expressId: number;
  /** `Name` — the zone's name, so the two read as one thing. */
  name: string;
  /** The `IfcRelAssignsToGroup` carrying membership, or `null` when none yet. */
  relExpressId: number | null;
  /** Express ids of the member detectors, in the order the relationship lists. */
  memberIds: number[];
}

/** `#123` → `123`; anything else → `null`. */
function refId(value: unknown): number | null {
  if (typeof value !== 'string' || !value.startsWith('#')) return null;
  const id = Number(value.slice(1));
  return Number.isFinite(id) ? id : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Every Meldergruppe this session authored, with its members.
 *
 * Circuits already in the loaded file are deliberately NOT returned: writing
 * into a grouping somebody else owns would edit the reference model without
 * saying so — the line `findDistributionSystem` and `readZones` both draw.
 */
export function readCircuits(entities: Iterable<OverlayEntity>): CircuitInfo[] {
  const circuits = new Map<number, CircuitInfo>();
  const rels: OverlayEntity[] = [];

  for (const entity of entities) {
    if (entity.type === CIRCUIT_ENTITY) {
      circuits.set(entity.expressId, {
        expressId: entity.expressId,
        name: asString(entity.attributes[2]),
        relExpressId: null,
        memberIds: [],
      });
    } else if (entity.type === 'IfcRelAssignsToGroup') {
      rels.push(entity);
    }
  }

  for (const rel of rels) {
    // (GlobalId, OwnerHistory, Name, Description, RelatedObjects, …, RelatingGroup)
    const groupId = refId(rel.attributes[6]);
    if (groupId === null) continue;
    const circuit = circuits.get(groupId);
    if (!circuit) continue;
    const members = Array.isArray(rel.attributes[4])
      ? (rel.attributes[4] as unknown[]).map(refId).filter((id): id is number => id !== null)
      : [];
    // Several relationships for one circuit: keep the FIRST as the writable
    // one and merge the rest, so a file that arrived that way still reads
    // right and the next write consolidates it.
    if (circuit.relExpressId === null) circuit.relExpressId = rel.expressId;
    for (const id of members) {
      if (!circuit.memberIds.includes(id)) circuit.memberIds.push(id);
    }
  }

  return [...circuits.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A detector's mark within its group: `MZ01.03`. */
export function detectorMark(groupName: string, index: number): string {
  return `${groupName}${MARK_SEPARATOR}${String(index).padStart(2, '0')}`;
}

/** The counter out of a mark, when it belongs to that group. Else `null`. */
export function parseMarkIndex(mark: string, groupName: string): number | null {
  const trimmed = mark.trim();
  const prefix = `${groupName}${MARK_SEPARATOR}`;
  if (!trimmed.startsWith(prefix)) return null;
  const index = Number(trimmed.slice(prefix.length));
  return Number.isInteger(index) && index > 0 ? index : null;
}

/**
 * The next `count` marks for a group, continuing past everything already used.
 *
 * Continues rather than filling gaps: a mark that has been on a plan, in a
 * schedule and on a sticker is a name, and handing it to a different detector
 * because one was deleted is how a panel ends up pointing at the wrong room.
 */
export function nextMarks(
  groupName: string,
  usedMarks: Iterable<string>,
  count: number,
): string[] {
  let highest = 0;
  for (const mark of usedMarks) {
    const index = parseMarkIndex(mark, groupName);
    if (index !== null && index > highest) highest = index;
  }
  return Array.from({ length: count }, (_, i) => detectorMark(groupName, highest + i + 1));
}

/** One Auslösezone, as this module needs it. */
export interface ZoneForCircuit {
  readonly expressId: number;
  readonly name: string;
  /** The rooms painted into it. */
  readonly memberIds: readonly number[];
}

export interface CircuitPlanEntry {
  /** The zone the group comes from. */
  readonly zoneId: number;
  /** What the group is called — the zone's name. */
  readonly name: string;
  /** The existing circuit, or `null` when it still has to be created. */
  readonly circuitId: number | null;
  /** Detectors that will be in the group, in a stable order. */
  readonly deviceIds: readonly number[];
  /** Of those, the ones not in it yet — the only ones that get a new mark. */
  readonly joining: readonly number[];
  /** Members that are no longer in any of the zone's rooms. */
  readonly leaving: readonly number[];
}

export interface CircuitPlan {
  readonly entries: readonly CircuitPlanEntry[];
  /** Zones with no detector in them at all — worth saying, not worth failing. */
  readonly emptyZones: readonly string[];
  /** Detectors in no Auslösezone. The number that matters before handover. */
  readonly ungrouped: number;
}

export interface PlanCircuitsInput {
  readonly zones: readonly ZoneForCircuit[];
  /** Detectors of the installation, each with the room it stands in. */
  readonly devices: ReadonlyArray<{ readonly id: number; readonly roomId: number | null }>;
  /** Circuits that already exist, by name. */
  readonly circuits: readonly CircuitInfo[];
}

/**
 * What building the groups would do, decided before anything is written.
 *
 * Returned rather than executed so the panel can say "4 Gruppen, 19 Melder"
 * first — and so the whole derivation is testable without an editor.
 */
export function planCircuits({ zones, devices, circuits }: PlanCircuitsInput): CircuitPlan {
  const byName = new Map(circuits.map((c) => [c.name, c]));
  const grouped = new Set<number>();
  const entries: CircuitPlanEntry[] = [];
  const emptyZones: string[] = [];

  for (const zone of zones) {
    const rooms = new Set(zone.memberIds);
    const deviceIds = devices
      .filter((d) => d.roomId !== null && rooms.has(d.roomId))
      .map((d) => d.id);
    for (const id of deviceIds) grouped.add(id);

    if (deviceIds.length === 0) {
      emptyZones.push(zone.name);
      // Still planned: an existing group whose rooms lost their detectors has
      // members to shed, and skipping it would leave them claiming a group
      // they are not in.
    }

    const existing = byName.get(zone.name) ?? null;
    const members = existing?.memberIds ?? [];
    entries.push({
      zoneId: zone.expressId,
      name: zone.name,
      circuitId: existing?.expressId ?? null,
      deviceIds,
      joining: deviceIds.filter((id) => !members.includes(id)),
      leaving: members.filter((id) => !deviceIds.includes(id)),
    });
  }

  return {
    entries,
    emptyZones,
    ungrouped: devices.filter((d) => !grouped.has(d.id)).length,
  };
}
