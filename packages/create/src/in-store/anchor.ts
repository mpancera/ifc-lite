/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Spatial anchor for in-store builders — the set of references that any
 * element being added to an existing parsed model needs in order to slot
 * into the existing IFC graph correctly.
 *
 * Resolution from a parsed `IfcDataStore` lives in the backend layer
 * (where `@ifc-lite/parser` is already a dependency); the builder
 * functions in this module operate purely on these resolved ids.
 */

import type { RandomSource } from '@ifc-lite/encoding';

export type SpatialAnchorSchema = 'IFC2X3' | 'IFC4' | 'IFC4X3' | 'IFC5';

export interface SpatialAnchor {
  /**
   * IfcOwnerHistory expressId, or null when the model has none.
   * IfcRoot.OwnerHistory is OPTIONAL from IFC4 onward — minimal files
   * legitimately omit the entity, and builders emit `$` for it.
   */
  ownerHistoryId: number | null;
  /** IfcGeometricRepresentationSubContext for 'Body' (or its IfcGeometricRepresentationContext fallback). */
  bodyContextId: number;
  /** IfcGeometricRepresentationSubContext for 'Axis' (or its IfcGeometricRepresentationContext fallback). */
  axisContextId: number;
  /** The target IfcBuildingStorey expressId. */
  storeyId: number;
  /** The IfcLocalPlacement that the storey itself sits on. New element placements are chained from this. */
  storeyPlacementId: number;
  /**
   * Target schema. Builders use this to decide which optional STEP arguments
   * to emit — e.g. `IfcColumn.PredefinedType` only exists from IFC4 onward.
   * Defaults to `'IFC4'` when unset for backward compatibility.
   */
  schema?: SpatialAnchorSchema;
  /**
   * Model length-unit scale: metres per native unit (1 for a metre file,
   * 0.001 for millimetres). Builder params are always metres (renderer
   * frame); geometry coordinates are divided by this on emit so they land
   * in the file's native unit. Defaults to 1 when unset. Without this, a
   * space baked into a millimetre model exported 1000× too small (its
   * mesh looked right in-session because that one is built in metres).
   */
  lengthUnitScale?: number;
  /**
   * Model area-unit scale: square metres per native area unit.
   *
   * **Not the square of {@link lengthUnitScale}.** `IfcUnitAssignment`
   * declares AREAUNIT separately from LENGTHUNIT, and real files disagree in
   * both directions: a Revit imperial export states FOOT *and* SQUARE FOOT
   * (0.092903), while a millimetre metric export routinely states MILLI.METRE
   * lengths with plain SQUARE_METRE areas (1). Squaring the length scale gets
   * the first case right by accident and the second wrong by a factor of a
   * million, which is why this is its own number.
   *
   * Defaults to 1 — the SI square metre, which is what IFC means when a
   * project declares no area unit.
   */
  areaUnitScale?: number;
  /**
   * Model volume-unit scale: cubic metres per native volume unit. Same
   * argument as {@link areaUnitScale}; VOLUMEUNIT is declared on its own.
   * Defaults to 1 (SI cubic metre).
   */
  volumeUnitScale?: number;
  /**
   * Optional seeded randomness for the GlobalIds the builders emit
   * (`@ifc-lite/encoding`'s `RandomSource`: a `Math.random`-style
   * `() => number` in `[0, 1)`). Pass a seeded generator to make in-store
   * builds byte-reproducible - the counterpart of `ProjectParams.GuidSource`
   * on `IfcCreator`. Omit it for the default platform CSPRNG. A seeded
   * source trades global uniqueness for reproducibility - only use one
   * where that is the point.
   */
  guidRandom?: RandomSource;
}

/**
 * Convert a metre value to the anchor's native length unit for STEP emit.
 * Rounded to 9 decimals to absorb the float noise the division introduces
 * (2.8 / 0.001 = 2799.9999999999995 → 2800).
 */
export function toNativeLength(anchor: SpatialAnchor, metres: number): number {
  const scale = anchor.lengthUnitScale;
  if (!scale || !Number.isFinite(scale) || scale <= 0 || scale === 1) return metres;
  return Math.round((metres / scale) * 1e9) / 1e9;
}

/** Shared guard: an unusable scale means "no conversion", never "multiply by 0". */
function usableScale(scale: number | undefined): number | null {
  if (!scale || !Number.isFinite(scale) || scale <= 0 || scale === 1) return null;
  return scale;
}

/**
 * Convert a square-metre value to the anchor's native AREA unit for STEP emit.
 *
 * A quantity is stated in the unit its project declares — `IfcQuantityArea`
 * in AREAUNIT, not in "length unit squared" — so this reads
 * {@link SpatialAnchor.areaUnitScale} and never squares the length scale.
 * Writing m² into a file whose AREAUNIT is SQUARE FOOT is how a 24 m² room
 * came back as 2.3 m² through a reader that did the declared conversion.
 */
export function toNativeArea(anchor: SpatialAnchor, squareMetres: number): number {
  const scale = usableScale(anchor.areaUnitScale);
  if (scale === null) return squareMetres;
  return Math.round((squareMetres / scale) * 1e9) / 1e9;
}

/** Cubic-metre value to the anchor's native VOLUME unit. See {@link toNativeArea}. */
export function toNativeVolume(anchor: SpatialAnchor, cubicMetres: number): number {
  const scale = usableScale(anchor.volumeUnitScale);
  if (scale === null) return cubicMetres;
  return Math.round((cubicMetres / scale) * 1e9) / 1e9;
}

/** 2D point variant of {@link toNativeLength}. */
export function toNativePoint2(anchor: SpatialAnchor, p: readonly [number, number]): [number, number] {
  return [toNativeLength(anchor, p[0]), toNativeLength(anchor, p[1])];
}

/** 3D point variant of {@link toNativeLength}. */
export function toNativePoint3(anchor: SpatialAnchor, p: readonly [number, number, number]): [number, number, number] {
  return [toNativeLength(anchor, p[0]), toNativeLength(anchor, p[1]), toNativeLength(anchor, p[2])];
}
