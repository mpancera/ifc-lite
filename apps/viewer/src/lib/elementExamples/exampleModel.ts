/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading a published Elementbeispiel: what is in the file, and which part of
 * it is the object.
 *
 * # An example is not one product
 * The dictionary's files carry a device AND its companions: the clearance in
 * front of an extinguisher, the detection cone of a movement sensor, the plan
 * symbol that belongs in a 2D view. Those are separate products on purpose —
 * a clearance is an agreement, not matter, and modelling it as part of the
 * device would have the file say the device is 80 cm deep.
 *
 * So placing an example means placing several products and keeping the
 * relation between them, not copying one.
 *
 * # Which one is the device
 * Asked of the file rather than guessed from names. The companions point AT
 * the device through `IfcRelAssignsToProduct.RelatingProduct`, so the device is
 * whatever they name. Only where an example carries no such relation does this
 * fall back to "the product that is neither an annotation nor a virtual
 * element" — which is the same answer for every example published so far, and
 * a guess that is at least a stated one.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { EntityExtractor } from '@ifc-lite/parser';
import type { ReadSourceEntity, SourceEntity } from '@ifc-lite/create';

/** Products that are never the device, however the file is put together. */
const NEVER_THE_DEVICE = new Set(['IFCANNOTATION', 'IFCVIRTUALELEMENT']);

/** One representation of a product, already resolved to what a map needs. */
export interface ExampleRepresentation {
  /** The `IfcShapeRepresentation` in the SOURCE file. */
  expressId: number;
  /** `'Body'`, `'Annotation'`, … — kept so a caller can prefer one. */
  identifier: string | null;
  /** Its `ContextOfItems`, which must be substituted on copy. */
  contextId: number | null;
}

export interface ExampleProduct {
  expressId: number;
  /** Canonical entity name as the file spells it, e.g. `IFCSENSOR`. */
  type: string;
  name: string | null;
  description: string | null;
  objectType: string | null;
  predefinedType: string | null;
  tag: string | null;
  representations: ExampleRepresentation[];
}

export interface ExampleModel {
  /** Metres per unit of the SOURCE file. */
  lengthUnitScale: number;
  /** Read any entity of the source, for `copySubgraph`. */
  read: ReadSourceEntity;
  /** The object itself. */
  device: ExampleProduct;
  /** Clearances, detection areas, plan symbols — each its own product. */
  companions: ExampleProduct[];
  /** Every representation context in the file, to substitute on copy. */
  contextIds: number[];
}

/**
 * The id a reference points at.
 *
 * `EntityExtractor` hands a reference back as a plain NUMBER, not as `"#42"`
 * — the same convention `resolve-source.ts` reads and the opposite of what an
 * entity authored through the overlay carries. Everything in this file reads
 * extractor output, so a number it is.
 */
function refId(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** A STEP string attribute without its quotes, or `null` for `$`. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const inner = value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1) : value;
  return inner.length > 0 ? inner : null;
}

/** A STEP enum (`.SMOKESENSOR.`) without its dots, or `null`. */
function enumValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < 3 || !value.startsWith('.') || !value.endsWith('.')) return null;
  const inner = value.slice(1, -1);
  return inner.length > 0 ? inner : null;
}

/**
 * Build a reader over a parsed store.
 *
 * `EntityExtractor` wants an `EntityRef` (byte offsets), not an id, so the id
 * index is the hop in between. An id the file does not have reads as `null`,
 * which `copySubgraph` turns into a refusal rather than a hole.
 */
export function makeSourceReader(store: IfcDataStore): ReadSourceEntity {
  const extractor = new EntityExtractor(store.source);
  return (expressId: number): SourceEntity | null => {
    const ref = store.entityIndex.byId.get(expressId);
    if (!ref) return null;
    const entity = extractor.extractEntity(ref);
    return entity ? { type: entity.type, attributes: entity.attributes } : null;
  };
}

/** Every express id in the file whose entity type is one of `types`. */
function idsOfTypes(store: IfcDataStore, types: readonly string[]): number[] {
  const out: number[] = [];
  for (const type of types) {
    for (const id of store.entityIndex.byType.get(type) ?? []) out.push(id);
  }
  return out;
}

