/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Remembering where a person put a DXF plan.
 *
 * Fitting a survey plan onto a model is minutes of careful work, and until now
 * every reload threw it away — the file is a reference layer, not part of the
 * model, so nothing carried it (Marc, 2026-09-15: "Wird dieses ausgerichtete
 * DXF an meinem IFC gespeichert oder muss ich diesen Prozess immer wieder
 * tun?"). What is remembered is the PLACEMENT, not the drawing: four numbers
 * per file against a file that can be several megabytes, and the drawing is on
 * disk anyway.
 *
 * ## What this is not
 *
 * Nothing here is written into the IFC. Where the underlay sits is a statement
 * about a pair of documents, not about the building, and a model exported from
 * a session with underlays is byte-for-byte one exported without.
 *
 * It is also not a substitute for recording the alignment in the project's own
 * container. This lives in the browser: it survives a reload and a restart on
 * ONE machine, and does not travel to a colleague. The durable home is the
 * project's metadata beside the drawing — Marc's own suggestion — and when
 * that exists this becomes the cache in front of it rather than the record.
 *
 * ## Keyed by file name
 *
 * Within a project two DXFs with the same name are the same drawing; a
 * re-export under the same name is the case this is FOR, since a plan comes
 * back revised and should land where its predecessor was fitted. The unit
 * guess is stored with it, because a revision can be exported with a different
 * header and the stored `scale` only means something against the guess it was
 * found with — see `adoptDxfPlacement`.
 */

import { adoptDxfPlacement, DEFAULT_DXF_PLACEMENT, type DxfPlacement } from '@ifc-lite/drawing-2d';
import type { ProjectKey } from '@ifc-lite/project';
import { readScoped, writeScoped, clearScoped } from '@/lib/project/scopedStorage';

const STORAGE_KEY = 'ifc-lite:dxf-placement';

/** One remembered plan. `unitScale` is the guess the placement was found against. */
export interface RememberedPlacement {
  placement: DxfPlacement;
  unitScale: number;
  /** Which storey it was assigned to, so that survives too. */
  storeyId?: string;
}

type Memory = Record<string, RememberedPlacement>;

function isPlacement(value: unknown): value is DxfPlacement {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<DxfPlacement>;
  return (['offsetX', 'offsetY', 'rotationDeg', 'scale'] as const)
    .every((k) => typeof p[k] === 'number' && Number.isFinite(p[k]));
}

/**
 * Everything remembered for a project.
 *
 * A malformed store is dropped whole rather than repaired entry by entry: the
 * cost of forgetting is re-fitting a plan, the cost of half-reading one is a
 * drawing placed by numbers nobody wrote.
 */
export function loadDxfPlacements(project: ProjectKey | null): Memory {
  const raw = readScoped(STORAGE_KEY, project);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Memory = {};
    for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { placement, unitScale, storeyId } = entry as Partial<RememberedPlacement>;
      if (!isPlacement(placement)) continue;
      if (typeof unitScale !== 'number' || !Number.isFinite(unitScale)) continue;
      out[name] = { placement, unitScale, ...(typeof storeyId === 'string' ? { storeyId } : {}) };
    }
    return out;
  } catch (err) {
    console.warn(`[dxf] ignoring malformed placements in ${STORAGE_KEY}`, err);
    return {};
  }
}

/** Remember these plans, replacing what the project held. Empty clears the row. */
export function saveDxfPlacements(project: ProjectKey | null, memory: Memory): void {
  if (Object.keys(memory).length === 0) {
    clearScoped(STORAGE_KEY, project);
    return;
  }
  writeScoped(STORAGE_KEY, project, JSON.stringify(memory));
}

/**
 * The placement to give a freshly imported `name`, or `null` for a plan this
 * project has never seen.
 *
 * An untouched placement is not remembered and not restored: a plan sitting at
 * the import default has had nothing done to it, and offering to restore that
 * would put a row in storage for every file ever opened.
 */
export function recallPlacement(
  memory: Memory,
  name: string,
  unitScale: number,
): { placement: DxfPlacement; storeyId?: string } | null {
  const remembered = memory[name];
  if (!remembered) return null;
  return {
    placement: adoptDxfPlacement(remembered.placement, remembered.unitScale, unitScale),
    ...(remembered.storeyId === undefined ? {} : { storeyId: remembered.storeyId }),
  };
}

/** Whether a placement says anything — an untouched one is not worth a row. */
export function isPlaced(placement: DxfPlacement): boolean {
  return placement.offsetX !== DEFAULT_DXF_PLACEMENT.offsetX
    || placement.offsetY !== DEFAULT_DXF_PLACEMENT.offsetY
    || placement.rotationDeg !== DEFAULT_DXF_PLACEMENT.rotationDeg
    || placement.scale !== DEFAULT_DXF_PLACEMENT.scale;
}
