/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Multi-view sheets.
 *
 * The behaviour these pin is mostly about what does NOT change: a sheet built
 * before `viewports` existed has to keep drawing exactly as it did, because
 * every sheet in every saved template is one of those.
 */

import { describe, expect, it } from 'vitest';
import {
  sheetViewports, hasMultipleViews, viewportScale, viewportRotation, placeViewports,
  type DrawingSheet, type SheetViewport, type ViewportBounds,
} from './sheet-types.js';

const AREA: ViewportBounds = { x: 20, y: 10, width: 380, height: 250 };

/** Only the fields these functions read. */
const sheet = (overrides: Partial<DrawingSheet> = {}): DrawingSheet => ({
  viewportBounds: AREA,
  scale: { factor: 100 },
  ...overrides,
} as DrawingSheet);

describe('sheetViewports', () => {
  it('gives a single-view sheet exactly the area it always drew in', () => {
    // The compatibility promise: nothing about an existing sheet moves.
    const views = sheetViewports(sheet());
    expect(views).toHaveLength(1);
    expect(views[0].bounds).toEqual(AREA);
  });

  it('leaves scale and rotation unresolved on the derived view', () => {
    // Copying the sheet's values in would be a second copy that can fall out
    // of step with the sheet itself.
    const views = sheetViewports(sheet());
    expect(views[0].scaleDenominator).toBeNull();
    expect(views[0].rotation).toBeNull();
  });

  it('answers with the declared views when there are some', () => {
    const declared: SheetViewport[] = [
      { id: 'a', title: 'Übersicht', bounds: AREA, scaleDenominator: 500, rotation: 0.4 },
      { id: 'b', title: 'Geschoss', bounds: AREA, scaleDenominator: 200, rotation: null },
    ];
    expect(sheetViewports(sheet({ viewports: declared }))).toBe(declared);
  });

  it('falls back rather than drawing nothing for an empty list', () => {
    // An empty array is the shape a caller iterating `sheet.viewports`
    // directly would silently draw nothing from.
    expect(sheetViewports(sheet({ viewports: [] }))).toHaveLength(1);
  });
});

describe('hasMultipleViews', () => {
  it('is false for every sheet that predates viewports', () => {
    expect(hasMultipleViews(sheet())).toBe(false);
    expect(hasMultipleViews(sheet({ viewports: [] }))).toBe(false);
  });

  it('is false for one declared view, true for two', () => {
    const one: SheetViewport[] = [
      { id: 'a', title: '', bounds: AREA, scaleDenominator: null, rotation: null },
    ];
    expect(hasMultipleViews(sheet({ viewports: one }))).toBe(false);
    expect(hasMultipleViews(sheet({ viewports: [...one, { ...one[0], id: 'b' }] }))).toBe(true);
  });
});

describe('viewportScale', () => {
  const view = (scaleDenominator: number | null): SheetViewport =>
    ({ id: 'v', title: '', bounds: AREA, scaleDenominator, rotation: null });

  it('prefers the view’s own scale — the reason viewports exist', () => {
    expect(viewportScale(view(500), sheet())).toBe(500);
  });

  it('takes the sheet’s scale when the view has none', () => {
    expect(viewportScale(view(null), sheet())).toBe(100);
  });

  it('refuses a scale that would divide by zero or worse', () => {
    expect(viewportScale(view(0), sheet())).toBe(100);
    expect(viewportScale(view(-200), sheet())).toBe(100);
    expect(viewportScale(view(NaN), sheet())).toBe(100);
  });
});

describe('viewportRotation', () => {
  const view = (rotation: number | null): SheetViewport =>
    ({ id: 'v', title: '', bounds: AREA, scaleDenominator: null, rotation });

  it('lets a view pin itself north-up beside a turned one', () => {
    // The inset case: the site plan is turned, the inset is not.
    expect(viewportRotation(view(0), 1.2)).toBe(0);
    expect(viewportRotation(view(null), 1.2)).toBe(1.2);
  });

  it('defaults to straight, never to the north arrow’s angle', () => {
    // The north arrow says where north ENDS UP once the drawing is turned;
    // feeding it back in as the drawing's own angle would turn it twice.
    expect(viewportRotation(view(null))).toBe(0);
  });

  it('refuses a NaN angle rather than blanking the view', () => {
    expect(viewportRotation(view(NaN), 1.2)).toBe(1.2);
    expect(viewportRotation(view(null), NaN)).toBe(0);
  });
});

describe('placeViewports', () => {
  const placement = (overrides: Record<string, unknown> = {}) => ({
    id: 'a', title: 'Übersicht',
    x: 0, y: 0, width: 0.5, height: 1,
    scaleDenominator: 500, rotation: null,
    ...overrides,
  });

  it('turns fractions of the page into millimetres', () => {
    const [placed] = placeViewports(AREA, [placement()]);
    expect(placed.bounds).toEqual({ x: 20, y: 10, width: 190, height: 250 });
  });

  it('offsets by the area’s own origin, not by the paper’s', () => {
    // The drawable area starts inside the frame and above the title block.
    const [placed] = placeViewports(AREA, [placement({ x: 0.5, y: 0, width: 0.5, height: 1 })]);
    expect(placed.bounds.x).toBe(20 + 190);
  });

  it('carries scale and rotation through untouched', () => {
    const [placed] = placeViewports(AREA, [placement({ rotation: 0.4 })]);
    expect(placed.scaleDenominator).toBe(500);
    expect(placed.rotation).toBe(0.4);
  });

  it('drops a view off the page instead of clamping it onto its neighbour', () => {
    // Clamping would overlap two views and produce a drawing that looks
    // deliberate.
    expect(placeViewports(AREA, [placement({ x: 0.8, width: 0.5 })])).toEqual([]);
    expect(placeViewports(AREA, [placement({ x: -0.1 })])).toEqual([]);
  });

  it('drops a view with no area, which would print nothing', () => {
    expect(placeViewports(AREA, [placement({ width: 0 })])).toEqual([]);
    expect(placeViewports(AREA, [placement({ height: -1 })])).toEqual([]);
    expect(placeViewports(AREA, [placement({ width: NaN })])).toEqual([]);
  });

  it('keeps the good views when one is bad', () => {
    const placed = placeViewports(AREA, [
      placement({ id: 'gut' }),
      placement({ id: 'daneben', x: 0.9, width: 0.5 }),
      placement({ id: 'auch-gut', x: 0.6, width: 0.4 }),
    ]);
    expect(placed.map((view) => view.id)).toEqual(['gut', 'auch-gut']);
  });

  it('places the two views of a Feuerwehrlageplan side by side', () => {
    // The end-to-end case this whole change exists for.
    const placed = placeViewports(AREA, [
      placement({ id: 'uebersicht', width: 0.58, scaleDenominator: 500 }),
      placement({ id: 'geschoss', x: 0.62, width: 0.38, scaleDenominator: 200 }),
    ]);
    expect(placed).toHaveLength(2);
    expect(placed[0].bounds.x + placed[0].bounds.width)
      .toBeLessThanOrEqual(placed[1].bounds.x);
    expect(placed[0].scaleDenominator).not.toBe(placed[1].scaleDenominator);
  });
});