/**
 * The representations of a product, resolved through its
 * `IfcProductDefinitionShape`.
 *
 * Index 6 on `IfcProduct` is `Representation`; index 2 on
 * `IfcProductDefinitionShape` is `Representations`. A product with no shape
 * returns an empty list rather than failing — an example may legitimately
 * carry a product that is only a placeholder.
 */
function representationsOf(read: ReadSourceEntity, productId: number): ExampleRepresentation[] {
  const product = read(productId);
  const shapeId = refId(product?.attributes[6]);
  if (shapeId === null) return [];
  const shape = read(shapeId);
  const list = shape?.attributes[2];
  if (!Array.isArray(list)) return [];

  const out: ExampleRepresentation[] = [];
  for (const member of list) {
    const id = refId(member);
    if (id === null) continue;
    const representation = read(id);
    if (!representation) continue;
    out.push({
      expressId: id,
      identifier: text(representation.attributes[1]),
      contextId: refId(representation.attributes[0]),
    });
  }
  return out;
}

function productOf(read: ReadSourceEntity, expressId: number): ExampleProduct | null {
  const entity = read(expressId);
  if (!entity) return null;
  return {
    expressId,
    type: entity.type.toUpperCase(),
    name: text(entity.attributes[2]),
    description: text(entity.attributes[3]),
    objectType: text(entity.attributes[4]),
    // PredefinedType is the LAST attribute of a simple element, and where it
    // sits differs per entity — read as an enum wherever it lands rather than
    // by index, which would be right for IfcSensor and wrong for IfcDoor.
    predefinedType: enumValue(entity.attributes[entity.attributes.length - 1]),
    tag: text(entity.attributes[7]),
    representations: representationsOf(read, expressId),
  };
}

/**
 * Which product every `IfcRelAssignsToProduct` in the file points at.
 *
 * The companions name the device; the device names nobody. So the most-named
 * product is the device, and in a well-formed example there is exactly one.
 */
function relatingProducts(store: IfcDataStore, read: ReadSourceEntity): Map<number, number> {
  const counts = new Map<number, number>();
  for (const id of idsOfTypes(store, ['IFCRELASSIGNSTOPRODUCT'])) {
    const rel = read(id);
    // RelatingProduct is index 6: GlobalId, OwnerHistory, Name, Description,
    // RelatedObjects, RelatedObjectsType, RelatingProduct.
    const target = refId(rel?.attributes[6]);
    if (target !== null) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

/**
 * Read a parsed example into the pieces a placement needs.
 *
 * Returns `null` when the file holds no product that could be the device —
 * which is not a crash: a caller should say "this example cannot be placed"
 * rather than place nothing and report success.
 */
export function readExampleModel(
  store: IfcDataStore,
  lengthUnitScale: number,
): ExampleModel | null {
  const read = makeSourceReader(store);

  // Everything the file contains spatially. Reading the containment relation
  // rather than scanning for product types keeps a stray entity that is not
  // part of the object out of the placement.
  const productIds = new Set<number>();
  for (const id of idsOfTypes(store, ['IFCRELCONTAINEDINSPATIALSTRUCTURE'])) {
    const rel = read(id);
    const related = rel?.attributes[4];
    if (!Array.isArray(related)) continue;
    for (const member of related) {
      const productId = refId(member);
      if (productId !== null) productIds.add(productId);
    }
  }
  if (productIds.size === 0) return null;

  const products: ExampleProduct[] = [];
  for (const id of productIds) {
    const product = productOf(read, id);
    if (product) products.push(product);
  }
  if (products.length === 0) return null;

  const named = relatingProducts(store, read);
  const device =
    products.find((p) => named.has(p.expressId)) ??
    products.find((p) => !NEVER_THE_DEVICE.has(p.type)) ??
    products[0];

  const contextIds = new Set<number>();
  for (const product of products) {
    for (const representation of product.representations) {
      if (representation.contextId !== null) contextIds.add(representation.contextId);
    }
  }

  return {
    lengthUnitScale,
    read,
    device,
    companions: products.filter((p) => p !== device),
    contextIds: [...contextIds],
  };
}
