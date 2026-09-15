/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { adoptDxfPlacement, effectiveDxfScale } from './adopt.js';
import type { DxfPlacement } from './types.js';

const FITTED: DxfPlacement = { offsetX: 2398431.59, offsetY: 1134401.52, rotationDeg: -9.25, scale: 0.9 };

describe('adoptDxfPlacement', () => {
  it('carries a placement across unchanged between siblings of one export', () => {
    // The ordinary case: storey plans out of one CAD model, same header, same
    // unit guess. Nothing to compensate, and the numbers must read identically
    // in the field or the copy looks like it did something else.
    expect(adoptDxfPlacement(FITTED, 1, 1)).toEqual(FITTED);
  });

  it('keeps the EFFECTIVE factor when the receiving file guessed differently', () => {
    // One plan's header says metres, its sibling says nothing and gets guessed
    // at millimetres. Copying `scale` alone makes the second a thousand times
    // too big while the field claims the same number.
    const adopted = adoptDxfPlacement(FITTED, 1, 0.001);

    expect(effectiveDxfScale(adopted, 0.001)).toBeCloseTo(effectiveDxfScale(FITTED, 1), 12);
  });

  it('leaves the offsets and the angle alone', () => {
    // They act on coordinates that are already through both factors, so once
    // the effective factors agree they mean the same thing on both drawings.
    const adopted = adoptDxfPlacement(FITTED, 1, 0.001);

    expect(adopted.offsetX).toBe(FITTED.offsetX);
    expect(adopted.offsetY).toBe(FITTED.offsetY);
    expect(adopted.rotationDeg).toBe(FITTED.rotationDeg);
  });

  it('hands back a copy rather than the placement it was given', () => {
    // Underlays hold their placement by reference; sharing one object would
    // make moving one plan move the others.
    expect(adoptDxfPlacement(FITTED, 1, 1)).not.toBe(FITTED);
  });

  it('passes a degenerate guess through instead of dividing by it', () => {
    // Somewhere a person can see and correct beats a plan at infinity.
    expect(adoptDxfPlacement(FITTED, 1, 0)).toEqual(FITTED);
    expect(adoptDxfPlacement(FITTED, Number.NaN, 1)).toEqual(FITTED);
  });
});
