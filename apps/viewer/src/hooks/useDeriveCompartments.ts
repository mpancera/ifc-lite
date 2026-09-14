/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Binds `lib/fireSafety/deriveCompartments.ts` to the store: which zones,
 * which rooms, which meshes, and whose render frame.
 *
 * One model at a time, unlike the location-zone emission which fans out over a
 * federation. A compartment is painted onto the rooms of ONE file — zone
 * membership is an express-id relationship and does not cross a model boundary
 * — so there is no federated case to handle here, only the appearance of one.
 */

import { useCallback } from 'react';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';
import { useViewerStore } from '@/store';
import { configureMutationView } from '@/utils/configureMutationView';
import { geometryVolumesSurviveAlignment } from '@/lib/compare/alignmentTrust';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { parsedZonesOf, readZones, readZonesForDisplay } from '@/lib/ifcZones/membership';
import { themeOfZone } from '@/lib/ifcZones/themes';
import { COMPARTMENT_PSET, COMPARTMENT_REQUIREMENTS } from '@/lib/fireSafety/compartmentRequirements';
import {
  deriveCompartmentBodies, type CompartmentSource, type DeriveResult,
} from '@/lib/fireSafety/deriveCompartments';
import type { PrismMesh } from '@/lib/fireSafety/roomPrism';
import type { RenderFrameOffsets } from '@/components/viewer/tools/measure-modes/coordinates';
import { resolveRenderFrame } from './useRenderFrameOffsets.js';

export interface DeriveCompartmentsResult extends DeriveResult {
  blocked: 'collab-role' | 'no-model' | 'no-zones' | null;
  modelName: string;
}

const NOTHING: DeriveCompartmentsResult = {
  outcomes: [], replaced: 0, refusal: null, blocked: null, modelName: '',
};

/**
 * This model's own offsets.
 *
 * Per model rather than per scene: an unaligned model keeps its own RTC offset
 * and origin shift, so undoing the ANCHOR's would move the body by the
 * difference between two files' origins — kilometres on a georeferenced pair,
 * and perfectly plausible in the file.
 */
function frameFor(modelId: string, scene: RenderFrameOffsets): RenderFrameOffsets {
  const info = useViewerStore.getState().models.get(modelId)?.geometryResult?.coordinateInfo;
  if (!info) return scene;
  return { originShift: info.originShift ?? null, wasmRtcOffsetIfc: info.wasmRtcOffset ?? null };
}

/** Meshes by room express id, for the rooms this run needs. */
function meshIndex(modelId: string, wanted: ReadonlySet<number>): Map<number, PrismMesh[]> {
  const state = useViewerStore.getState();
  const result = state.models.get(modelId)?.geometryResult ?? state.geometryResult;
  const byRoom = new Map<number, PrismMesh[]>();
  for (const mesh of result?.meshes ?? []) {
    // A type template is a shape library, not a placed room; including one
    // would put a prism wherever its template happens to sit.
    if ((mesh.geometryClass ?? 0) === 2) continue;
    if (!wanted.has(mesh.expressId)) continue;
    const list = byRoom.get(mesh.expressId);
    if (list) list.push(mesh as PrismMesh);
    else byRoom.set(mesh.expressId, [mesh as PrismMesh]);
  }
  return byRoom;
}

/** Derive the bodies of every compartment of `themeId` in `modelId`. */
export function deriveCompartmentsForModel(
  modelId: string,
  themeId = 'fire-compartment',
): DeriveCompartmentsResult {
  const state = useViewerStore.getState();
  if (!state.canCollabEdit()) return { ...NOTHING, blocked: 'collab-role' };

  const model = state.models.get(modelId);
  const store = (model?.ifcDataStore
    ?? (modelId === 'legacy' ? state.ifcDataStore : null)) as IfcDataStore | null;
  if (!store) return { ...NOTHING, blocked: 'no-model' };
  const modelName = model?.name ?? modelId;

  let view = state.getMutationView(modelId);
  if (!view) {
    view = new MutablePropertyView(store.properties || null, modelId);
    configureMutationView(view, store);
    state.registerMutationView(modelId, view);
  }
  let editor = state.storeEditors.get(modelId);
  if (!editor) {
    editor = new StoreEditor(store, view);
    state.storeEditors.set(modelId, editor);
  }

  const zones = readZonesForDisplay(
    parsedZonesOf(store, RelationshipType.AssignsToGroup),
    readZones(authoredEntities(view)),
  ).filter((zone) => themeOfZone(zone.objectType)?.id === themeId);
  if (zones.length === 0) return { ...NOTHING, blocked: 'no-zones', modelName };

  const sources: CompartmentSource[] = zones.map((zone) => {
    const requirements = new Map<string, string>();
    for (const requirement of COMPARTMENT_REQUIREMENTS) {
      const value = view.getPropertyValue(zone.expressId, COMPARTMENT_PSET, requirement.name);
      if (typeof value === 'string' && value !== '') requirements.set(requirement.name, value);
    }
    return {
      zoneId: zone.expressId,
      // A zone with no name would emit a nameless compartment, which is the
      // one attribute the receiving check requires.
      name: zone.name || `Brandabschnitt #${zone.expressId}`,
      memberIds: zone.memberIds,
      requirements,
    };
  });

  const wanted = new Set(sources.flatMap((source) => [...source.memberIds]));
  const meshes = meshIndex(modelId, wanted);

  const result = deriveCompartmentBodies(editor, store, sources, {
    meshesOf: (expressId) => meshes.get(expressId),
    frame: frameFor(modelId, resolveRenderFrame(state.models, state.geometryResult)),
    rebased: model ? !geometryVolumesSurviveAlignment(model.federationAlignmentStatus) : false,
    themeId,
  });

  if (result.outcomes.some((o) => o.zoneId !== null) || result.replaced > 0) {
    useViewerStore.getState().markModelsDirty([modelId]);
  }
  return { ...result, blocked: null, modelName };
}

/** React-facing handle. */
export function useDeriveCompartments() {
  return useCallback(
    (modelId: string, themeId?: string) => deriveCompartmentsForModel(modelId, themeId),
    [],
  );
}

export default useDeriveCompartments;
