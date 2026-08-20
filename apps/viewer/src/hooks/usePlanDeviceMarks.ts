/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The devices on the storey being drawn, as marks.
 *
 * # Taken from the STOREY, not from the cut
 * A ceiling detector is above the cut and a floor socket is below what the
 * projection shows; neither is in the drawing at all. So this cannot be a
 * decoration of the section — it is the only thing that puts these elements on
 * the plan, and it asks the storey which ones belong to it.
 *
 * # Single model only
 * `elementToStorey` is keyed by LOCAL express ids, the same restriction the
 * storey picker, the room labels and the opening symbols already carry.
 */

import { useMemo } from 'react';
import { useViewerStore } from '@/store';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { GeometryResult, MeshData } from '@ifc-lite/geometry';
import { deviceSymbolKind, type DeviceMark } from '@/lib/plan/deviceSymbols';
import type { PlanElementTest } from '@/lib/plan/planVisibility';
import { overlayAttribute } from '@/lib/mutations/overlayAttribute';

export interface UsePlanDeviceMarksOptions {
  enabled: boolean;
  /** Which model the express ids belong to, for reading the authoring overlay. */
  modelId?: string | null;
  geometryResult: GeometryResult | null | undefined;
  dataStore: IfcDataStore | null | undefined;
  storeyId: number | null;
  /** Whether the plan draws this element — see `lib/plan/planVisibility`. */
  drawsElement?: PlanElementTest;
}

/**
 * The middle of an element's footprint, in drawing coordinates.
 *
 * The bounding box's middle rather than a centroid: a device is a small,
 * roughly symmetric object, the two agree to within its own size, and the box
 * costs one pass where a centroid costs triangles. Drawing x IS world x and
 * drawing y IS world z — the mapping `planPick.ts` pins.
 */
