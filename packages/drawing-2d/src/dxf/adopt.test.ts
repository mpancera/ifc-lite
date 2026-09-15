/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { assert, describe, expect, it } from 'vitest';
import { adoptDxfPlacement, effectiveDxfScale, sameDrawingOrigin } from './adopt.js';
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

describe('sameDrawingOrigin', () => {
  const box = (x0: number, y0: number, x1: number, y1: number) =>
    ({ min: { x: x0, y: y0 }, max: { x: x1, y: y1 } });

  it('says yes to storey plans of one building, exported one per file', () => {
    // They cover the same ground — that is what makes them stack — even when
    // the upper floor is smaller than the basement.
    assert(sameDrawingOrigin(box(0, 0, 40, 25), box(3, 2, 36, 22)));
  });

  it('says no to plans cut out of one sheet, side by side', () => {
    // The trap the transfer used to fall into: each correct in its own frame,
    // a hundred metres apart in the file. Handing the second the first's
    // placement moves it exactly that far off, with the right numbers in every
    // field.
    assert(!sameDrawingOrigin(box(0, 0, 40, 25), box(140, 0, 180, 25)));
  });

  it('accepts plans that only touch at an edge', () => {
    // A wing drawn flush against the next is still one building. Nothing is
    // lost by accepting it: the placement is the same either way, and refusing
    // would send somebody to re-fit a plan that needs no fitting.
    assert(sameDrawingOrigin(box(0, 0, 40, 25), box(40, 0, 80, 25)));
  });

  it('notices a shift in y alone', () => {
    assert(!sameDrawingOrigin(box(0, 0, 40, 25), box(0, 90, 40, 115)));
  });
});
