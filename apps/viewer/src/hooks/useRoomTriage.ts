/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Every room of the active model, in the shape the Clean Rooms panel checks.
 *
 * # Whole model, not one storey
 * `usePlanRoomLabels` answers the same question for the storey being drawn,
 * because a label belongs to a drawing. Cleaning does not: the work is "what
 * is still open in this building", and a panel that could only see the storey
 * behind the plan would hide the rest of the job.
 *
 * # The overlay is asked first, everywhere
 * A room renamed a second ago lives in the mutation overlay, not in the parsed
 * buffer — so name, description and `ObjectType` all read the overlay first,
 * and a space deleted in this session drops out via `isDeleted`. Without that
 * the list would keep offering a room that is already gone, which is the one
 * thing that would make people stop trusting the count.
 *
 * # Single model
 * `spatialHierarchy` is keyed by LOCAL express ids, so a federation would mix
 * two buildings' rooms under one storey. Same restriction the storey picker
 * and the plan labels already carry.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult } from '@ifc-lite/geometry';
import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';
import { GENERATED_SPACE_OBJECTTYPE } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import {
  roomFootprint, roomAreaFromQuantities, type RoomMesh, type QuantitySetLike,
} from '@/lib/plan/roomLabels';
import { areaUnitScaleFor } from '@/lib/units/measure-scales';
import type { RoomRecord } from '@/lib/roomTriage/roomChecks';

/** `IfcObject.ObjectType` sits at index 4 for every descendant of IfcProduct. */
const OBJECT_TYPE_INDEX = 4;

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return s === '$' || s === '*' ? '' : s;
}

/** The rooms of a model, paired with the storey they hang under. */
interface StoreySpace {
  readonly storey: SpatialNode;
  readonly space: SpatialNode;
}

function spacesByStorey(root: SpatialNode): StoreySpace[] {
  const out: StoreySpace[] = [];

  const collect = (node: SpatialNode, storey: SpatialNode) => {
    // A space can nest (a flat holding its rooms), so recurse through one.
    if (node.type === IfcTypeEnum.IfcSpace) out.push({ storey, space: node });
    for (const child of node.children) collect(child, storey);
  };

  const walk = (node: SpatialNode) => {
    if (node.type === IfcTypeEnum.IfcBuildingStorey) {
      for (const child of node.children) collect(child, node);
      return;
    }
    for (const child of node.children) walk(child);
  };

  walk(root);
  return out;
}

/** Meshes per space, from one pass over the model rather than one per room. */
function meshesBySpace(
  geometry: GeometryResult | null | undefined,
  wanted: ReadonlySet<number>,
): Map<number, RoomMesh[]> {
  const out = new Map<number, RoomMesh[]>();
  for (const mesh of geometry?.meshes ?? []) {
    // Instanced type templates are shape libraries, not placed rooms.
    if ((mesh.geometryClass ?? 0) === 2) continue;
    if (!wanted.has(mesh.expressId)) continue;
    const list = out.get(mesh.expressId);
    if (list) list.push(mesh);
    else out.set(mesh.expressId, [mesh]);
  }
  return out;
}

export interface RoomTriageSource {
  readonly records: readonly RoomRecord[];
  /** Which model they came from — the panel writes back into it. */
  readonly modelId: string | null;
  /** Present so a panel can say "kein Modell" rather than "keine Räume". */
  readonly hasModel: boolean;
}

export function useRoomTriage(enabled: boolean): RoomTriageSource {
  const models = useViewerStore((state) => state.models);
  const activeModelId = useViewerStore((state) => state.activeModelId);
  const mutationViews = useViewerStore((state) => state.mutationViews);
  // The overlay is mutated in place, so the Map identity never changes; this
  // counter is what makes a rename or a discard reach the list.
  const mutationVersion = useViewerStore((state) => state.mutationVersion);

  return useMemo((): RoomTriageSource => {
    const model = (activeModelId ? models.get(activeModelId) : null) ?? [...models.values()][0];
    const store: IfcDataStore | null | undefined = model?.ifcDataStore;
    if (!enabled || !model || !store) {
      return { records: [], modelId: model?.id ?? null, hasModel: !!store };
    }

    const project = store.spatialHierarchy?.project;
    if (!project) return { records: [], modelId: model.id, hasModel: true };

    const overlay = mutationViews.get(model.id);
    const pairs = spacesByStorey(project);
    const geometry = meshesBySpace(
      model.geometryResult,
      new Set(pairs.map((pair) => pair.space.expressId)),
    );
    const areaUnitScale = areaUnitScaleFor(store);

    const attribute = (expressId: number, name: string): string | null => {
      const mutated = overlay?.getAttributeMutationsForEntity?.(expressId)
        ?.find((a) => a.name === name)?.value;
      return mutated === undefined ? null : text(mutated);
    };

    const records: RoomRecord[] = [];
    for (const { storey, space } of pairs) {
      const expressId = space.expressId;
      if (overlay?.isDeleted?.(expressId)) continue;

      const parsedObjectType = text(store.getEntity?.(expressId)?.attributes?.[OBJECT_TYPE_INDEX]);
      const objectType = attribute(expressId, 'ObjectType') ?? parsedObjectType;

      // GEOMETRY FIRST, unlike the plan label — deliberately.
      //
      // The label prints what the model SAYS, because that is the number the
      // room schedule was written against. This panel asks a different
      // question: is this polygon a room at all, and only the footprint
      // answers that. It also survives a file whose stated quantities are in
      // the wrong unit — which happens, and which is invisible in a number
      // that merely looks small.
      const meshes = geometry.get(expressId) ?? [];
      const footprint = meshes.length > 0 ? roomFootprint(meshes) : null;
      const quantities: QuantitySetLike[] =
        overlay?.getQuantitiesForEntity?.(expressId) ?? store.getQuantities?.(expressId) ?? [];
      const stated = roomAreaFromQuantities(quantities, areaUnitScale);

      records.push({
        key: String(expressId),
        expressId,
        storeyId: storey.expressId,
        storeyName: text(storey.name) || `#${storey.expressId}`,
        number: attribute(expressId, 'Name') ?? text(space.name),
        description: attribute(expressId, 'LongName') ?? text(space.longName),
        area: footprint?.area ?? stated?.value ?? null,
        derived: objectType === GENERATED_SPACE_OBJECTTYPE,
      });
    }

    return { records, modelId: model.id, hasModel: true };
    // `mutationVersion` is a deliberate dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, models, activeModelId, mutationViews, mutationVersion]);
}

export default useRoomTriage;
