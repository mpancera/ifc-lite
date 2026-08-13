/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The two things a plan needs in its corners: which way is north, and how long
 * a metre is.
 *
 * Both are arithmetic with one easy sign or rounding mistake in them, so both
 * live here where they can be pinned rather than inside a component where they
 * would be checked by looking.
 */

/**
 * Where north points on screen, as a COMPASS BEARING in degrees — 0° straight
 * up, growing clockwise, the convention the whole mode uses.
 *
 * # Why this is the plan rotation itself
 * Drawing y is world z, and IFC's project north (+Y) maps to drawing −y, which
 * is UP on a screen whose y grows downward. So on an unturned plan north is up
 * and the bearing is zero. Turning the plan by θ turns everything drawn on it
 * by θ, north included, so the bearing becomes θ.
 *
 * It comes out as an identity, and it is written down anyway: "the arrow does
 * not move" and "the arrow moves the wrong way" are both one sign away, and
 * neither is visible in a component that just interpolates a number into a
 * transform.
 */
export function northBearingDeg(planRotationRad: number): number {
  if (!Number.isFinite(planRotationRad)) return 0;
  const deg = (planRotationRad * 180) / Math.PI;
  // Into [0, 360) so the readout beside the arrow never says −270°.
  return ((deg % 360) + 360) % 360;
}

/** The lengths a scale bar is allowed to be, per decade. */
const NICE_STEPS = [1, 2, 5] as const;

export interface ScaleBarLength {
  /** The length the bar stands for, in metres. */
  readonly metres: number;
  /** How long it is on screen, in pixels. */
  readonly pixels: number;
}

/**
 * A round length for the scale bar, and how long it comes out on screen.
 *
 * A bar has to stand for a number somebody can divide by — 1, 2, 5, 10, 20,
 * 50 m and so on. So the length is chosen from those and the bar is drawn
 * however long that turns out, rather than fixing the bar and printing whatever
 * odd number it happens to represent. That is the difference between a scale
 * bar and a ruler with a label.
 *
 * The largest nice length that still fits `maxPixels`, so the bar is as long as
 * it can be — a long bar is read more accurately than a short one. Below the
 * smallest step it gives that step anyway rather than nothing: a bar running
 * off the corner is a clearer signal that the zoom is extreme than an empty
 * corner is.
 *
 * `null` when the scale is not a usable number.
 */
export function niceScaleBarLength(
  pixelsPerMetre: number,
  maxPixels = 120,
): ScaleBarLength | null {
  if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) return null;
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) return null;

  // Walk decades from very small to very large and keep the last one that fits.
  let best: ScaleBarLength | null = null;
  for (let decade = -3; decade <= 6; decade++) {
    for (const step of NICE_STEPS) {
      const metres = step * 10 ** decade;
      const pixels = metres * pixelsPerMetre;
      if (pixels <= maxPixels) best = { metres, pixels };
    }
  }

  if (best) return best;
  // Zoomed so far out that even a millimetre overflows the bar. Show the
  // smallest step rather than nothing.
  const metres = NICE_STEPS[0] * 10 ** -3;
  return { metres, pixels: metres * pixelsPerMetre };
}

/**
 * The bar's label: metres, or millimetres where metres would read "0.0".
 *
 * No decimals — every length this can produce is already round, and a "5.0 m"
 * beside a bar that means exactly five metres invites the reader to wonder
 * what was rounded away.
 */
export function formatScaleBarLength(metres: number): string {
  if (metres >= 1) return `${metres} m`;
  if (metres >= 0.01) return `${Math.round(metres * 100)} cm`;
  return `${Math.round(metres * 1000)} mm`;
}
