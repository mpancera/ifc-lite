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
 *
 * Since then `aas` (see `CatalogAasLink`) makes that link concrete: an entry
 * may name the type AAS its product data belongs to, and placing it writes
 * that link into the model. Reading FROM an AAS is still not implemented —
 * but recording which one an entry belongs to no longer waits for a client.
 */

/**
 * Where a catalog came from — used for both entries and providers.
 * `local-seed`: the small generic demo catalog bundled with this app.
 * `file-import`: a real catalog the user loaded from a local JSON file
 * (never bundled/committed — see `FileImportCatalogProvider`).
 * `aas`: a live Asset Administration Shell registry — not implemented
 * yet, reserved so entries don't need reshaping once it is.
 */
export type CatalogSourceKind = 'local-seed' | 'file-import' | 'aas';

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
  /**
   * The short designation the product carries in an identifier and on a
   * drawing — `RM` for a Rauchmelder, `HFM` for a Handfeuermelder.
   *
   * Separate from `id` because they answer to different readers. The id is a
   * key (`fire.smoke-detector`): stable, unique, never shown. The tag is what a
   * person writes on a plan and reads back off one, and it has to stay short
   * enough to sit beside a symbol. Using the id in its place is what produced
   * identifiers like `..._fire.smoke-detector.001`.
   */
  tag?: string;
  description?: string;
  /** Coarse grouping matching the installation disciplines this catalog targets. */
  discipline: 'fire' | 'security' | 'intrusion' | 'automation' | 'other';
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
  /** The product's type AAS, when one is attached. See `CatalogAasLink`. */
  aas?: CatalogAasLink;
  provenance: CatalogProvenance;
}

/**
 * The type AAS attached to a catalog product.
 *
 * # Why this hangs off a catalog entry rather than replacing it
 * An AAS supplies a product's alphanumeric data and its documentation, and
 * supplies them better than any catalog file could — they stay current at the
 * manufacturer instead of ageing in a copy. What an AAS does NOT carry is
 * geometry, an IFC class mapping, a placement rule, or the short designation a
 * plan needs (`RM`, `HFM`). Those are this catalog's own contribution and have
 * no source anywhere else.
 *
 * So the catalog is not a stand-in until an AAS connection exists — it is the
 * layer BETWEEN the AAS and the model: geometry and placement defaults live
 * here, and an AAS gets attached to them. An entry with an `aas` link and an
 * entry without are both complete entries; only the second one has to carry
 * its product data itself.
 *
 * Written into the model as `AAS_PSet_Connector` on the product's `IfcXxxType`
 * — see `lib/aas/connectorPset.ts` for the property names and where they come
 * from.
 */
export interface CatalogAasLink {
  /**
   * Unique URL or reference ID of the product's type AAS.
   *
   * "URL or reference ID" is the specification's own wording: an AAS is
   * addressed by an identifier that often looks like a URL without being a
   * reachable endpoint. Consumers must not assume this dereferences.
   */
  address: string;
  /** The AAS version this entry's data was taken from, when known. */
  versionNumber?: string;
  /** When this entry's data was last taken over from that AAS (ISO 8601), when known. */
  fetchDate?: string;
}

/** Something that can list catalog entries — local seed data today, an AAS registry client later. */
export interface CatalogProvider {
  id: CatalogSourceKind;
  listEntries(): CatalogEntry[] | Promise<CatalogEntry[]>;
}
