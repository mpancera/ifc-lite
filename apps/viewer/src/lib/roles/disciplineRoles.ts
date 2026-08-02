/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Discipline roles — "which installation am I authoring right now".
 *
 * A trade planner does not place loose devices; they build a *system* (a fire-
 * detection system, an access-control system). Picking a role makes that
 * explicit: every element placed while it is active is assigned to the matching
 * `IfcDistributionSystem`, so the model carries the grouping a downstream
 * consumer needs instead of leaving it to be re-derived from element classes.
 *
 * Roles are data, not code paths. Adding one — a new trade, or another system
 * inside an existing trade — means adding an entry to `DISCIPLINE_ROLES`;
 * nothing else needs to change.
 *
 * `predefinedType` must be a standard `IfcDistributionSystemEnum` value. Where
 * one enum value covers several distinct installations (all four fire systems
 * are `FIREPROTECTION`), `objectType` carries the refinement — the attribute
 * IFC provides for exactly that, rather than inventing a non-standard enum.
 */

/** A single installation a role can author into. */
export interface DisciplineSystem {
  /** Stable id used in persisted state; never shown to the user. */
  id: string;
  /** Display name. */
  label: string;
  /** `IfcDistributionSystemEnum` value, without the STEP dots. */
  predefinedType: string;
  /** Refinement within `predefinedType`, written to the system's ObjectType. */
  objectType: string;
}

export interface DisciplineRole {
  id: string;
  label: string;
  systems: DisciplineSystem[];
}

/**
 * The "no role" default: authoring behaves exactly as it does without this
 * feature — elements are placed and contained, and nothing is grouped.
 */
export const STANDARD_ROLE_ID = 'standard';

export const DISCIPLINE_ROLES: readonly DisciplineRole[] = [
  {
    id: 'fire',
    label: 'Fire',
    systems: [
      { id: 'fire.detection', label: 'Branddetektion', predefinedType: 'FIREPROTECTION', objectType: 'FireDetection' },
      { id: 'fire.gas', label: 'Gasdetektion', predefinedType: 'FIREPROTECTION', objectType: 'GasDetection' },
      { id: 'fire.evacuation', label: 'Evakuation', predefinedType: 'FIREPROTECTION', objectType: 'Evacuation' },
      { id: 'fire.suppression', label: 'Löschung', predefinedType: 'FIREPROTECTION', objectType: 'FireSuppression' },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    systems: [
      { id: 'security.access', label: 'Zutrittskontrolle', predefinedType: 'SECURITY', objectType: 'AccessControl' },
      { id: 'security.video', label: 'Videosecurity', predefinedType: 'SECURITY', objectType: 'VideoSurveillance' },
      { id: 'security.intrusion', label: 'Intrusion', predefinedType: 'SECURITY', objectType: 'IntrusionDetection' },
      { id: 'security.tracking', label: 'Ortungssysteme', predefinedType: 'SECURITY', objectType: 'TrackingSystems' },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    systems: [
      { id: 'automation.primary', label: 'Automation Primäranlagen', predefinedType: 'CONTROL', objectType: 'PrimarySystems' },
      { id: 'automation.rooms', label: 'Raumautomation', predefinedType: 'CONTROL', objectType: 'BuildingAutomation' },
    ],
  },
];

/** Every system across every role, in declaration order. */
export function allDisciplineSystems(): DisciplineSystem[] {
  return DISCIPLINE_ROLES.flatMap((role) => role.systems);
}

/** The system with this id, or `null` — including for `STANDARD_ROLE_ID`. */
export function findDisciplineSystem(systemId: string | null): DisciplineSystem | null {
  if (!systemId || systemId === STANDARD_ROLE_ID) return null;
  return allDisciplineSystems().find((system) => system.id === systemId) ?? null;
}

/** The role a system belongs to, or `null` when the id is unknown. */
export function roleOfSystem(systemId: string | null): DisciplineRole | null {
  if (!systemId || systemId === STANDARD_ROLE_ID) return null;
  return DISCIPLINE_ROLES.find((role) => role.systems.some((s) => s.id === systemId)) ?? null;
}

/**
 * The IFC `Name` given to the system entity, e.g. `"Fire - Branddetektion"`.
 *
 * ASCII separator on purpose: neither STEP escaper (`@ifc-lite/data`'s nor
 * `@ifc-lite/export`'s) encodes non-ASCII via `\X2\`, so anything outside
 * ASCII is written to the file raw. Labels carry whatever the role declares —
 * German ones legitimately contain umlauts — but the separator this function
 * adds itself has no reason to make that worse.
 */
export function disciplineSystemName(system: DisciplineSystem): string {
  const role = roleOfSystem(system.id);
  return role ? `${role.label} - ${system.label}` : system.label;
}
