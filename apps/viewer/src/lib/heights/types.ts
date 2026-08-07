/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A project's reference height system: which storeys exist, at what level, and
 * what named heights hang off each one.
 *
 * Naming, elevation and storey height have to mean the same thing across every
 * discipline model in a project, and in practice they drift. The architecture
 * model is the reference: the system is derived from it, exported, and other
 * models are later checked against it.
 *
 * **Every length in this file is in METRES**, relative to the project datum
 * (±0.00). Consumers do not convert. That is the entire reason the derivation
 * refuses to run when the source file's unit cannot be determined — a
 * centimetre file read as metres yields storeys that are wrong by a factor of
 * 100 and look completely plausible.
 */

/** Where a storey's elevation came from. Recorded because the sources differ
 *  in trustworthiness and in how they behave when a model is revised. */
export type ElevationSource =
  /** `IfcBuildingStorey.Elevation`. Deprecated in IFC4 and, in practice, the
   *  only one that is actually populated. */
  | 'ifc-elevation-attribute'
  /** `Pset_BuildingStoreyCommon.ElevationOfFFLRelative` — the successor the
   *  schema points at. Measured on two real models: neither wrote it. */
  | 'pset-ffl-relative'
  /** Computed from `ObjectPlacement` when the attribute is absent. */
  | 'object-placement'
  /** Set by hand in the height manager, overriding whatever was read. */
  | 'manual';

/**
 * A named height relative to a storey's elevation.
 *
 * Modelled on how Vectorworks storeys work, and structurally the same thing
 * `ElevationOfFFLRelative` describes: the storey carries the level, named
 * heights hang off it at a z-offset, and moving the storey moves them all.
 */
export interface ReferenceLevel {
  /** Stable key, e.g. `'ffl'`, `'ssl'`. Not shown, not translated. */
  key: string;
  /** What the author sees, e.g. `'OK-Fertigboden'`. */
  label: string;
  /** Distance from the storey elevation, in metres. Negative = below. */
  offset: number;
}

export interface Storey {
  id: string;
  /** As written in the model, e.g. `'E00'`. Display only — naming conventions
   *  differ per office (`U01/E00/O01` against `UG/EG/Roof`), so a name is
   *  never a key. */
  name: string;
  /** Relative to the project datum ±0.00, in metres. */
  elevation: number;
  source: ElevationSource;
  /** Overrides the system-wide levels for this storey. Absent = the system's
   *  levels apply. */
  levels?: ReferenceLevel[];
}

export interface HeightSystem {
  formatVersion: 1;
  derivedFrom: {
    documentId?: string;
    fileName: string;
    /** e.g. `'MILLI.METRE'`. Recorded so a reader can tell what was assumed
     *  rather than having to trust that someone got it right. */
    sourceLengthUnit?: string;
  };
  /** ISO-8601. */
  updatedAt: string;
  /**
   * Height of ±0.00 above sea level, in metres.
   *
   * `undefined` means UNKNOWN, not zero. The distinction matters: zero is a
   * claim about the site, and a wrong one is worse than an absent one.
   */
  datumAboveSeaLevel?: number;
  /** Apply to every storey that carries no `levels` of its own. */
  referenceLevels: ReferenceLevel[];
  /** Ascending by elevation. */
  storeys: Storey[];
}

/**
 * A storey as the UI shows it: the stored data plus what can only be known by
 * looking at the neighbours.
 */
export interface StoreyWithHeight extends Storey {
  /**
   * Distance to the next storey up, in metres — or `null` for the topmost,
   * where there is nothing to measure against.
   *
   * `null`, never 0. A zero-height top storey is a claim that the building
   * ends exactly at its last slab, which nothing in the file supports.
   */
  height: number | null;
}
