/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Element/product catalog — the data model behind a "library" of
 * placeable installation elements (detectors, sirens, cameras, call
 * points, ...), as opposed to the built-in structural Add Element
 * types (wall/slab/door/...).
 *
 * Deliberately shaped so a catalog backed by an external registry can
 * be plugged in later without changing this shape — in particular a
 * Digital Product Passport / Asset Administration Shell (AAS, IEC
 * 63278) source, which several teams are moving toward for exactly
 * this kind of product data. `identity` and `technicalData` mirror
 * AAS concepts (globalAssetId, idShort, a flat "Technical Data"
 * submodel-style property bag) without depending on the AAS metamodel
 * itself — no AAS client exists yet, this just avoids a reshape later.
 * `provenance` records where an entry actually came from today.
 */

/** Where a catalog came from — used for both entries and providers. */
export type CatalogSourceKind = 'local-seed' | 'aas';

export interface CatalogProvenance {
  source: CatalogSourceKind;
  /**
   * Traceability pointer back to the origin of this entry's IFC mapping
   * or product data. For `local-seed` entries derived from a curated
   * IFC classification list, this is that list's own entry id (e.g.
   * `"IfcSensor.FIRESENSOR"`). For `aas` entries, the AAS/submodel id.
   */
  sourceRef?: string;
}

/** How the element is physically mounted — informs default placement/orientation, not enforced yet. */
export type CatalogMounting = 'ceiling' | 'wall' | 'floor' | 'freestanding';

/** The subset of a product's IFC representation needed to place and export it. */
export interface CatalogIfcMapping {
  /** IFC entity name, e.g. `'IfcSensor'`. Must be a "header + optional PredefinedType" shaped entity — see `addLibraryElementToStore`. */
  entity: string;
  /** PredefinedType enum value without dots, e.g. `'FIRESENSOR'`. */
  predefinedType?: string;
  /** Free-text refinement, only meaningful when `predefinedType === 'USERDEFINED'`. */
  objectType?: string;
}

/** Default placement box, in metres, used for both the 3D preview mesh and the emitted IFC geometry. */
export interface CatalogGeometryHint {
  width: number;
  depth: number;
  height: number;
}

/**
 * A flat "Technical Data"-style property bag — the default attribute
 * values a placed instance starts with (editable afterward via the
 * normal attribute panel). Named after the AAS "Technical Data"
 * submodel this would eventually come from, not a literal AAS type.
 */
export type CatalogTechnicalData = Record<string, string | number | boolean>;

export interface CatalogEntry {
  /** Stable id within the catalog, e.g. `'fire.smoke-detector'`. Not an IFC GlobalId — assigned per placed instance separately. */
  id: string;
  label: string;
  description?: string;
  /** Coarse grouping matching the installation disciplines this catalog targets. */
  discipline: 'fire' | 'security' | 'intrusion' | 'other';
  /** Finer-grained grouping for UI filtering, e.g. `'detector'`, `'manual-call-point'`, `'camera'`. Free-form on purpose — no fixed taxonomy yet. */
  category: string;
  ifc: CatalogIfcMapping;
  geometry: CatalogGeometryHint;
  mounting: CatalogMounting;
  technicalData?: CatalogTechnicalData;
  /** Manufacturer/article info — empty for generic seed entries, populated once a real product catalog is wired in. */
  manufacturer?: string;
  articleNumber?: string;
  /** AAS `globalAssetId`-shaped identifier — unpopulated until entries are actually AAS-backed. */
  globalAssetId?: string;
  provenance: CatalogProvenance;
}

/** Something that can list catalog entries — local seed data today, an AAS registry client later. */
export interface CatalogProvider {
  id: CatalogSourceKind;
  listEntries(): CatalogEntry[] | Promise<CatalogEntry[]>;
}
