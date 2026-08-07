/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a zone is *about* — its theme.
 *
 * A zone without a theme is not a zone, it is a bag of rooms. Fire
 * compartments, trigger zones, ventilation sections and construction phases
 * all group the same rooms in different, overlapping ways, and a colouring
 * that mixes them is not incomplete — it is misleading, because a room
 * legitimately belongs to one zone per theme and can only be drawn once.
 *
 * IFC records the theme in two different places, which is the whole reason
 * this table exists:
 *
 * - `IfcZone` has NO PredefinedType — the schema gives it none — so the theme
 *   lives in `ObjectType`, free text. IFC documents four values for
 *   compartment-like zones (`FireCompartment`, `ElevatorShaft`, `RisingDuct`,
 *   `RunningDuct`); everything beyond that is our convention, and this file is
 *   where that convention is written down.
 * - `IfcSpatialZone` HAS `IfcSpatialZoneTypeEnum`, so the theme goes there,
 *   with `ObjectType` carrying the refinement the enum is too coarse for.
 *
 * The two must never drift: one theme, one label, both landings derived here.
 */

import type { SpatialZonePredefinedType } from '@ifc-lite/create';

/** The schema a `PredefinedType` value requires. */
export type ThemeSchema = 'IFC4' | 'IFC4X3';

export interface ZoneTheme {
  /** Stable key. Never shown, never translated — it identifies the theme. */
  id: string;
  /** What the author picks from. */
  label: string;
  /** `IfcZone.ObjectType`. */
  zoneObjectType: string;
  /** `IfcSpatialZone.PredefinedType`. */
  spatialPredefinedType: SpatialZonePredefinedType;
  /**
   * `IfcSpatialZone.ObjectType`, when the enum alone cannot tell two themes
   * apart — six of these map to FIRESAFETY, three to TRANSPORT.
   */
  spatialObjectType: string | null;
  /**
   * Schema the `PredefinedType` needs. Absent means IFC4 and up.
   * `INTERFERENCE` and `RESERVATION` were added in IFC4X3 and are invalid in
   * an IFC4 file — see {@link resolveSpatialType}, which degrades them.
   */
  since?: ThemeSchema;
}

/**
 * The theme catalogue.
 *
 * Order is the order the picker shows: the IFC enum groups, each followed by
 * its refinements, so related themes sit together rather than alphabetically
 * scattered.
 */
