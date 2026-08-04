/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Relationships an authoring session created, which the parsed graph cannot
 * see.
 *
 * `extractRelationshipsOnDemand` walks the relationship graph built once at
 * parse time. Everything this fork authors — a device joining an installation,
 * an element bound to its product type, a detector contained in a room — is
 * created in the mutation overlay afterwards, so an element could carry three
 * relationships and the panel would report none.
 *
 * Two of those have no home in the parser's four categories (voids, fills,
 * groups, connections), so they are added here rather than forced into
 * `groups`: a type assignment is not a group, and saying so would be worse
 * than a new heading.
 */

import type { MutablePropertyView, NewEntity } from '@ifc-lite/mutations';
import type { EntityRelationships } from '@ifc-lite/parser';

export interface RelatedRef {
  id: number;
  name?: string;
  type: string;
}

export interface OverlayRelationships extends EntityRelationships {
  /** The `IfcXxxType` this element is bound to via IfcRelDefinesByType. */
  definedBy: RelatedRef[];
  /** The spatial element it is contained in — a room, or its storey. */
  containedIn: RelatedRef[];
}

/** `#123` → `123`; anything else → `null`. */
function refId(value: unknown): number | null {
  if (typeof value !== 'string' || !value.startsWith('#')) return null;
  const id = Number(value.slice(1));
  return Number.isFinite(id) ? id : null;
}

function includesElement(value: unknown, expressId: number): boolean {
  return Array.isArray(value) && value.includes(`#${expressId}`);
}

export interface OverlayRelationshipArgs {
  view: MutablePropertyView | null | undefined;
  expressId: number;
  /** Falls back to the parse for entities the overlay did not create. */
  describe: (expressId: number) => RelatedRef | null;
}

const EMPTY: EntityRelationships = { voids: [], fills: [], groups: [], connections: [] };

/**
 * Merge overlay-authored relationships into a parsed result.
 *
 * `base` may be `null` — an element created this session has no parsed
 * relationships at all, which is exactly the case that showed nothing.
 */
export function withOverlayRelationships(
  base: EntityRelationships | null,
  args: OverlayRelationshipArgs,
): OverlayRelationships | null {
  const merged: OverlayRelationships = {
    voids: [...(base ?? EMPTY).voids],
    fills: [...(base ?? EMPTY).fills],
    groups: [...(base ?? EMPTY).groups],
    connections: [...(base ?? EMPTY).connections],
    definedBy: [],
    containedIn: [],
  };

  const entities: readonly NewEntity[] = args.view?.getNewEntities() ?? [];
  const seenGroups = new Set(merged.groups.map((group) => group.id));

  for (const entity of entities) {
    switch (entity.type) {
      case 'IfcRelAssignsToGroup': {
        // (GlobalId, OwnerHistory, Name, Description, RelatedObjects, …, RelatingGroup)
        if (!includesElement(entity.attributes[4], args.expressId)) break;
        const groupId = refId(entity.attributes[6]) ?? refId(entity.attributes[5]);
        if (groupId === null || seenGroups.has(groupId)) break;
        const ref = args.describe(groupId);
        if (ref) { merged.groups.push(ref); seenGroups.add(groupId); }
        break;
      }
      case 'IfcRelDefinesByType': {
        // (GlobalId, OwnerHistory, Name, Description, RelatedObjects, RelatingType)
        if (!includesElement(entity.attributes[4], args.expressId)) break;
        const typeId = refId(entity.attributes[5]);
        const ref = typeId === null ? null : args.describe(typeId);
        if (ref) merged.definedBy.push(ref);
        break;
      }
      case 'IfcRelContainedInSpatialStructure': {
        // (GlobalId, OwnerHistory, Name, Description, RelatedElements, RelatingStructure)
        if (!includesElement(entity.attributes[4], args.expressId)) break;
        const containerId = refId(entity.attributes[5]);
        const ref = containerId === null ? null : args.describe(containerId);
        if (ref) merged.containedIn.push(ref);
        break;
      }
      default:
        break;
    }
  }

  const total = merged.voids.length + merged.fills.length + merged.groups.length
    + merged.connections.length + merged.definedBy.length + merged.containedIn.length;
  return total > 0 ? merged : null;
}