function footprintCentre(meshes: readonly MeshData[]): { x: number; y: number } | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const mesh of meshes) {
    const ox = mesh.origin?.[0] ?? 0;
    const oz = mesh.origin?.[2] ?? 0;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const x = p[i] + ox;
      const y = p[i + 2] + oz;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * A STEP enum out of an overlay-authored entity's attributes: `.SMOKESENSOR.`
 *
 * Searched from the END rather than by index: `PredefinedType` is the last
 * attribute on every device entity this draws (IfcSensor, IfcAlarm, IfcActuator
 * and the rest of IfcDistributionControlElement), but at different positions,
 * and one table per entity would be a table to keep in step with the schema.
 */
function overlayPredefinedType(attributes: readonly unknown[]): string | null {
  for (let i = attributes.length - 1; i >= 0; i -= 1) {
    const value = attributes[i];
    if (typeof value !== 'string') continue;
    const match = /^\.([A-Z0-9_]+)\.$/.exec(value);
    if (match) return match[1];
  }
  return null;
}

/**
 * The number the numbering rule assigned, or an empty string.
 *
 * `MutablePropertyView.getPropertyValue` already resolves in the right order —
 * a pending mutation, then a property set created this session, then the
 * parsed file — so this is a thin read rather than a third place that decides
 * what wins. Without an overlay the parsed store is asked directly, which is
 * the case for a model nobody has edited.
 */
function readAssetIdentifier(
  overlay: MutablePropertyView | undefined,
  dataStore: { properties?: { getForEntity(id: number): readonly { name: string; properties: readonly { name: string; value: unknown }[] }[] } },
  expressId: number,
): string {
  const fromOverlay = overlay?.getPropertyValue(expressId, IDENTIFIER_PSET, IDENTIFIER_PROP);
  if (typeof fromOverlay === 'string' && fromOverlay.trim()) return fromOverlay.trim();
  if (typeof fromOverlay === 'number') return String(fromOverlay);
  if (overlay) return '';

  const pset = dataStore.properties?.getForEntity(expressId)
    ?.find((candidate) => candidate.name === IDENTIFIER_PSET);
  const value = pset?.properties.find((p) => p.name === IDENTIFIER_PROP)?.value;
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** Where the numbering rule writes. The standard occurrence pset. */
const IDENTIFIER_PSET = 'Pset_ConstructionOccurence';
const IDENTIFIER_PROP = 'AssetIdentifier';

export function usePlanDeviceMarks({
  enabled, geometryResult, dataStore, storeyId, drawsElement, modelId,
}: UsePlanDeviceMarksOptions): DeviceMark[] {
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  return useMemo((): DeviceMark[] => {
    if (!enabled || !dataStore || storeyId === null) return [];
    const elementToStorey = dataStore.spatialHierarchy?.elementToStorey;
    if (!elementToStorey) return [];

    // Keyed on `occurrenceKey`, not on `expressId`: a repeated device type is
    // GPU-instanced and every occurrence carries the same express id, so the
    // express id alone would collapse a hundred detectors into one mark
    // somewhere between them. The same trap the opening symbols already fell
    // into once.
    const byDevice = new Map<string, { expressId: number; ifcType: string; meshes: MeshData[] }>();
    for (const mesh of geometryResult?.meshes ?? []) {
      if ((mesh.geometryClass ?? 0) === 2) continue;
      const ifcType = mesh.ifcType;
      if (!ifcType || !deviceSymbolKind(ifcType)) continue;
      if (elementToStorey.get(mesh.expressId) !== storeyId) continue;
      // A deleted detector keeps its mesh in the buffer; its mark would stay
      // on the plan after the device is gone.
      if (drawsElement && !drawsElement(mesh.expressId)) continue;

      const key = mesh.occurrenceKey ?? String(mesh.expressId);
      const entry = byDevice.get(key);
      if (entry) entry.meshes.push(mesh);
      else byDevice.set(key, { expressId: mesh.expressId, ifcType, meshes: [mesh] });
    }
    if (byDevice.size === 0) return [];

    const overlay = modelId
      ? mutationViews.get(modelId === 'legacy' ? '__legacy__' : modelId)
      : undefined;
    // A device authored this session has no row in the parsed store at all,
    // and one renamed this session has a stale one — the mark has to read the
    // overlay first or a fresh Melderkennzeichen appears only after a reload.
    const overlayAttributes = new Map<number, readonly unknown[]>();
    if (overlay) {
      for (const entity of overlay.getNewEntities()) {
        overlayAttributes.set(entity.expressId, entity.attributes);
      }
    }

    const marks: DeviceMark[] = [];
    for (const [key, { expressId, ifcType, meshes }] of byDevice) {
      const kind = deviceSymbolKind(ifcType);
      if (!kind) continue;
      const position = footprintCentre(meshes);
      if (!position) continue;
      const authored = overlayAttributes.get(expressId);
      // The MARK first: `Tag` is what a device carries on a drawing, and where
      // a Meldergruppe has given one it is the thing to print. The product
      // name ("Rauchmelder") is what stands in until then — and stays in the
      // tooltip either way.
      const tag = overlayAttribute(overlay, expressId, 'Tag')
        ?? (typeof authored?.[7] === 'string' ? authored[7] : null)
        ?? dataStore.entities?.getTag?.(expressId)
        ?? '';
      const name = tag || overlayAttribute(overlay, expressId, 'Name')
        || (typeof authored?.[2] === 'string' ? authored[2] : null)
        || dataStore.entities?.getName(expressId) || '';
      const objectType = overlayAttribute(overlay, expressId, 'ObjectType')
        ?? (typeof authored?.[4] === 'string' ? authored[4] : null)
        ?? dataStore.entities?.getObjectType?.(expressId) ?? '';

      // Straight off the overlay view, which answers from the session's edits
      // first and the parsed file second. Both, and in that order: a detector
      // numbered a moment ago has no row in the parsed store at all, and one
      // renumbered this session has a stale one.
      const assetIdentifier = readAssetIdentifier(overlay, dataStore, expressId);

      marks.push({
        key,
        expressId,
        kind,
        position,
        name,
        tag,
        assetIdentifier,
        ifcType,
        predefinedType: (authored ? overlayPredefinedType(authored) : null)
          ?? dataStore.entities?.getPredefinedType?.(expressId)
          ?? null,
        objectType: objectType || null,
      });
    }
    return marks;
    // `mutationVersion` bumps on every authoring edit, so a detector marked a
    // moment ago carries its Kennzeichen on the plan without a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geometryResult, dataStore, storeyId, drawsElement, modelId, mutationViews, mutationVersion]);
}

export default usePlanDeviceMarks;
