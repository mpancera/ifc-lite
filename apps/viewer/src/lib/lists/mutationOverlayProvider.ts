/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Makes a `ListDataProvider` see the mutation overlay.
 *
 * `createListDataProvider` reads the parsed `IfcDataStore` only — the state of
 * the file as it was loaded. Anything authored during the session (a placed
 * element, an edited attribute, a deleted entity) lives in the
 * `MutablePropertyView` overlay instead, so a list rendered straight from the
 * base provider shows the file as it was, not as it is. The Hierarchy tree and
 * the Properties panel each already merge the overlay at their own read sites;
 * this decorator does the same for lists, without the `@ifc-lite/lists`
 * package having to know the overlay exists.
 */

import type { PropertySet, QuantitySet } from '@ifc-lite/data';
import { IfcTypeEnumFromString } from '@ifc-lite/data';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { ListDataProvider } from '@ifc-lite/lists';
import { buildOverlayRelationIndex } from '@/lib/mutations/overlayRelationIndex';
import { resolveOverlayDefiningTypeId } from '@/lib/mutations/overlayTypeLink';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { readZones } from '@/lib/ifcZones/membership';

/** Positional index of each named attribute in an `IfcRoot`-derived entity's
 *  STEP argument list. `Tag` sits at 7 for `IfcElement` subtypes, which is what
 *  the element catalogue authors. */
const ATTR_INDEX = { GlobalId: 0, Name: 2, Description: 3, ObjectType: 4, Tag: 7 } as const;

/** Reads a positional attribute off an overlay entity as a display string. */
function attrString(attributes: readonly unknown[] | undefined, index: number): string {
  const raw = attributes?.[index];
  return typeof raw === 'string' ? raw : '';
}

export interface MutationOverlayProviderOptions {
  /**
   * Which authored entities may appear as list ROWS. Authoring an element also
   * creates its placement, profile, solid and shape-representation entities;
   * those are geometry plumbing, not products, and must not become rows. The
   * caller decides (the viewer knows which overlay ids ended up with a mesh) —
   * omitted, every authored entity is treated as a row, which is only right
   * for tests and callers that author products exclusively.
   *
   * The IFC class is passed alongside the id because the obvious test — "is it
   * registered against a storey" — silently excludes everything that has no
   * storey by definition: an `IfcZone` groups rooms and sits nowhere in space,
   * so a zone list built on that test alone comes back empty.
   */
  isRowEntity?: (expressId: number, ifcType: string) => boolean;
}

/**
 * Wrap `base` so reads resolve against the overlay first, falling back to the
 * parsed store. Returns `base` untouched when there is no overlay, so a model
 * that was never edited pays nothing.
 */
