/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Giving one drawing's placement to ANOTHER drawing.
 *
 * Storey plans exported from the same CAD model share an origin: the ground
 * floor and the basement sit on the same coordinates, because that is what
 * makes them stack. So a placement found the hard way on one of them is the
 * right placement for all of them, and fitting each plan separately is work
 * that answers a question already answered (Marc, 2026-09-15: "Kann ich die
 * darüber liegenden DXF analog ausrichten lassen?").
 *
 * The same is true across a reload: the placement a person fitted is worth
 * remembering, and what it has to be replayed against is a re-imported file.
 *
 * ## Why this is not a plain copy
 *
 * `importDxf` bakes a unit guess into the coordinates it produces — every
 * point is multiplied by `unitScale` at parse time, from `$INSUNITS` or from
 * the extents when the header says nothing. `placement.scale` is what a person
 * then put ON TOP of that guess, so the two together are the real factor, and
 * only the two together mean anything.
 *
 * Copy `scale` alone between two files whose guesses differ — one header says
 * millimetres, the sibling says nothing and gets guessed — and the second plan
 * comes out a thousand times too big while the field claims the same number.
 * So what is carried over is the EFFECTIVE factor, and `scale` is whatever
 * reproduces it against the receiving file's own guess.
 *
 * The offsets and the angle need no such care: they act on coordinates that
 * are already through both, so equal effective factors make them mean the
 * same thing on both drawings.
 */

import type { DxfPlacement } from './types.js';

/**
 * `placement`, as it must read on a drawing whose own unit guess is
 * `toUnitScale`, given that it was found on one guessing `fromUnitScale`.
 *
 * Equal guesses — the ordinary case of sibling storey plans out of one
 * export — return the placement unchanged.
 *
 * A non-finite or zero `toUnitScale` returns the placement unchanged too:
 * there is no factor that means anything against a degenerate guess, and a
 * plan placed as if the guesses matched is at least somewhere a person can
 * see and correct.
 */
export function adoptDxfPlacement(
  placement: DxfPlacement,
  fromUnitScale: number,
  toUnitScale: number,
): DxfPlacement {
  if (!Number.isFinite(fromUnitScale) || !Number.isFinite(toUnitScale) || toUnitScale === 0) {
    return { ...placement };
  }
  if (fromUnitScale === toUnitScale) return { ...placement };

  return { ...placement, scale: (placement.scale * fromUnitScale) / toUnitScale };
}

/** The metres one raw drawing unit of the file ends up as. What a person reads. */
export function effectiveDxfScale(placement: DxfPlacement, unitScale: number): number {
  return unitScale * placement.scale;
}
