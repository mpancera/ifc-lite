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
import { escapeRouteTypeOf, isEscapeRoute, roomUseFromName } from './roomUse';
import {
  COMPARTMENT_PSET, ESCAPE_ROUTE_COLOURS, type EscapeRouteType,
} from './compartmentRequirements';
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
  /**
   * `CHIBB_FireCompartmentRequirements.EscapeRouteType`, written on the zone
   * as well as on its rooms. The zone is where a fire-safety engineer reads
   * and edits a requirement; the rooms are where a checker walking the spatial
   * structure finds it.
   */
  escapeType?: EscapeRouteType;
  roomIds: number[];
}

export interface FirePlan {
  compartmentZones: ZoneToCreate[];
  alarmZones: ZoneToCreate[];
  /**
   * What each room is, as the IG BIM&BS enumeration, and the same answer as
   * the standard boolean beside it.
   *
   * Both, because they serve different readers: `EscapeRouteType` is the
   * statement — it distinguishes the stair from the corridors, which is the
   * half `FireExit` cannot carry — and `FireExit` is its projection for
   * anything reading plain IFC. The enum is authoritative; the boolean is
   * derived from it here and nowhere else, so the two cannot be written
   * disagreeing. They CAN be edited into disagreement afterwards, which is the
   * price of stating a thing twice and worth knowing about.
   */
  escapeRoute: Array<{ roomId: number; type: EscapeRouteType; fireExit: boolean }>;
  /** Compartments the numbering could not express — reported, not renamed. */
  unnumbered: string[];
  /** Per storey, for the summary a person reads before accepting. */
  perStorey: Array<{ storeyName: string; proposal: CompartmentProposal }>;
}

/**
 * Where `FireExit` actually lives.
 *
 * NOT `Pset_SpaceCommon`, which was the first guess and does not have the
 * property at all — its members are Category, IsExternal, floor and ceiling
 * coverings and the like. `Pset_SpaceFireSafetyRequirements` is the IFC4 set
 * that does, applicable to `IfcSpace`, `IfcSpatialZone` AND `IfcZone`, and it
 * carries `SprinklerProtection` beside it, which is where the sprinklered
 * rooms belong too. Caught by the preset suite's schema check rather than by
 * anybody reading the export (2026-09-16).
 */
export const SPACE_FIRE_PSET = 'Pset_SpaceFireSafetyRequirements';

/** Re-exported so a caller writing the plan needs one import, not two. */
export { COMPARTMENT_PSET };

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
  const escapeRoute: FirePlan['escapeRoute'] = [];
  const unnumbered: string[] = [];

  for (const { rooms } of storeys) {
    for (const room of rooms) {
      const use = roomUseFromName(room.name, room.longName);
      escapeRoute.push({
        roomId: room.expressId,
        type: escapeRouteTypeOf(use),
        fireExit: isEscapeRoute(use),
      });
    }
  }

  for (const { proposal } of perStorey) {
    for (const c of proposal.compartments) {
      const roomIds = c.rooms.map((r) => r.expressId);
      // The compartment's own escape type follows the rooms it was built from:
      // the stair compartment holds the stair, the corridor compartment the
      // corridors, and everything else is neither by construction.
      const escapeType: EscapeRouteType = c.use === 'escape-stair'
        ? 'VerticalEscape'
        : c.use === 'escape-corridor' ? 'HorizontalEscape' : 'None';
      compartmentZones.push({
        name: c.name,
        objectType: COMPARTMENT_OBJECT_TYPE,
        // Dark green for the stair, light green for the corridors, nothing for
        // the rest — the FKS orientation plan's own legend. A compartment that
        // is not an escape route is not painted, because the greens MEAN
        // escape route.
        colour: ESCAPE_ROUTE_COLOURS[escapeType],
        description: c.name,
        escapeType,
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

  return { compartmentZones, alarmZones, escapeRoute, unnumbered, perStorey };
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
