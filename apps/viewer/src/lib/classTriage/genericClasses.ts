/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which IFC classes say too little to be a Fachklasse.
 *
 * The proxy triage answers "this element has no class at all". This answers
 * the quieter version: the element HAS a class, the class is not wrong, and it
 * still does not say what the thing is.
 *
 * # The Data Dictionary already solved this — follow it
 * Marc's Data Dictionary classifies every class in the IFC-4.3 core schema as
 * Sub-Fachklasse / Fachklasse / Klasse / Zwischenklasse / Abstrakte Klasse,
 * and its rule is simply the shape of the inheritance tree (Marc, 2026-08-15):
 *
 *  - **Abstrakte Klasse** — `abstract` in the schema. No file may instantiate
 *    one, so an instance is a broken file rather than a vague one.
 *  - **Zwischenklasse** — instantiable and HAS subtypes. A junction, not a
 *    leaf: `IfcBuiltElement`, `IfcDistributionElement`, `IfcFlowSegment`.
 *    "Einfach gesagt: von einer Klasse (z. B. IfcWall, IfcSensor, IfcDamper)
 *    in der IFC-Schema-Hierarchie nach oben."
 *  - **Klasse** — instantiable, no subtypes. A leaf, and therefore a fine
 *    answer. Not reported here.
 *
 * Only the first two are this panel's business. Whether a leaf is additionally
 * a curated Fachklasse or Sub-Fachklasse is the catalogue's question, not the
 * schema's, so it is not decided here.
 *
 * # Against IFC 4.3, whatever the file is
 * The dictionary reads the 4.3 core schema and so does this. That is not a
 * detail: in IFC4 `IfcWall` has the `…StandardCase` subtypes, so an IFC4-based
 * rule calls every wall a Zwischenklasse — on one real model, 97 walls and 33
 * doors reported as work. 4.3 removed all of those but one, and the survivor
 * is excluded below by name. The result agrees with the dictionary on every
 * class checked against its own screenshots.
 *
 * An element in an IFC2X3 or IFC4 file is judged by the same 4.3 tree, which
 * is the point: the question "is this class specific enough" is about the
 * modelling, not about which schema version the exporter happened to write.
 */

import { ENTITIES_IFC4X3 } from '@ifc-lite/data';

/** Why a class is being asked about. */
export type GenericClassKind = 'abstract' | 'intermediate';

export const GENERIC_CLASS_LABELS: Readonly<Record<GenericClassKind, string>> = {
  abstract: 'Abstrakte Klasse',
  intermediate: 'Zwischenklasse',
};

/**
 * Subtypes that exist only to be deprecated.
 *
 * IFC4 split several classes into a `…StandardCase` variant describing how the
 * geometry was modelled rather than what the thing is. IFC4.3 dropped them;
 * `IfcWallStandardCase` is the one still carried in the table. Counting it as
 * a subtype would make `IfcWall` a Zwischenklasse, which is exactly the answer
 * Marc's own example says is wrong.
 */
const DEPRECATED_CASE_SUBTYPE = /(StandardCase|ElementedCase)$/;

interface Tree {
  readonly byName: ReadonlyMap<string, { parent?: string; abstract: boolean }>;
  readonly subtypeCount: ReadonlyMap<string, number>;
}

let tree: Tree | null = null;

function schema(): Tree {
  if (tree) return tree;
  const byName = new Map<string, { parent?: string; abstract: boolean }>();
  const subtypeCount = new Map<string, number>();
  for (const entity of ENTITIES_IFC4X3) {
    byName.set(entity.name, { parent: entity.parent, abstract: entity.abstract });
  }
  for (const entity of ENTITIES_IFC4X3) {
    if (!entity.parent || DEPRECATED_CASE_SUBTYPE.test(entity.name)) continue;
    subtypeCount.set(entity.parent, (subtypeCount.get(entity.parent) ?? 0) + 1);
  }
  tree = { byName, subtypeCount };
  return tree;
}

/** Walk to the root. Used to keep the judgement to products. */
function ancestors(name: string): string[] {
  const { byName } = schema();
  const out: string[] = [];
  let current = byName.get(name);
  while (current?.parent) {
    out.push(current.parent);
    current = byName.get(current.parent);
  }
  return out;
}

/**
 * How generic a class is, or `null` when it is specific enough.
 *
 * Only products are judged. A relationship, a property set or an actor is not
 * something an author classifies on an element, and asking about it would fill
 * the list with noise.
 */
export function genericClassKind(entity: string): GenericClassKind | null {
  const { byName, subtypeCount } = schema();
  const metadata = byName.get(entity);
  if (!metadata) return null;
  if (![entity, ...ancestors(entity)].includes('IfcProduct')) return null;
  if (metadata.abstract) return 'abstract';
  return (subtypeCount.get(entity) ?? 0) > 0 ? 'intermediate' : null;
}

/**
 * The classes an element on `entity` could legitimately become.
 *
 * Its own subtypes, transitively, keeping only the LEAVES — offering
 * `IfcFlowController` as the answer to `IfcDistributionElement` would move the
 * question rather than settle it. Deprecated `…StandardCase` variants are left
 * out for the same reason they are not counted above.
 *
 * Sorted, so the list reads the same every time.
 */
export function candidateSubclasses(entity: string): string[] {
  const children = new Map<string, string[]>();
  for (const item of ENTITIES_IFC4X3) {
    if (!item.parent || DEPRECATED_CASE_SUBTYPE.test(item.name)) continue;
    const list = children.get(item.parent);
    if (list) list.push(item.name);
    else children.set(item.parent, [item.name]);
  }

  const out = new Set<string>();
  const walk = (name: string) => {
    for (const child of children.get(name) ?? []) {
      if (genericClassKind(child) === null) out.add(child);
      walk(child);
    }
  };
  walk(entity);
  return [...out].sort();
}

/** Test seam: drop the memoised schema tree. */
export function resetGenericClassCacheForTests(): void {
  tree = null;
}
