/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * From mesh coordinates to IfcMapConversion attributes.
 *
 * An outline pulled off a mesh is not in the frame `IfcMapConversion` talks
 * about, in two separate ways, and both produce a placement that looks
 * entirely plausible while being wrong.
 *
 * **The frame.** Positions have been through the pipeline documented on
 * `computeProjectedCenter`: WASM may apply an RTC offset in IFC (Z-up) space,
 * the mesh collector flips Z-up to Y-up, and the coordinate handler may apply
 * a further origin shift in Y-up. A point read straight out of
 * `MeshData.positions` therefore sits at neither the IFC origin nor the map
 * origin. {@link planPointToIfcMetres} undoes all three.
 *
 * **The unit.** The geometry engine converts positions to METRES during
 * extraction, whatever the file's own length unit. `IfcMapConversion`,
 * meanwhile, states Eastings and Northings in the CRS map unit and uses Scale
 * to bridge the project length unit to it (issue #595 covers the same trap on
 * the reading side). So a fit performed in metres has solved for a different
 * scale than the attribute wants, and its translation is in different units
 * than the attribute wants. {@link metreFitToMapConversion} converts both.
 *
 * Fitting in metres is the right choice — an official parcel boundary arrives
 * in the CRS's own metric unit, and comparing metres to metres keeps the fit's
 * locked scale at a plain 1. The conversion belongs here, once, tested, rather
 * than inline in whatever panel happens to need it.
 */

import type { CoordinateInfo } from '@ifc-lite/geometry';
import type { Point2 } from './fit-outline';
import type { GeoreferenceSolution } from './solve-georeference';

/**
 * A mesh position's plan location in IFC world coordinates, in metres.
 *
 * Inverts the forward pipeline:
 *
 * ```
 * world_yup = position + originShift + wasmRtcOffset_as_yup
 * ifc_x =  world_yup.x
 * ifc_y = -world_yup.z
 * ```
 *
 * `wasmRtcOffset` is stated in IFC (Z-up) coordinates, so it enters Y-up space
 * as `(rtc.x, rtc.z, -rtc.y)` — which is why the plan's Y term picks up
 * `-(-rtc.y)`, i.e. `+rtc.y`, after the final axis flip. Getting that double
 * negative wrong shifts a model by the RTC offset, which on a georeferenced
 * file is kilometres.
 *
 * @param viewerX Viewer-space X of the position.
 * @param viewerZ Viewer-space Z of the position.
 */
export function planPointToIfcMetres(
  viewerX: number,
  viewerZ: number,
  coordinateInfo: CoordinateInfo | undefined,
): Point2 {
  const shiftX = coordinateInfo?.originShift?.x ?? 0;
  const shiftZ = coordinateInfo?.originShift?.z ?? 0;
  const rtcX = coordinateInfo?.wasmRtcOffset?.x ?? 0;
  const rtcY = coordinateInfo?.wasmRtcOffset?.y ?? 0;

  const worldYupX = viewerX + shiftX + rtcX;
  const worldYupZ = viewerZ + shiftZ - rtcY;

  return { x: worldYupX, y: -worldYupZ };
}

/** Apply {@link planPointToIfcMetres} to a whole ring. */
export function ringToIfcMetres(
  ring: readonly Point2[],
  coordinateInfo: CoordinateInfo | undefined,
): Point2[] {
  // `extractPlanOutline` already produced (x, -z) pairs, so the incoming
  // point's `y` is the negated viewer Z. Feed the viewer Z back in.
  return ring.map(p => planPointToIfcMetres(p.x, -p.y, coordinateInfo));
}

export interface MapConversionAttributes {
  eastings: number;
  northings: number;
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  scale: number;
}

/**
 * Turn a fit solved in metres into the five `IfcMapConversion` attributes.
 *
 * @param solution        A {@link GeoreferenceSolution} whose local AND map
 *                        coordinates were both in metres — so its own `scale`
 *                        is a plain 1 and carries no unit information.
 * @param mapUnitScale    CRS map unit → metres (1 for METRE).
 * @param lengthUnitScale Project length unit → metres (0.001 for a millimetre
 *                        file).
 */
export function metreFitToMapConversion(
  solution: GeoreferenceSolution,
  mapUnitScale: number,
  lengthUnitScale: number,
): MapConversionAttributes {
  const mus = mapUnitScale > 0 ? mapUnitScale : 1;
  const lus = lengthUnitScale > 0 ? lengthUnitScale : 1;

  return {
    // The solved translation is metres; the attribute is map units.
    eastings: solution.eastings / mus,
    northings: solution.northings / mus,
    // Rotation is unit-free and passes through untouched.
    xAxisAbscissa: solution.xAxisAbscissa,
    xAxisOrdinate: solution.xAxisOrdinate,
    // Not the fit's scale: the attribute's job is bridging the project length
    // unit to the map unit, which the metre-space fit never saw.
    scale: lus / mus,
  };
}

/**
 * The IFC4 placement formula, for verifying a conversion end to end.
 *
 * @param local Plan point in the PROJECT LENGTH UNIT (not metres).
 * @returns The point in map units.
 */
export function applyMapConversionAttributes(
  local: Point2,
  attributes: MapConversionAttributes,
): Point2 {
  return {
    x: attributes.eastings
      + attributes.scale * (local.x * attributes.xAxisAbscissa - local.y * attributes.xAxisOrdinate),
    y: attributes.northings
      + attributes.scale * (local.x * attributes.xAxisOrdinate + local.y * attributes.xAxisAbscissa),
  };
}
