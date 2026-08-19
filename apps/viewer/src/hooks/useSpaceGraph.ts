/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The space graph for the storey being drawn.
 *
 * Assembles what `lib/spaceGraph` needs out of the same two sources the plan
 * already uses, so the graph can never describe a different building than the
 * drawing does:
 *
 * - **Rooms** from the spatial hierarchy under the storey in scope, exactly as
 *   `usePlanRoomLabels` picks them — including spaces authored this session.
 * - **Doors** from the geometry, measured by `openingGeometry` — the SAME
 *   function that places the swing arc, so a route crosses a doorway where the
 *   drawing shows one.
 *
 * # Single model only
 * Express ids here are local, so a federation would collide two buildings'
 * rooms. The same restriction `usePlanRoomLabels` carries, for the same reason.
 */

import { useMemo } from 'react';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import { IfcTypeEnum, type SpatialNode } from '@ifc-lite/data';
import { useViewerStore } from '@/store';
import { roomFootprint, type RoomMesh } from '@/lib/plan/roomLabels';
import { planAxes, openingWidth } from '@/lib/plan/openingSymbols';
import { openingGeometry, placementOf } from './usePlanOpeningSymbols';
import {
  buildSpaceGraph, pointInSpace,
  type SpaceGraph, type SpaceNode, type DoorNode,
} from '@/lib/spaceGraph/spaceGraph';

export interface UseSpaceGraphOptions {
  /** Off entirely unless something is actually routing. */
  enabled: boolean;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  modelId: string | null;
  storeyId: number | null;
}

/** Every `IfcSpace` under a storey, by express id. */
function spacesUnderStorey(root: SpatialNode, storeyId: number): Map<number, SpatialNode> {
  const out = new Map<number, SpatialNode>();

  const collect = (node: SpatialNode) => {
    if (node.type === IfcTypeEnum.IfcSpace) out.set(node.expressId, node);
    for (const child of node.children) collect(child);
  };

  const find = (node: SpatialNode): boolean => {
    if (node.expressId === storeyId) {
      for (const child of node.children) collect(child);
      return true;
    }
    return node.children.some(find);
  };

  find(root);
  return out;
}

/**
 * Every triangle of a room, projected into drawing space and flattened.
 *
 * Drawing x is world x and drawing y is world z — the mapping `planPick.ts`
 * pins and `roomLabels.ts` projects into.
 */
function projectTriangles(meshes: readonly RoomMesh[]): Float32Array {
  let count = 0;
  for (const mesh of meshes) count += mesh.indices.length / 3;

  const out = new Float32Array(count * 6);
  let at = 0;

  for (const mesh of meshes) {
    const { positions, indices } = mesh;
    const ox = mesh.origin?.[0] ?? 0;
    const oz = mesh.origin?.[2] ?? 0;
    for (let i = 0; i + 2 < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      out[at] = positions[ia] + ox; out[at + 1] = positions[ia + 2] + oz;
      out[at + 2] = positions[ib] + ox; out[at + 3] = positions[ib + 2] + oz;
      out[at + 4] = positions[ic] + ox; out[at + 5] = positions[ic + 2] + oz;
      at += 6;
    }
  }
  return out;
}

/**
 * The middle of a mesh in drawing space, for asking which room it stands in.
 *
 * The centre of the axis-aligned box is enough here: the question is only
 * which room a stair is in, and a stair whose box centre falls in a different
 * room than its treads do is a stair spanning two rooms, where either answer
 * is defensible.
 */
function meshCentre(mesh: MeshData): { x: number; y: number } | null {
  const p = mesh.positions;
  if (!p || p.length < 3) return null;

  const ox = mesh.origin?.[0] ?? 0;
  const oz = mesh.origin?.[2] ?? 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i] + ox;
    const y = p[i + 2] + oz;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * The rooms and doors of the storey, as a graph.
 *
 * `null` while there is nothing to build from, so a caller can tell "not ready"
 * from "a building with no rooms" — the second is a real answer and means the
 * model carries no `IfcSpace`, which is worth telling the author.
 */
