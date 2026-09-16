/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a Meldergruppe is called and what colour it is.
 *
 * The numbers are read off a plan by a fire officer standing in front of a
 * building at night: the number in the circle says which group has alarmed,
 * and the colour says which rooms that is. So the scheme is not an internal
 * key — it is the label, and it has to survive being printed small.
 *
 * ## The numbering
 *
 * FKS's own sample plans are not quite consistent about this, so the rule here
 * is Marc's precision of it (2026-09-16):
 *
 *   - Brandmelder: the storey in the first position, a sequence in the second.
 *     Basement `U1…U9`, ground floor `01…09`, first floor `11…19`, second
 *     `21…29`, and so on.
 *   - Handfeuermelder: `H01, H02, …`, counted across the whole building. A
 *     manual call point is pressed by somebody leaving; which floor it was on
 *     is what the plan shows, not what the number has to carry.
 *   - Sprinkler: the seventies, `71, 72, …`.
 *
 * The first scheme runs out at nine groups on a floor. That is not a limit
 * anyone should hit — a storey has three or four compartments — but it is a
 * real edge, and this reports it rather than rolling over into `010`, which
 * reads as a different floor.
 *
 * ## The colours
 *
 * Red belongs to the Handfeuermelder and cyan to the sprinklers, on every FKS
 * plan. So the detector palette avoids both: a detector group in red is a
 * group somebody reads as a call point.
 *
 * Detector colours repeat from floor to floor, which Marc allows explicitly —
 * group `01` and group `11` share a colour because they are never on the same
 * sheet. Nine distinguishable colours is already at the edge of what prints;
 * nine more that had to differ from these too would not be colours, they would
 * be shades.
 *
 * The colour goes ON THE ZONE, not into a legend the viewer keeps to itself.
 * A zone that carries its own colour can be drawn by the plan, listed by the
 * table and coloured in the graph without any of the three agreeing on a
 * palette first.
 */

/** Which installation a group belongs to. Each numbers and colours its own. */
export type AlarmZoneKind = 'detector' | 'callpoint' | 'sprinkler';

/** Where a storey sits, as the numbering needs it. */
export type FloorKind =
  | { kind: 'basement' }
  | { kind: 'ground' }
  | { kind: 'upper'; level: number }
  /** Nothing in the name or the elevations said. Numbered, but flagged. */
  | { kind: 'unknown' };

/**
 * Read a storey's position from its name.
 *
 * The name, not the elevation, and that is deliberate: the Langmatt's
 * basement sits at ±0.00 and its ground floor at +4.42, because the file's
 * datum is the lowest slab. Elevations answer "how high"; only the name
 * answers "which floor is the ground floor", which is the question here.
 *
 * Recognised: `U1`, `UG`, `UG2`, `KG` for basements; `00`, `EG` for the ground
 * floor; `01`…`19`, `1.OG`, `2.OG` for the floors above.
 */
export function floorKindFromName(name: string): FloorKind {
  const text = name.trim().toLowerCase();

  if (/^(u|ug|kg|ug\d+|u\d+|k\d+)$/.test(text)) return { kind: 'basement' };
  if (/^(00|eg|e|e0|erdgeschoss)$/.test(text)) return { kind: 'ground' };

  const dotted = /^(\d{1,2})\s*\.\s*(og|obergeschoss)$/.exec(text);
  if (dotted) return { kind: 'upper', level: Number(dotted[1]) };

  const plain = /^0?(\d{1,2})$/.exec(text);
  if (plain) {
    const level = Number(plain[1]);
    return level === 0 ? { kind: 'ground' } : { kind: 'upper', level };
  }

  return { kind: 'unknown' };
}

/** The first position of a detector group's number, per the scheme above. */
export function detectorPrefix(floor: FloorKind): string | null {
  switch (floor.kind) {
    case 'basement': return 'U';
    case 'ground': return '0';
    case 'upper': return floor.level <= 9 ? String(floor.level) : null;
    default: return null;
  }
}

/**
 * Nine colours for the detector groups, avoiding red and cyan.
 *
 * Chosen to stay apart in print and for the two most common kinds of colour
 * blindness — no red/green pair carrying a distinction on its own, and every
 * neighbour in the list differing in lightness as well as in hue.
 */
