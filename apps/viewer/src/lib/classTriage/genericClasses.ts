/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which IFC classes say too little to be a Fachklasse.
 *
 * The proxy triage answers "this element has no class at all". This answers
 * the quieter version: the element HAS a class, the class is not wrong, and it
 * still does not say what the thing is. `IfcFlowTerminal` is true of a
 * washbasin, a ceiling diffuser, a socket and a loudspeaker alike.
 *
 * # Two kinds, both from the schema rather than from a list somebody typed
 *
 * **Abstrakte Klasse** — `isAbstract` in the EXPRESS schema: `IfcElement`,
 * `IfcBuildingElement`, `IfcProduct`. These cannot legally be instantiated at
 * all, so an instance is a broken file, not a vague one. Rare, and worth its
 * own severity when it happens.
 *
 * **Zwischenklasse** — instantiable, has subtypes, and carries NO
 * `PredefinedType` of its own. That last clause is the whole discriminator and
 * it comes straight from Marc's own definition of a Fachklasse: entity plus
 * PredefinedType. A class that cannot carry a PredefinedType cannot BE a
 * Fachklasse, so it is by construction a junction in the tree rather than a
 * leaf. Twelve classes across the schema, all of them in the distribution and
 * furnishing branches.
 *
 * # Why "has subtypes" alone would have been wrong
 * It was the obvious first rule, and it flags `IfcWall`, `IfcDoor`, `IfcSlab`,
 * `IfcColumn` — because IFC4 gave them `…StandardCase` subtypes. Those are a
 * geometry-modelling variant, not a better answer to "what is this", and IFC4X3
 * dropped them again. On one real architecture model that rule would have
 * reported 97 walls and 33 doors as needing work. Requiring the absence of a
 * PredefinedType removes every one of them: a wall HAS a PredefinedType, so a
 * wall is already a Fachklasse.
 */

import {
  SCHEMA_REGISTRY, getAllAttributesForEntity, getInheritanceChainForEntity,
} from '@ifc-lite/parser';

/** Why a class is being asked about. */
export type GenericClassKind = 'abstract' | 'intermediate';

export const GENERIC_CLASS_LABELS: Readonly<Record<GenericClassKind, string>> = {
  abstract: 'Abstrakte Klasse',
  intermediate: 'Zwischenklasse',
};

/** Every class name the schema registry knows, computed once. */
function entityNames(): string[] {
  return Object.keys(SCHEMA_REGISTRY.entities);
}

let subtypeCounts: Map<string, number> | null = null;

function countSubtypes(): Map<string, number> {
  if (subtypeCounts) return subtypeCounts;
  const counts = new Map<string, number>();
  for (const name of entityNames()) {
    const parent = SCHEMA_REGISTRY.entities[name]?.parent;
    if (parent) counts.set(parent, (counts.get(parent) ?? 0) + 1);
  }
  subtypeCounts = counts;
  return counts;
}

function isProduct(name: string): boolean {
  return [name, ...getInheritanceChainForEntity(name)].includes('IfcProduct');
}

function hasPredefinedType(name: string): boolean {
  return getAllAttributesForEntity(name).some((a) => a.name === 'PredefinedType');
}

/**
 * How generic a class is, or `null` when it is a perfectly good Fachklasse.
 *
 * Only products are judged. A relationship or a property set is not something
 * an author classifies, and asking about it would fill the list with noise.
 */
export function genericClassKind(entity: string): GenericClassKind | null {
  const metadata = SCHEMA_REGISTRY.entities[entity];
  if (!metadata || !isProduct(entity)) return null;
  if (metadata.isAbstract) return 'abstract';
  if ((countSubtypes().get(entity) ?? 0) > 0 && !hasPredefinedType(entity)) {
    return 'intermediate';
  }
  return null;
}

/**
 * The classes an element on `entity` could legitimately become.
 *
 * Its own subtypes, transitively, minus the ones that are themselves too
 * generic — offering `IfcFlowController` as the answer to `IfcDistributionElement`
 * would move the question rather than settle it. Sorted, so the list reads the
 * same every time.
 *
 * Used to narrow the catalogue search: an `IfcFlowTerminal` should not be
 * offered `IfcWall`, and a list of 1330 classes where 20 are plausible is a
 * list that gets a wrong answer picked out of it.
 */
export function candidateSubclasses(entity: string): string[] {
  const direct = new Map<string, string[]>();
  for (const name of entityNames()) {
    const parent = SCHEMA_REGISTRY.entities[name]?.parent;
    if (!parent) continue;
    const list = direct.get(parent);
    if (list) list.push(name);
    else direct.set(parent, [name]);
  }

  const out = new Set<string>();
  const walk = (name: string) => {
    for (const child of direct.get(name) ?? []) {
      if (SCHEMA_REGISTRY.entities[child]?.isAbstract) { walk(child); continue; }
      if (genericClassKind(child) === 'intermediate') { walk(child); continue; }
      out.add(child);
      walk(child);
    }
  };
  walk(entity);
  return [...out].sort();
}

/** Test seam: drop the memoised subtype counts. */
export function resetGenericClassCacheForTests(): void {
  subtypeCounts = null;
}
