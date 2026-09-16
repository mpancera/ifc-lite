/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Everything the fire proposal would WRITE, decided before anything is written.
 *
 * A plan rather than a sequence of calls, for the same reason `planCircuits`
 * is one: the panel can say "9 Brandabschnitte, 9 Meldergruppen, 92 Räume"
 * before the first entity exists, the whole derivation is testable without an
 * editor, and a refusal costs nothing.
 *
 * ## Two zones per compartment, on purpose
 *
 * The Brandabschnitt and the Meldergruppe are different statements and the
 * model keeps them apart:
 *
 *   - The compartment is an `IfcZone` of the `fire-compartment` theme, which
 *     the existing "Körper ableiten" tool turns into the `IfcSpatialZone`
 *     FIRESAFETY / FIRECOMPARTMENT that the Swiss exchange requirement checks
 *     for.
 *   - The alarm group is an `IfcZone` of the `fire-trigger` theme, named with
 *     its FKS number and carrying its colour, which `buildDetectorCircuits`
 *     already knows how to turn into a group of detectors.
 *
 * Today they hold the same rooms, because Marc's rule is that a group follows
 * a compartment. Keeping them as two zones is what lets that stop being true
 * later — several alarm zones inside one compartment, or one spanning two —
 * without the compartment layer having to change at all.
 */

import { proposeCompartments, type ProposalRoom, type CompartmentProposal } from './compartmentProposal';
import { isEscapeRoute, roomUseFromName } from './roomUse';
import {
  numberAlarmZones, type AlarmZoneLabel, type GroupToNumber,
} from './alarmZoneNaming';

/** A room, plus the storey it is on. */
export interface PlanRoom extends ProposalRoom {
  storeyExpressId: number;
  storeyName: string;
}

/** One `IfcZone` to create, with the rooms to paint into it. */
export interface ZoneToCreate {
  name: string;
  /** `IfcZone` has no PredefinedType; the theme lives here. */
  objectType: string;
  /** `#rrggbb`, or `null` for the compartment layer, which is not coloured. */
  colour: string | null;
  description: string;
  roomIds: number[];
}

export interface FirePlan {
  compartmentZones: ZoneToCreate[];
  alarmZones: ZoneToCreate[];
  /** `Pset_SpaceCommon.FireExit`, stated for every room either way. */
  fireExit: Array<{ roomId: number; value: boolean }>;
  /** Compartments the numbering could not express — reported, not renamed. */
  unnumbered: string[];
  /** Per storey, for the summary a person reads before accepting. */
  perStorey: Array<{ storeyName: string; proposal: CompartmentProposal }>;
}

/** `themes.ts`'s `fire-compartment`, spelled out so this module reads alone. */
const COMPARTMENT_OBJECT_TYPE = 'FireCompartment';
/** …and `fire-trigger`, which `buildDetectorCircuits` filters on. */
const TRIGGER_OBJECT_TYPE = 'TriggerZoneFire';

/**
 * Plan the whole building.
 *
 * Storeys come out in the order they are given, and the detector numbering
 * runs per storey, so the caller decides what "first floor" means by how it
 * sorts — this does not sort behind its back.
 *
 * `FireExit` is stated for EVERY room, true or false, not only for the escape
 * routes. A room with no property and a room with `FireExit = FALSE` are
 * different things to a checker: the first says nobody looked, the second says
 * somebody did and the answer was no. In a fire-safety deliverable that
 * difference is the deliverable (Marc, 2026-09-16).
 */
export function planFireZones(
  storeys: ReadonlyArray<{ storeyName: string; rooms: readonly PlanRoom[] }>,
): FirePlan {
  const perStorey = storeys.map(({ storeyName, rooms }) => ({
    storeyName,
    proposal: proposeCompartments(storeyName, rooms),
  }));

  // Numbered in one pass across the building — see `numberAlarmZones` for why
  // three counters in three places is how two groups end up called `H03`.
  const toNumber: GroupToNumber[] = [];
  for (const { storeyName, proposal } of perStorey) {
    for (const c of proposal.compartments) {
      toNumber.push({ key: c.key, kind: 'detector', storeyName });
    }
  }
  const labels = new Map<string, AlarmZoneLabel | null>(
    numberAlarmZones(toNumber).map((n) => [n.key, n.label]),
  );

  const compartmentZones: ZoneToCreate[] = [];
  const alarmZones: ZoneToCreate[] = [];
  const fireExit: Array<{ roomId: number; value: boolean }> = [];
  const unnumbered: string[] = [];

  for (const { rooms } of storeys) {
    for (const room of rooms) {
      fireExit.push({
        roomId: room.expressId,
        value: isEscapeRoute(roomUseFromName(room.name, room.longName)),
      });
    }
  }

  for (const { proposal } of perStorey) {
    for (const c of proposal.compartments) {
      const roomIds = c.rooms.map((r) => r.expressId);
      compartmentZones.push({
        name: c.name,
        objectType: COMPARTMENT_OBJECT_TYPE,
        colour: null,
        description: c.fireExit ? 'Fluchtweg' : '',
        roomIds,
      });

      const label = labels.get(c.key) ?? null;
      if (!label) {
        unnumbered.push(c.name);
        continue;
      }
      alarmZones.push({
        // The NUMBER is the name. It is what stands in the circle on the
        // orientation plan and what `buildDetectorCircuits` calls the group,
        // so anything more helpful here would end up on the sheet.
        name: label.number,
        objectType: TRIGGER_OBJECT_TYPE,
        colour: label.colour,
        description: c.name,
        roomIds,
      });
    }
  }

  return { compartmentZones, alarmZones, fireExit, unnumbered, perStorey };
}

/** What the plan would do, in lines somebody reads before saying yes. */
export function describeFirePlan(plan: FirePlan): string[] {
  const lines = plan.perStorey.map(({ storeyName, proposal }) => (
    `${storeyName}: ${proposal.compartments.length} Abschnitte, `
    + `${proposal.compartments.reduce((n, c) => n + c.rooms.length, 0)} Räume`
  ));
  lines.push(`${plan.alarmZones.length} Meldergruppen: `
    + `${plan.alarmZones.map((z) => z.name).join(', ')}`);
  if (plan.unnumbered.length > 0) {
    lines.push(`Ohne Nummer (Geschoss nicht einzuordnen): ${plan.unnumbered.join(', ')}`);
  }
  return lines;
}
