/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The SI scale of a model's declared AREA / VOLUME units.
 *
 * # Why this is not the length scale squared
 * `IfcUnitAssignment` declares LENGTHUNIT, AREAUNIT and VOLUMEUNIT
 * independently, and the two exports that matter here disagree with the
 * shortcut in opposite directions: an imperial Revit file states FOOT and
 * SQUARE FOOT (squaring is right by coincidence), a metric millimetre file
 * states MILLI.METRE and plain SQUARE_METRE (squaring is wrong by 1e6). A
 * quantity is stated in the unit its own measure type declares — so that is
 * what gets read.
 *
 * # Why it is cached
 * `extractProjectUnits` re-parses the source buffer. The plan labels ask per
 * storey and the room triage asks per edit, so without the cache a 5 MB file
 * would be re-scanned on every keystroke. Keyed weakly on the store, so it
 * goes away with the model.
 */

import { extractProjectUnits, type IfcDataStore } from '@ifc-lite/parser';

interface MeasureScales {
  /** m² per file area unit. 1 when the project declares no AREAUNIT. */
  readonly area: number;
  /** m³ per file volume unit. 1 when the project declares no VOLUMEUNIT. */
  readonly volume: number;
}

const SI: MeasureScales = { area: 1, volume: 1 };

const cache = new WeakMap<IfcDataStore, MeasureScales>();

function usable(scale: number | undefined): number | null {
  return typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : null;
}

/** Both scales for a store, resolved once and remembered. */
export function measureScalesFor(store: IfcDataStore | null | undefined): MeasureScales {
  if (!store) return SI;
  const hit = cache.get(store);
  if (hit) return hit;

  let scales = SI;
  try {
    if (store.source?.byteLength) {
      const units = extractProjectUnits(store.source, store.entityIndex);
      scales = {
        area: usable(units.resolvedForUnitType('AREAUNIT')?.siScale) ?? 1,
        volume: usable(units.resolvedForUnitType('VOLUMEUNIT')?.siScale) ?? 1,
      };
    }
  } catch (error) {
    // SI is the IFC default for an undeclared unit, so it is also the right
    // answer when the declaration cannot be read — but say so, because a
    // wrong scale is a wrong number that looks like a right one.
    console.warn('measureScalesFor: could not read the declared units; assuming SI', error);
  }

  cache.set(store, scales);
  return scales;
}

/** m² per file area unit — what `roomAreaFromQuantities` takes. */
export function areaUnitScaleFor(store: IfcDataStore | null | undefined): number {
  return measureScalesFor(store).area;
}

/** m³ per file volume unit. */
export function volumeUnitScaleFor(store: IfcDataStore | null | undefined): number {
  return measureScalesFor(store).volume;
}