export const ZONE_THEMES: readonly ZoneTheme[] = [
  {
    id: 'construction', label: 'Bauabschnitt',
    zoneObjectType: 'ConstructionZone',
    spatialPredefinedType: 'CONSTRUCTION', spatialObjectType: null,
  },

  {
    id: 'fire-compartment', label: 'Brandabschnitt',
    // One of the four values IFC itself documents for IfcZone.
    zoneObjectType: 'FireCompartment',
    spatialPredefinedType: 'FIRESAFETY', spatialObjectType: null,
  },
  {
    id: 'fire-trigger', label: 'Auslösezone Branddetektion',
    zoneObjectType: 'TriggerZoneFire',
    spatialPredefinedType: 'FIRESAFETY', spatialObjectType: 'TriggerZoneFire',
  },
  {
    id: 'smoke', label: 'Rauchzone, -abschnitt',
    zoneObjectType: 'SmokeZone',
    spatialPredefinedType: 'FIRESAFETY', spatialObjectType: 'SmokeZone',
  },
  {
    id: 'gas-trigger', label: 'Auslösezone Gasdetektion',
    zoneObjectType: 'TriggerZoneGas',
    spatialPredefinedType: 'FIRESAFETY', spatialObjectType: 'TriggerZoneGas',
  },
  {
    id: 'extinguishing', label: 'Löschanlage Wirkungsbereich',
    zoneObjectType: 'Extinguishing',
    spatialPredefinedType: 'FIRESAFETY', spatialObjectType: 'Extinguishing',
  },

  {
    id: 'interference', label: 'Störungszone, -abschnitt',
    zoneObjectType: 'InterferenceZone',
    spatialPredefinedType: 'INTERFERENCE', spatialObjectType: null,
    since: 'IFC4X3',
  },

  {
    id: 'lighting', label: 'Beleuchtungsabschnitt',
    zoneObjectType: 'LightingZone',
    spatialPredefinedType: 'LIGHTING', spatialObjectType: null,
  },

  {
    id: 'occupancy', label: 'Nutzungszone, -abschnitt',
    zoneObjectType: 'OccupancyZone',
    spatialPredefinedType: 'OCCUPANCY', spatialObjectType: null,
  },
  {
    id: 'occupancy-hospital', label: 'Hauptfunktionsbereiche Spital (DIN 13080)',
    zoneObjectType: 'OccupancyHospital',
    spatialPredefinedType: 'OCCUPANCY', spatialObjectType: 'OccupancyHospital',
  },

  {
    id: 'reservation', label: 'Reservationszone, -abschnitt',
    zoneObjectType: 'ReservationZone',
    spatialPredefinedType: 'RESERVATION', spatialObjectType: null,
    since: 'IFC4X3',
  },

  {
    id: 'security', label: 'Sicherheitszone, -abschnitt',
    zoneObjectType: 'SecurityZone',
    spatialPredefinedType: 'SECURITY', spatialObjectType: null,
  },
  {
    id: 'security-trigger', label: 'Auslösezone Security',
    zoneObjectType: 'TriggerZoneSecurity',
    spatialPredefinedType: 'SECURITY', spatialObjectType: 'TriggerZoneSecurity',
  },
  {
    id: 'explosion-hazard', label: 'Explosionsgefährdeter Bereich (Ex-Schutz)',
    zoneObjectType: 'ExplosionHazardZone',
    spatialPredefinedType: 'SECURITY', spatialObjectType: 'ExplosionHazardZone',
  },

  {
    id: 'thermal', label: 'Klimazone, -abschnitt',
    zoneObjectType: 'ThermalZone',
    spatialPredefinedType: 'THERMAL', spatialObjectType: null,
  },
  {
    id: 'cleanroom', label: 'Reinraum (GMP)',
    zoneObjectType: 'Cleanroom',
    spatialPredefinedType: 'THERMAL', spatialObjectType: 'Cleanroom',
  },
  {
    id: 'smoke-pressurisation', label: 'RDA-Druckzonen',
    zoneObjectType: 'SmokecontrolPressurisation',
    spatialPredefinedType: 'THERMAL', spatialObjectType: 'SmokecontrolPressurisation',
  },

  {
    id: 'transport', label: 'Transportabschnitt',
    zoneObjectType: 'TransportZone',
    spatialPredefinedType: 'TRANSPORT', spatialObjectType: null,
  },
  {
    id: 'elevator-shaft', label: 'Aufzugsschacht',
    // IFC-documented value.
    zoneObjectType: 'ElevatorShaft',
    spatialPredefinedType: 'TRANSPORT', spatialObjectType: 'ElevatorShaft',
  },
  {
    id: 'escape-horizontal', label: 'Horizontaler Fluchtweg',
    zoneObjectType: 'EscapeRouteHorizontal',
    spatialPredefinedType: 'TRANSPORT', spatialObjectType: 'EscapeRouteHorizontal',
  },
  {
    id: 'escape-vertical', label: 'Vertikaler Fluchtweg',
    zoneObjectType: 'EscapeRouteVertical',
    spatialPredefinedType: 'TRANSPORT', spatialObjectType: 'EscapeRouteVertical',
  },

  {
    id: 'ventilation', label: 'Lüftungszone, -abschnitt',
    zoneObjectType: 'VentilationZone',
    spatialPredefinedType: 'VENTILATION', spatialObjectType: null,
  },
  {
    id: 'rising-duct', label: 'Steigzone vertikal',
    // IFC-documented value. The refinement is NOT optional here: without it
    // this theme and the two beside it all export as bare VENTILATION and
    // become indistinguishable in the file.
    zoneObjectType: 'RisingDuct',
    spatialPredefinedType: 'VENTILATION', spatialObjectType: 'RisingDuct',
  },
  {
    id: 'running-duct', label: 'Leitungszone horizontal',
    zoneObjectType: 'RunningDuct',
    spatialPredefinedType: 'VENTILATION', spatialObjectType: 'RunningDuct',
  },

  {
    id: 'notdefined', label: 'Nicht definiert',
    // The honest "not classified yet". Present so the theme can be mandatory
    // without forcing a guess — a wrong theme is worse than an absent one.
    zoneObjectType: 'Notdefined',
    spatialPredefinedType: 'NOTDEFINED', spatialObjectType: null,
  },
];

/** The fallback every new zone starts from. */
export const DEFAULT_THEME_ID = 'notdefined';

/** Look up a theme, or the fallback when the id is unknown. */
export function themeById(id: string | null | undefined): ZoneTheme {
  return ZONE_THEMES.find((t) => t.id === id)
    ?? ZONE_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

/**
 * Recognise the theme of a zone already in the model, by its `ObjectType`.
 *
 * Matching is case-insensitive because other tools round-trip the string, and
 * a zone whose ObjectType we do not know reports `null` rather than the
 * fallback — "somebody else's convention" and "not classified" are different
 * things and must not be conflated in a list column.
 */
export function themeOfZone(objectType: string | null | undefined): ZoneTheme | null {
  const value = (objectType ?? '').trim().toLowerCase();
  if (!value) return null;
  return ZONE_THEMES.find((t) => t.zoneObjectType.toLowerCase() === value) ?? null;
}

export interface SpatialTypeMapping {
  predefinedType: SpatialZonePredefinedType;
  objectType: string | null;
  /** True when the schema forced a fallback to `USERDEFINED`. */
  degraded: boolean;
}

/**
 * How a theme lands on an `IfcSpatialZone` in a given schema.
 *
 * `INTERFERENCE` and `RESERVATION` entered `IfcSpatialZoneTypeEnum` with
 * IFC4X3. Writing either into an IFC4 file produces an enum token the schema
 * does not declare — which validators reject and other tools read as garbage.
 * There, the theme degrades to `USERDEFINED` and keeps its identity in
 * `ObjectType`, which is exactly what USERDEFINED is for.
 */
export function resolveSpatialType(theme: ZoneTheme, schema: string): SpatialTypeMapping {
  const needsIfc4x3 = theme.since === 'IFC4X3';
  const hasIfc4x3 = schema.toUpperCase().startsWith('IFC4X3');

  if (needsIfc4x3 && !hasIfc4x3) {
    return {
      predefinedType: 'USERDEFINED',
      objectType: theme.spatialObjectType ?? theme.zoneObjectType,
      degraded: true,
    };
  }
  return {
    predefinedType: theme.spatialPredefinedType,
    objectType: theme.spatialObjectType,
    degraded: false,
  };
}
