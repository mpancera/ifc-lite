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

/**
 * Millimetres per CSS pixel, at the 96 dpi a browser nominally assumes.
 *
 * # The honesty this needs
 * A CSS pixel is DEFINED as 1/96 inch, but a monitor is under no obligation to
 * agree: the same page is physically larger on a 24" 1080p panel than on a
 * 27" 1440p one, and the browser exposes no way to ask. So a scale shown on
 * screen is nominal — right to within whatever the display's real pitch is.
 *
 * The PRINTED scale is not affected by any of this. The SVG and PDF exports
 * lay the drawing out in paper millimetres from `displayOptions.scale`, so
 * what comes out of the printer is exact. Screen and paper therefore agree on
 * WHICH scale is set, and only the screen's rendering of it is approximate —
 * which is the same deal every CAD application offers.
 */
export const MM_PER_CSS_PIXEL = 25.4 / 96;

/**
 * The scales a drawing is actually issued at.
 *
 * The architectural series, not every round number: 1:25 and 1:200 belong,
 * 1:300 does not. Offering a scale nobody issues invites a drawing nobody can
 * check against a ruler.
 */
export const STANDARD_SCALES = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2500, 5000,
] as const;

/**
 * The scale the plan is currently at, as the denominator of `1:n`.
 *
 * A metre of building is `pixelsPerMetre` pixels, which is that many times
 * {@link MM_PER_CSS_PIXEL} on the glass; the scale is the thousand millimetres
 * of building divided by that.
 *
 * `null` for a zoom that is not a zoom, so callers show nothing rather than
 * `1:Infinity`.
 */
export function scaleDenominator(
  pixelsPerMetre: number,
  mmPerPixel = MM_PER_CSS_PIXEL,
): number | null {
  if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) return null;
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null;
  return 1000 / (pixelsPerMetre * mmPerPixel);
}

/**
 * The zoom that puts the plan AT a stated scale — the inverse of
 * {@link scaleDenominator}, and the reason a scale can be chosen rather than
 * only reported.
 */
export function pixelsPerMetreForScale(
  denominator: number,
  mmPerPixel = MM_PER_CSS_PIXEL,
): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null;
  return 1000 / (denominator * mmPerPixel);
}

/**
 * The issued scale nearest the current one.
 *
 * Compared on a LOG axis, because scales are read as ratios: 1:200 is as far
 * from 1:100 as 1:50 is, and a linear comparison would call 1:150 closer to
 * 1:200 than to 1:100, which is not how anybody reads them.
 */
export function nearestStandardScale(denominator: number): number {
  let best: number = STANDARD_SCALES[0];
  let bestDistance = Infinity;
  for (const candidate of STANDARD_SCALES) {
    const distance = Math.abs(Math.log(denominator / candidate));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** `1:100`. Rounded, because a scale of 1:187.3 is a zoom wearing a costume. */
export function formatScaleRatio(denominator: number): string {
  return `1:${Math.round(denominator)}`;
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
