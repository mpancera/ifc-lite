/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reads a rule's value sources out of a loaded model.
 *
 * The one place that knows how a scope maps onto IFC: the spatial ones come
 * from the ancestry index, the element's own from the overlay or the columnar
 * parse, and the type through the relationship the catalogue authors.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialHierarchy, SpatialNode } from '@ifc-lite/data';
import { buildSpatialAncestryIndex } from '@/utils/spatialHierarchy';
import { resolveOverlayDefiningTypeId } from '@/lib/mutations/overlayTypeLink';
import type { ValueResolver, ValueScope, ValueSource } from './types';

/** Positional index of each named attribute on an `IfcRoot` subtype. */
const ATTR_INDEX: Record<string, number> = {
  GlobalId: 0, Name: 2, Description: 3, ObjectType: 4, Tag: 7,
};

function findNode(node: SpatialNode, expressId: number): SpatialNode | null {
  if (node.expressId === expressId) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, expressId);
    if (hit) return hit;
  }
  return null;
}

export interface ModelResolverArgs {
  store: IfcDataStore;
  view: MutablePropertyView | null | undefined;
}

export function makeModelResolver({ store, view }: ModelResolverArgs): ValueResolver {
  const hierarchy: SpatialHierarchy | undefined = store.spatialHierarchy;
  const ancestry = hierarchy
    ? buildSpatialAncestryIndex(
      hierarchy,
      (id) => store.entities.getName(id),
      (id) => store.entities.getTypeName(id),
    )
    : null;

  /**
   * An entity's attribute, preferring the overlay so an element authored this
   * session — which the columnar parse has never seen — reads at all.
   */
  const attributeOf = (expressId: number, field: string): string => {
    // An edit to a REFERENCE entity — renaming a room, say — lives in the
    // overlay, while `store.entities` still reports what the file said at load.
    // Reading the parse alone is why a corrected room number produced no
    // corrected identifier: the rule kept resolving the stale name.
    const edited = view?.getAttributeMutationsForEntity?.(expressId)
      ?.find((mutation) => mutation.name === field);
    if (edited && typeof edited.value === 'string') return edited.value;

    const authored = view?.getNewEntity?.(expressId);
    if (authored) {
      const index = ATTR_INDEX[field];
      const raw = index === undefined ? undefined : authored.attributes[index];
      return typeof raw === 'string' ? raw : '';
    }
    switch (field) {
      case 'Name': return store.entities.getName(expressId) || '';
      case 'Description': return store.entities.getDescription?.(expressId) || '';
      case 'ObjectType': return store.entities.getObjectType?.(expressId) || '';
      case 'GlobalId': return store.entities.getGlobalId(expressId) || '';
      case 'Tag': return store.entities.getTag?.(expressId) || '';
      default: return '';
    }
  };

  /** A spatial container's attribute — `LongName` only exists on the tree node. */
  const spatialField = (containerId: number | undefined, field: string): string => {
    if (containerId === undefined) return '';
    if (field === 'LongName') {
      const node = hierarchy ? findNode(hierarchy.project, containerId) : null;
      return node?.longName || '';
    }
    return attributeOf(containerId, field);
  };

  const containerOf = (expressId: number): number | undefined =>
    hierarchy?.elementToContainer?.get(expressId);

  /** The room enclosing this element, or `undefined` when it sits on a storey. */
  const roomOf = (expressId: number): number | undefined => {
    const container = containerOf(expressId);
    if (container === undefined) return undefined;
    return hierarchy?.bySpace.has(container) ? container : undefined;
  };

  const resolvers: Record<ValueScope, (source: ValueSource, id: number) => string> = {
    IfcSite: (s, id) => (s.field === 'Name' ? ancestry?.siteOf(id) ?? '' : ''),
    IfcBuilding: (s, id) => (s.field === 'Name' ? ancestry?.buildingOf(id) ?? '' : ''),
    IfcBuildingStorey: (s, id) => spatialField(hierarchy?.elementToStorey.get(id), s.field),
    IfcSpace: (s, id) => spatialField(roomOf(id), s.field),
    IfcEntity: (s, id) => attributeOf(id, s.field),
    IfcEntityType: (s, id) => {
      // The catalogue links instance to type through a relationship authored
      // this session, which the parsed relationship graph cannot see.
      const typeId = resolveOverlayDefiningTypeId(view, id);
      return typeId === null ? '' : attributeOf(typeId, s.field);
    },
  };

  return (source, expressId) => resolvers[source.scope]?.(source, expressId) ?? '';
}
