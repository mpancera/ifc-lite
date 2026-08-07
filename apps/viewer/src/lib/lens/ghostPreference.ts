/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What to do with the elements a lens does not colour.
 *
 * The engine always ghosts them — grey at 15% alpha — so the building stays
 * readable around the coloured parts. That is the right default and wrong in
 * one specific, common case: volumetric elements. Isolate a storey's rooms
 * under a zone lens and the thirty rooms without a zone stack their
 * translucency until the result is an opaque block hiding everything behind
 * it. Fifteen percent, thirty times over, is not fifteen percent.
 *
 * So the choice is the viewer's, not the lens's: the engine result stays
 * truthful about what matched, and this decides how to present it. Same
 * reasoning as the `colour` list column, which the engine also refuses to fill
 * in — how something looks is a property of the current view.
 */

import { isGhostColor } from '@ifc-lite/lens';
import type { RGBAColor } from '@ifc-lite/lens';

export interface LensPresentation {
  /** Colours to push to the renderer. */
  colorMap: Map<number, RGBAColor>;
  /** Ids to hide, including whatever the lens rules already hid. */
  hiddenIds: Set<number>;
}

/**
 * Split a lens result according to the ghost preference.
 *
 * With `ghostUnmatched`, everything is handed through untouched — the ghosted
 * entries stay in the colour map and get painted. Without it, every ghosted
 * entry moves to `hiddenIds` instead, so the unmatched elements are not drawn
 * at all.
 *
 * Ids the lens rules already hid are kept in both cases: a rule that hides
 * something means it, independently of how the rest is presented.
 */
export function applyGhostPreference(
  colorMap: ReadonlyMap<number, RGBAColor>,
  hiddenIds: ReadonlySet<number>,
  ghostUnmatched: boolean,
): LensPresentation {
  if (ghostUnmatched) {
    return { colorMap: new Map(colorMap), hiddenIds: new Set(hiddenIds) };
  }

  const colours = new Map<number, RGBAColor>();
  const hidden = new Set(hiddenIds);
  for (const [id, rgba] of colorMap) {
    if (isGhostColor(rgba)) hidden.add(id);
    else colours.set(id, rgba);
  }
  return { colorMap: colours, hiddenIds: hidden };
}
