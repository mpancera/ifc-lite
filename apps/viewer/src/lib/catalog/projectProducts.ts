/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Which catalog products are actually used in this project, and where" —
 * the data behind the Product Library panel's "Projekt-Produkte" tab. One
 * row per `IfcXxxType` placed via the Add Element library, with its placed
 * instances underneath (Type/Instance model, see `library-type.ts`).
 *
 * Deliberately scoped to catalog-placed products only (entities the
 * mutation overlay created via `addLibraryElement`), not every `IfcXxxType`
 * that might already exist in the source file — enumerating "any Type in
 * an arbitrary IFC file" would need broader relationship-graph traversal
 * this hasn't been built/verified for yet (see PROJECT.md).
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';

export interface ProjectProductInstance {
  expressId: number;
  name: string;
}

export interface ProjectProduct {
  typeId: number;
  typeName: string;
  /** The Type entity's own IFC class, e.g. `'IfcSensorType'`. */
  ifcType: string;
  /** The Type's `Tag` — the catalog entry id it was created from, when known. */
  catalogEntryId: string | null;
  instances: ProjectProductInstance[];
}

/** Reads `Name` (attribute index 2) off a `NewEntity`-shaped overlay record, if present. */
function entityName(attributes: unknown[] | undefined, fallback: string): string {
  const name = attributes?.[2];
  return typeof name === 'string' && name ? name : fallback;
}

export function getProjectProducts(mutationView: MutablePropertyView | null | undefined): ProjectProduct[] {
  if (!mutationView) return [];
  const newEntities = mutationView.getNewEntities();
  const byId = new Map(newEntities.map((e) => [e.expressId, e] as const));

  const products = new Map<number, ProjectProduct>();
  for (const entity of newEntities) {
    if (entity.type !== 'IfcRelDefinesByType') continue;
    const related = entity.attributes[4];
    const typeRef = entity.attributes[5];
    if (!Array.isArray(related) || typeof typeRef !== 'string') continue;

    const typeId = Number(typeRef.replace('#', ''));
    if (Number.isNaN(typeId)) continue;

    let product = products.get(typeId);
    if (!product) {
      const typeEntity = byId.get(typeId);
      product = {
        typeId,
        typeName: entityName(typeEntity?.attributes, typeEntity?.type ?? 'Type'),
        ifcType: typeEntity?.type ?? 'Unknown',
        catalogEntryId: typeof typeEntity?.attributes[7] === 'string' ? (typeEntity.attributes[7] as string) : null,
        instances: [],
      };
      products.set(typeId, product);
    }

    for (const ref of related) {
      if (typeof ref !== 'string') continue;
      const instanceId = Number(ref.replace('#', ''));
      if (Number.isNaN(instanceId)) continue;
      const instanceEntity = byId.get(instanceId);
      product.instances.push({
        expressId: instanceId,
        name: entityName(instanceEntity?.attributes, instanceEntity?.type ?? `#${instanceId}`),
      });
    }
  }

  return Array.from(products.values()).sort((a, b) => a.typeName.localeCompare(b.typeName));
}
