/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The zone boundaries a fire plan carries, and how they avoid each other.
 *
 * A room is in one Brandabschnitt AND in one Meldezone, and the two do not
 * coincide: a compartment usually holds several detection zones, and small
 * rooms on either side of a compartment wall are routinely combined into one
 * detection zone (Marc, 2026-09-14 — and the Swiss exchange requirement leaves
 * it open too, recording that detection zones follow the SMOKE sections rather
 * than the fire ones).
 *
 * So the plan used to draw exactly one theme, on the argument that two
 * boundaries would come out as near-identical lines a few centimetres apart.
 * That argument was about the DRAWING, and the drawing has an answer for it:
 * a real fire plan draws a compartment heavier than a detection zone and nests
 * the lines inside one another, the way courses of a wall nest. What it must
 * not do is drop one of them.
 *
 * # The stacking rule
 *
 * Every line lies against the inside face of what encloses it, offset by half
 * its own weight so it comes to rest ON the boundary rather than straddling
 * it. A second layer then starts where the first one ended: its offset is
 * everything outside it, plus half of itself. Lines therefore touch and never
 * overlap, whatever weights are chosen, and a compartment that happens to
 * coincide exactly with a detection zone still reads as two boundaries.
 *
 * Order is the order they nest, outermost first — the compartment encloses the
 * detection zone, on the plan as in the building.
 */

/** One boundary kind on the sheet. */
export interface ZoneLayer {
  /** A theme id from `lib/ifcZones/themes.ts`. */
  themeId: string;
  /** Drawn weight in METRES of building, before any zoom. */
  weightM: number;
}

/**
 * Metres. The weight of a detection-zone boundary.
 *
 * The geometry depends on it — the line is drawn inside the zone it encloses —
 * so the drawn width and the inset have to be the same number.
 *
 * 0.06 m is 0.6 mm on an A3 at 1:100. It was 0.18 m, which is 1.8 mm, and that
 * survived as long as it did because it was the only such line on the sheet:
 * nothing stood next to it to be too heavy against. Printed with a
 * Brandabschnitt outside it, the two ate 0.92 m of a 1.4 m corridor and the
 * gang closed (Marc, 2026-09-14, on the specimen sheet).
 */
export const ZONE_LINE_WEIGHT_M = 0.06;

/**
 * Metres. The weight of a Brandabschnitt boundary: heavier, because the
 * compartment is the stronger statement. It is what the building is divided
 * into; a detection zone is only what reports from inside one. 1.0 mm at 1:100.
 */
export const COMPARTMENT_LINE_WEIGHT_M = 0.10;

/** What a zone with no colour of its own is drawn in. Shared with the sheet
 *  export so screen and paper cannot disagree about an unpainted zone. */
export const ZONE_FALLBACK_COLOUR = '#dc2626';

/** What a Brandabschnitt with no colour of its own is drawn in — distinct from
 *  the detection zone's fallback, so two unpainted layers do not merge into
 *  one red smear. */
export const COMPARTMENT_FALLBACK_COLOUR = '#1d4ed8';

export const COMPARTMENT_LAYER: ZoneLayer = {
  themeId: 'fire-compartment', weightM: COMPARTMENT_LINE_WEIGHT_M,
};
export const FIRE_TRIGGER_LAYER: ZoneLayer = {
  themeId: 'fire-trigger', weightM: ZONE_LINE_WEIGHT_M,
};
export const GAS_TRIGGER_LAYER: ZoneLayer = {
  themeId: 'gas-trigger', weightM: ZONE_LINE_WEIGHT_M,
};

/**
 * How far each layer sits inside the rooms it encloses, in metres.
 *
 * Index-aligned with `layers`. See the stacking rule above: half of your own
 * weight, plus everything outside you.
 */
export function layerInsets(layers: readonly ZoneLayer[]): number[] {
  const insets: number[] = [];
  let outside = 0;
  for (const layer of layers) {
    insets.push(outside + layer.weightM / 2);
    outside += layer.weightM;
  }
  return insets;
}

/** The fallback colour for a layer with no colour of its own. */
export function fallbackColourFor(themeId: string): string {
  return themeId === COMPARTMENT_LAYER.themeId
    ? COMPARTMENT_FALLBACK_COLOUR
    : ZONE_FALLBACK_COLOUR;
}