export const DETECTOR_GROUP_COLOURS: readonly string[] = [
  '#8e44ad', // violet
  '#e8a33d', // amber
  '#7f8c1b', // olive
  '#f1c40f', // yellow
  '#e67e22', // orange
  '#d98cb3', // pink
  '#2e86de', // blue
  '#27ae60', // green
  '#8d6e63', // brown
];

/** Handfeuermelder, on every FKS plan. */
export const CALL_POINT_COLOUR = '#e30613';

/** Sprinkler groups and sprinkler zones, likewise. */
export const SPRINKLER_COLOUR = '#00b8d4';

/** Where the sprinkler numbers start — Marc's choice of the seventies. */
const SPRINKLER_BASE = 70;

/** How many detector groups one storey's numbering can carry. */
export const MAX_DETECTOR_GROUPS_PER_FLOOR = 9;

export interface AlarmZoneLabel {
  /** What goes in the circle on the plan, and what names the `IfcZone`. */
  number: string;
  /** `#rrggbb`, carried on the zone itself. */
  colour: string;
  kind: AlarmZoneKind;
}

/**
 * Name and colour a detector group.
 *
 * `sequence` counts from 1 within the storey. `null` when the scheme cannot
 * express it — a tenth group on one floor, or a storey whose name says
 * nothing. A number that does not follow the scheme is worse than an absent
 * one: on the plan it reads as a group on a different floor.
 */
export function detectorZoneLabel(floor: FloorKind, sequence: number): AlarmZoneLabel | null {
  const prefix = detectorPrefix(floor);
  if (prefix === null) return null;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_DETECTOR_GROUPS_PER_FLOOR) {
    return null;
  }
  return {
    number: `${prefix}${sequence}`,
    colour: DETECTOR_GROUP_COLOURS[(sequence - 1) % DETECTOR_GROUP_COLOURS.length],
    kind: 'detector',
  };
}

/** `H01`, `H02`, … counted across the building. */
export function callPointZoneLabel(sequence: number): AlarmZoneLabel | null {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99) return null;
  return {
    number: `H${String(sequence).padStart(2, '0')}`,
    colour: CALL_POINT_COLOUR,
    kind: 'callpoint',
  };
}

/** `71`, `72`, … — the seventies, likewise across the building. */
export function sprinklerZoneLabel(sequence: number): AlarmZoneLabel | null {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9) return null;
  return {
    number: String(SPRINKLER_BASE + sequence),
    colour: SPRINKLER_COLOUR,
    kind: 'sprinkler',
  };
}

/**
 * Number a whole building's groups in one pass.
 *
 * One call rather than a counter each caller keeps: three sequences run at
 * once — per storey for detectors, building-wide for the other two — and three
 * counters in three places is how two groups end up called `H03`.
 *
 * Groups that the scheme cannot express come back with `label: null` and are
 * the caller's to report. They are not silently renumbered into something that
 * fits, because something that fits is something that means a different floor.
 */
export interface GroupToNumber {
  /** Whatever identifies the group to the caller. Passed through untouched. */
  key: string;
  kind: AlarmZoneKind;
  /** The storey it is on — only detectors use it. */
  storeyName: string;
}

export function numberAlarmZones(
  groups: readonly GroupToNumber[],
): Array<{ key: string; label: AlarmZoneLabel | null }> {
  const perStorey = new Map<string, number>();
  let callPoints = 0;
  let sprinklers = 0;

  return groups.map((group) => {
    if (group.kind === 'callpoint') {
      callPoints += 1;
      return { key: group.key, label: callPointZoneLabel(callPoints) };
    }
    if (group.kind === 'sprinkler') {
      sprinklers += 1;
      return { key: group.key, label: sprinklerZoneLabel(sprinklers) };
    }
    const next = (perStorey.get(group.storeyName) ?? 0) + 1;
    perStorey.set(group.storeyName, next);
    return {
      key: group.key,
      label: detectorZoneLabel(floorKindFromName(group.storeyName), next),
    };
  });
}
