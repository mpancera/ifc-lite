/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where each loaded model thinks its IFC (0,0,0) is, in viewer space.
 *
 * Extracted so the 3D basepoint markers and the plan's origin marker read the
 * same answer. Two derivations of "where is the origin" is precisely the bug
 * this feature exists to expose — a federation alignment problem — and having
 * the two views disagree about it would make the diagnostic itself untrustworthy.
 *
 * Derived from each model's IfcMapConversion against the anchor's, NOT from
 * baked vertex positions, so it stays correct after a re-align and across
 * cross-CRS reprojection.
 */

import { useEffect, useMemo, useState } from 'react';
import { useViewerStore } from '@/store';
import {
  computeIfcOriginViewerPosition,
  type IfcOriginPlacement,
  type ModelGeorefInput,
} from '@/lib/geo/ifc-origin';
import { getEffectiveGeoreference } from '@/lib/geo/effective-georef';
import { selectAnchorGeoref } from '@/lib/geo/useAnchorGeoreference';
import type { FederatedModel } from '@/store/types';
import type { IfcDataStore } from '@ifc-lite/parser';

export interface ModelOrigin {
  modelId: string;
  modelName: string;
  status: FederatedModel['federationAlignmentStatus'] | 'anchor' | 'none';
  /** Viewer-space (Y-up) position of the model's IFC (0,0,0) point. */
  viewer: { x: number; y: number; z: number };
  /** Where the placement came from, as a debug hint. */
  origin: IfcOriginPlacement['source'];
}

/**
 * @param enabled Skip the work entirely when nothing is going to draw it —
 *   this walks every model and awaits a projection per model.
 */
export function useModelOrigins(enabled: boolean): ModelOrigin[] {
  const models = useViewerStore((s) => s.models);
  const anchorModelIdOverride = useViewerStore((s) => s.anchorModelIdOverride);
  const georefMutations = useViewerStore((s) => s.georefMutations);
  // Re-derive when any georef edit lands.
  useViewerStore((s) => s.mutationVersion);

  const [origins, setOrigins] = useState<ModelOrigin[]>([]);

  // The anchor's georef input, computed once per dependency change. Shares the
  // "user-pinned anchor, else earliest-loaded model with a usable
  // map-conversion georef" selection with the measure-tool readout.
  const anchorInput = useMemo((): { id: string | null; input: ModelGeorefInput | null } => {
    const selection = selectAnchorGeoref({ models, anchorModelIdOverride, georefMutations });
    if (!selection) return { id: null, input: null };
    const model = models.get(selection.modelId);
    return {
      id: selection.modelId,
      input: {
        coordinateInfo: selection.coordinateInfo,
        mapConversion: selection.eff.mapConversion,
        projectedCRS: selection.eff.projectedCRS,
        lengthUnitScale: selection.eff.lengthUnitScale,
        preAlignmentCoordinateInfo: model?.preAlignmentCoordinateInfo,
      },
    };
  }, [models, anchorModelIdOverride, georefMutations]);

  useEffect(() => {
    if (!enabled) {
      setOrigins((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    let cancelled = false;

    (async () => {
      const results: ModelOrigin[] = [];
      for (const [modelId, model] of models) {
        if (!model.visible) continue;
        const ds = model.ifcDataStore;
        if (!ds) continue;
        const eff = getEffectiveGeoreference(
          ds as IfcDataStore,
          model.geometryResult?.coordinateInfo,
          georefMutations.get(modelId),
        );
        const modelInput: ModelGeorefInput = {
          coordinateInfo: model.geometryResult?.coordinateInfo,
          mapConversion: eff?.mapConversion,
          projectedCRS: eff?.projectedCRS,
          lengthUnitScale: eff?.lengthUnitScale,
          preAlignmentCoordinateInfo: model.preAlignmentCoordinateInfo,
        };
        const anchorIsThis = anchorInput.id === modelId;
        const placement = await computeIfcOriginViewerPosition(
          modelInput,
          anchorIsThis ? null : anchorInput.input,
        );
        if (!placement) continue;
        results.push({
          modelId,
          modelName: model.name,
          status: anchorIsThis ? 'anchor' : (model.federationAlignmentStatus ?? 'none'),
          viewer: placement.viewer,
          origin: placement.source,
        });
      }
      if (!cancelled) setOrigins(results);
    })();

    return () => { cancelled = true; };
  }, [enabled, models, anchorInput, georefMutations]);

  return origins;
}

export default useModelOrigins;