export function useSpaceGraph({
  enabled, geometryResult, dataStore, modelId, storeyId,
}: UseSpaceGraphOptions): SpaceGraph | null {
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  return useMemo((): SpaceGraph | null => {
    if (!enabled || !dataStore || storeyId === null) return null;
    const hierarchy = dataStore.spatialHierarchy;
    if (!hierarchy?.project) return null;

    const spaceNodes = spacesUnderStorey(hierarchy.project, storeyId);
    const meshes = geometryResult?.meshes ?? [];

    // One pass over every mesh, collecting rooms and doors together: a storey
    // against a hundred thousand meshes is one scan, not one per room.
    const roomMeshes = new Map<number, RoomMesh[]>();
    const doorMeshes = new Map<number, MeshData[]>();
    // Where stairs stand, for settling what a name like "Erschliessung" leaves
    // open — see `lib/spaceGraph/circulation.ts`. Points rather than meshes:
    // all the classification asks is whether a stair is IN a room.
    const stairPoints: { x: number; y: number }[] = [];

    for (const mesh of meshes) {
      // Instanced type templates are shape libraries, not placed things.
      if ((mesh.geometryClass ?? 0) === 2) continue;

      if (spaceNodes.has(mesh.expressId)) {
        const list = roomMeshes.get(mesh.expressId);
        if (list) list.push(mesh);
        else roomMeshes.set(mesh.expressId, [mesh]);
        continue;
      }

      const typeName = dataStore.entities?.getTypeName?.(mesh.expressId);
      if (typeName === 'IfcDoor') {
        const list = doorMeshes.get(mesh.expressId);
        if (list) list.push(mesh);
        else doorMeshes.set(mesh.expressId, [mesh]);
        continue;
      }

      if (typeName === 'IfcStair' || typeName === 'IfcStairFlight') {
        const centre = meshCentre(mesh);
        if (centre) stairPoints.push(centre);
      }
    }

    const spaces: SpaceNode[] = [];
    for (const [expressId, list] of roomMeshes) {
      const node = spaceNodes.get(expressId);
      const footprint = roomFootprint(list);
      // A space with no geometry has nowhere on the drawing to be walked
      // through, so it cannot take part in a route.
      if (!node || !footprint) continue;

      const triangles = projectTriangles(list);
      const candidate: SpaceNode = {
        id: expressId,
        name: node.longName?.trim() || node.name?.trim() || `#${expressId}`,
        // `PredefinedType` is not on the hierarchy node, so the usage comes
        // from the name for now — `isStairwell` reads both and most exports
        // put the meaning in the name anyway.
        usage: null,
        area: footprint.area,
        labelPoint: footprint.anchor,
        triangles,
        storeyId,
      };

      spaces.push({
        ...candidate,
        containsStair: stairPoints.some((point) => pointInSpace(point, candidate)),
      });
    }

    const doors: DoorNode[] = [];
    for (const [expressId, list] of doorMeshes) {
      const axes = planAxes(placementOf(list));
      // A door lying flat in a ceiling has no direction in plan; routing
      // through it would be routing through a NaN.
      if (!axes) continue;

      const geometry = openingGeometry(list, axes);
      if (!geometry) continue;

      doors.push({
        id: expressId,
        name: `#${expressId}`,
        centre: geometry.centre,
        along: axes.along,
        across: axes.across,
        width: openingWidth(geometry.extent, null),
        storeyId,
      });
    }

    return buildSpaceGraph(spaces, doors);
    // `mutationVersion` bumps on every authoring edit, so a room or door added
    // a moment ago joins the graph without reloading the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geometryResult, dataStore, modelId, storeyId, mutationViews, mutationVersion]);
}

export default useSpaceGraph;
