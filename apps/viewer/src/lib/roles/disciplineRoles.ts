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
 * Read-only, and the default. Most people who open a model never author in it —
 * they look. Starting there means opening a file can't quietly damage it, and
 * writing is something you switch into rather than something you are already in.
 */
export const VIEWER_ROLE_ID = 'viewer';

/**
 * Full access, including the reference model. Correcting it IS sometimes the
 * job — unmaintained room numbers, a wrong classification — and that work needs
 * a mode chosen on purpose rather than one you fall into while placing devices.
 */
export const EDITOR_ROLE_ID = 'editor';

/** Neither Viewer nor Editor groups placements; only a discipline role does. */
export function isBaseRole(roleId: string | null): boolean {
  return roleId === VIEWER_ROLE_ID || roleId === EDITOR_ROLE_ID;
}

/**
 * The single id stored before Viewer/Editor existed. It meant full access, so
 * it becomes Editor — silently demoting someone mid-project to read-only would
 * look like the tool had broken.
 */
const LEGACY_STANDARD_ROLE_ID = 'standard';

/**
 * A stored id made safe to use: the legacy value is migrated, and anything
 * unrecognised (a role since removed from the catalogue, a corrupted value)
 * falls back to Viewer rather than leaving authoring in a mode nothing
 * describes — read-only is the safe direction to fail in.
 */
export function normalizeRoleId(stored: string | null | undefined): string {
  if (stored === LEGACY_STANDARD_ROLE_ID) return EDITOR_ROLE_ID;
  if (isBaseRole(stored ?? null)) return stored as string;
  return findDisciplineSystem(stored ?? null) ? (stored as string) : VIEWER_ROLE_ID;
}

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

/** The system with this id, or `null` — including for the base roles. */
export function findDisciplineSystem(systemId: string | null): DisciplineSystem | null {
  if (!systemId || isBaseRole(systemId)) return null;
  return allDisciplineSystems().find((system) => system.id === systemId) ?? null;
}

/** The role a system belongs to, or `null` when the id is unknown. */
export function roleOfSystem(systemId: string | null): DisciplineRole | null {
  if (!systemId || isBaseRole(systemId)) return null;
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


/** What a store must offer for {@link parsedDisciplineSystemOf} to read it. */
export interface SystemReadableStore {
  entityIndex?: { byType?: { get(type: string): number[] | undefined } };
  entities?: {
    getObjectType?(expressId: number): string | null;
  };
}

/**
 * The installation for `system` that the LOADED FILE already carries, or `null`.
 *
 * # Why this exists, and why it reverses a rule
 * `findDistributionSystem` in `@ifc-lite/create` deliberately scans only what
 * the session authored, on the grounds that reusing a system from the file
 * would write into a grouping the user did not make here. That rule is right
 * for a ZONE, where membership is a judgement somebody made. It is wrong for a
 * discipline installation, and the reason is the key: an
 * `IfcDistributionSystem` with `ObjectType = 'FireDetection'` IS the fire
 * detection installation of the building. There is one. Creating a second one
 * because the first arrived with the file does not protect anything — it
 * splits the installation in two, and every consumer downstream then sees two,
 * one of them empty.
 *
 * Measured on a real model: building the detector circuits on a file that
 * already held `Fire - Branddetektion` produced a second system of the same
 * name, and the eighteen circuits were aggregated under the empty one.
 *
 * Matching is on `ObjectType` alone, which is the discipline key — the name is
 * not consulted, because it is a label a user may translate or shorten and the
 * key is not.
 */
export function parsedDisciplineSystemOf(
  store: SystemReadableStore | null | undefined,
  system: DisciplineSystem,
): number | null {
  // `IFCDISTRIBUTIONSYSTEM` only. A circuit is a subtype of a system and can
  // carry the same ObjectType, but it is a PARTITION of the installation,
  // never the installation itself — aggregating the circuits under one of
  // their own would make a cycle.
  for (const expressId of store?.entityIndex?.byType?.get('IFCDISTRIBUTIONSYSTEM') ?? []) {
    if (store?.entities?.getObjectType?.(expressId) === system.objectType) return expressId;
  }
  return null;
}