export function withMutationOverlay(
  base: ListDataProvider,
  view: MutablePropertyView | null | undefined,
  options: MutationOverlayProviderOptions = {},
): ListDataProvider {
  if (!view) return base;

  // `authoredEntities`, not `getNewEntities`: the latter reports the attributes
  // an entity was CREATED with, so a zone renamed or recoloured afterwards
  // would read back stale here while the exporter wrote the new value.
  const newEntities = authoredEntities(view);
  const tombstones = view.getTombstones();
  if (newEntities.length === 0 && tombstones.size === 0 && view.getMutations().length === 0) {
    return base;
  }

  const isRowEntity = options.isRowEntity ?? (() => true);

  const overlayById = new Map(newEntities.map((e) => [e.expressId, e] as const));
  const rowIdsByType = new Map<number, number[]>();
  for (const entity of newEntities) {
    if (!isRowEntity(entity.expressId, entity.type)) continue;
    const typeEnum = IfcTypeEnumFromString(entity.type);
    let bucket = rowIdsByType.get(typeEnum);
    if (!bucket) { bucket = []; rowIdsByType.set(typeEnum, bucket); }
    bucket.push(entity.expressId);
  }

  // Zone membership authored this session, indexed room → zones. The parsed
  // relationship graph cannot know about it, so a `group` column would show
  // only the memberships the file arrived with.
  const overlayGroupsOf = new Map<number, Array<{ name: string; ifcType: string }>>();
  for (const zone of readZones(newEntities)) {
    const ref = { name: zone.name || `IfcZone #${zone.expressId}`, ifcType: 'IfcZone' };
    for (const memberId of zone.memberIds) {
      const list = overlayGroupsOf.get(memberId);
      if (list) list.push(ref);
      else overlayGroupsOf.set(memberId, [ref]);
    }
  }

  const alive = (id: number) => !tombstones.has(id);

  /**
   * An edited attribute wins over both the overlay entity's own argument list
   * and the parsed store. `getAttributeMutationsForEntity` is keyed by the same
   * canonical names the Properties panel writes ('Name', 'Tag', …).
   */
  function editedAttr(id: number, name: string): string | null {
    for (const m of view!.getAttributeMutationsForEntity(id)) {
      if (m.name === name) return m.value;
    }
    return null;
  }

  function readAttr(
    id: number,
    name: keyof typeof ATTR_INDEX,
    fromBase: (id: number) => string,
  ): string {
    const edited = editedAttr(id, name);
    if (edited !== null) return edited;
    const authored = overlayById.get(id);
    if (authored) return attrString(authored.attributes, ATTR_INDEX[name]);
    return fromBase(id);
  }

  const overlayDefiningTypeId = (entityId: number) => resolveOverlayDefiningTypeId(view, entityId);

  /**
   * The spatial containers this session authored, indexed once.
   *
   * The base provider builds its ancestry out of `store.spatialHierarchy` and
   * `store.entities.getName` — both the parsed file. A room drawn in this
   * session is in neither, so a device placed into it had no room, and the
   * column fell back to the container's CLASS: every detector reading
   * "unknown" while the model plainly had rooms.
   */
  const relations = buildOverlayRelationIndex([...view.getNewEntities()]);

  /**
   * Every spatial ancestor of `id`, nearest first.
   *
   * Both edges are walked because a device carries both: the placement anchors
   * it to the storey, and drawing it into a room adds the room. Which of the
   * two comes back first is an accident of insertion order, so nothing here
   * may depend on it — see `spatialPick`.
   */
  function overlayAncestors(id: number): number[] {
    const out: number[] = [];
    const seen = new Set<number>([id]);
    const queue: number[] = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const parents = [
        ...relations.related(current, 'IfcRelContainedInSpatialStructure', 'inverse'),
        ...relations.related(current, 'IfcRelAggregates', 'inverse'),
      ];
      for (const parent of parents) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        out.push(parent);
        queue.push(parent);
      }
    }
    return out;
  }

  /** The nearest ancestor that is one of `kinds`, or `null`. */
  function overlayAncestorOf(id: number, kinds: ReadonlySet<string>): number | null {
    for (const ancestor of overlayAncestors(id)) {
      const type = overlayById.get(ancestor)?.type;
      if (type && kinds.has(type)) return ancestor;
    }
    return null;
  }

  /**
   * How specific a spatial class is. Higher wins.
   *
   * A device sitting in a room is also, truthfully, in that room's storey. The
   * Container column wants the innermost of the two: answering with the storey
   * when a room exists throws away the only part of the answer the reader did
   * not already know.
   */
  const SPATIAL_RANK: Readonly<Record<string, number>> = {
    IfcSpace: 4,
    IfcBuildingStorey: 3,
    IfcBuilding: 2,
    IfcSite: 1,
  };

  /** The innermost spatial ancestor of `id`, or `null`. */
  function spatialPick(id: number): number | null {
    let best: number | null = null;
    let bestRank = 0;
    for (const ancestor of overlayAncestors(id)) {
      const rank = SPATIAL_RANK[overlayById.get(ancestor)?.type ?? ''] ?? 0;
      // Strictly greater: ties keep the nearer one, which is the earlier entry.
      if (rank > bestRank) {
        best = ancestor;
        bestRank = rank;
      }
    }
    return best;
  }

  /** An overlay entity's Name, edits included. `''` when it has none. */
  function overlayNameOf(id: number | null): string {
    if (id === null) return '';
    const edited = editedAttr(id, 'Name');
    if (edited !== null) return edited;
    const authored = overlayById.get(id);
    return authored ? attrString(authored.attributes, ATTR_INDEX.Name) : '';
  }

  const SPACE_KINDS = new Set(['IfcSpace']);
  const STOREY_KINDS = new Set(['IfcBuildingStorey']);
  const BUILDING_KINDS = new Set(['IfcBuilding']);


  return {
    ...base,

    getEntitiesByType(type) {
      const authored = rowIdsByType.get(type) ?? [];
      const existing = base.getEntitiesByType(type).filter(alive);
      return authored.length === 0 ? existing : [...existing, ...authored];
    },

    getAllEntityIds(): number[] {
      const existing = (base.getAllEntityIds?.() ?? []).filter(alive);
      const authored: number[] = [];
      for (const entity of newEntities) {
        if (isRowEntity(entity.expressId, entity.type)) authored.push(entity.expressId);
      }
      return authored.length === 0 ? existing : [...existing, ...authored];
    },

    getEntityGroupNames(id: number): Array<{ name: string; ifcType: string }> {
      const authored = overlayGroupsOf.get(id) ?? [];
      const existing = base.getEntityGroupNames?.(id) ?? [];
      // Authored first, mirroring the lens adapter: a room is usually already
      // in some zone the file shipped with, and the one just painted is the
      // answer the user is looking for.
      return authored.length === 0 ? existing : [...authored, ...existing];
    },

    getEntityTypeName: (id) => overlayById.get(id)?.type ?? base.getEntityTypeName(id),

    // Spatial columns, overlay first. Each falls through to the parsed file
    // when this session authored nothing for the element, so a model nobody
    // has edited behaves exactly as before.
    getSpaceName(id: number): string {
      const room = overlayAncestorOf(id, SPACE_KINDS);
      // A room with no name is still a room: answering with the file's blank
      // is right, and falling through would report the storey instead.
      if (room !== null) return overlayNameOf(room);
      return base.getSpaceName?.(id) ?? '';
    },
    getContainerName(id: number): string {
      const container = spatialPick(id);
      if (container !== null) return overlayNameOf(container) || overlayById.get(container)?.type || '';
      return base.getContainerName?.(id) ?? '';
    },
    getStoreyName(id: number): string {
      const storey = overlayAncestorOf(id, STOREY_KINDS);
      if (storey !== null) return overlayNameOf(storey);
      return base.getStoreyName?.(id) ?? '';
    },
    getBuildingName(id: number): string {
      const building = overlayAncestorOf(id, BUILDING_KINDS);
      if (building !== null) return overlayNameOf(building);
      return base.getBuildingName?.(id) ?? '';
    },
    getEntityName: (id) => readAttr(id, 'Name', base.getEntityName),
    getEntityGlobalId: (id) => readAttr(id, 'GlobalId', base.getEntityGlobalId),
    getEntityDescription: (id) => readAttr(id, 'Description', base.getEntityDescription),
    getEntityObjectType: (id) => readAttr(id, 'ObjectType', base.getEntityObjectType),
    getEntityTag: (id) => readAttr(id, 'Tag', base.getEntityTag),

    getEntityPredefinedType(id: number): string {
      const authored = overlayById.get(id);
      if (!authored) return base.getEntityPredefinedType?.(id) ?? '';
      // Written as a trailing STEP enum literal (`.SMOKESENSOR.`) when the
      // catalogue entry declares one; absent on IFC2X3 and on entries without.
      const last = authored.attributes[authored.attributes.length - 1];
      return typeof last === 'string' && /^\.[A-Z0-9_]+\.$/.test(last) ? last.slice(1, -1) : '';
    },

    getPropertySets: (id) => view.getForEntity(id) as PropertySet[],
    getQuantitySets: (id) => view.getQuantitiesForEntity(id) as QuantitySet[],

    getTypePropertySets(id: number): PropertySet[] {
      const fromBase = base.getTypePropertySets?.(id) ?? [];
      if (fromBase.length > 0) return fromBase;
      const typeId = overlayDefiningTypeId(id);
      return typeId === null ? [] : (view.getForEntity(typeId) as PropertySet[]);
    },

    getTypeQuantitySets(id: number): QuantitySet[] {
      const fromBase = base.getTypeQuantitySets?.(id) ?? [];
      if (fromBase.length > 0) return fromBase;
      const typeId = overlayDefiningTypeId(id);
      return typeId === null ? [] : (view.getQuantitiesForEntity(typeId) as QuantitySet[]);
    },

    getEntityDefiningTypeName(id: number): string {
      const fromBase = base.getEntityDefiningTypeName?.(id) ?? '';
      if (fromBase) return fromBase;
      const typeId = overlayDefiningTypeId(id);
      if (typeId === null) return '';
      const typeEntity = overlayById.get(typeId);
      return typeEntity ? attrString(typeEntity.attributes, ATTR_INDEX.Name) : '';
    },
  };
}
