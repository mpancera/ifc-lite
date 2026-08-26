/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The parser is checked against the catalogue's REAL drawings, copied
 * verbatim: a smoke detector (square, circle plus strokes) and a
 * Brandmelderzentrale (the wide plate whose viewBox is not square). Those two
 * are the shapes the whole export path has to survive.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { symbolFit, symbolGeometryOf } from './symbolGeometry.js';

/** `rauchmelder.svg`, verbatim. */
const RAUCHMELDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-5 -5 10 10" width="10mm" height="10mm">
  <path d="M-4.7 -4.7 L4.7 -4.7 L4.7 4.7 L-4.7 4.7 Z" fill="#9B2423" />
  <circle cx="0" cy="0" r="3.3" fill="none" stroke="#FFFFFF" stroke-width="0.6" />
  <path d="M-1.275 1.56 L-1.785 0.71 L-0.765 -0.14 L-1.53 -1.075 M0 1.56 L-0.51 0.71 L0.51 -0.14 L-0.255 -1.075" fill="none" stroke="#FFFFFF" stroke-width="0.51" />
</svg>`;

/** `brandmelderzentrale.svg`, shortened but with its real frame. */
const PLATTE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -3 12 6" width="12mm" height="6mm">
  <path d="M-5.85 -2.85 L5.85 -2.85 L5.85 2.85 L-5.85 2.85 Z" fill="#9B2423" />
  <path d="M-5.3 -1.199 L-5.3 1.199 M-2.95 1.199 L-2.95 -1.199" fill="none" stroke="#FFFFFF" />
</svg>`;

describe('symbolGeometryOf', () => {
  it('reads the plate, the ring and the strokes of a real detector', () => {
    const g = symbolGeometryOf(RAUCHMELDER);
    assert.ok(g);
    assert.deepEqual(g.viewBox, { minX: -5, minY: -5, width: 10, height: 10 });
    assert.equal(g.circles.length, 1);
    assert.deepEqual(g.circles[0], {
      cx: 0, cy: 0, r: 3.3, filled: false, fill: null, stroke: '#FFFFFF',
    });
    // Plate (closed, filled) plus the two stroke runs of the second path.
    assert.equal(g.polylines.length, 3);
  });

  it('splits one path into a run per M', () => {
    // The catalogue writes several strokes in one `d`. Merging them would draw
    // a line between two glyph parts that never touch.
    const g = symbolGeometryOf(RAUCHMELDER);
    const strokes = g!.polylines.filter((p) => !p.filled);
    assert.equal(strokes.length, 2);
    assert.equal(strokes[0].points.length, 4);
    assert.equal(strokes[1].points.length, 4);
  });

  it('marks a closed and filled run as both', () => {
    const plate = symbolGeometryOf(RAUCHMELDER)!.polylines[0];
    assert.equal(plate.closed, true);
    assert.equal(plate.filled, true);
  });

  it('reads a non-square plate without complaint', () => {
    const g = symbolGeometryOf(PLATTE);
    assert.ok(g);
    assert.deepEqual(g.viewBox, { minX: -6, minY: -3, width: 12, height: 6 });
    assert.equal(g.polylines.length, 3);
  });

  it('keeps the colours the drawing was written with', () => {
    // Two sources reach this parser: the authority draws red plates with white
    // strokes, the association black line art. An exporter that assumed one
    // palette would publish a symbol the source never issued - and the
    // association's are used by permission, unchanged.
    const g = symbolGeometryOf(RAUCHMELDER)!;
    assert.equal(g.polylines[0].fill, '#9B2423');
    assert.equal(g.polylines[0].stroke, null);
    assert.equal(g.polylines[1].stroke, '#FFFFFF');
    assert.equal(g.polylines[1].fill, null);
  });

  it('reads an ellipse, and calls a round one a circle', () => {
    // The association's stencil writes every round shape as an ellipse. Four
    // of its symbols are genuinely not round; the rest are, and a receiver
    // should not have to handle both cases for the same shape.
    const rund = symbolGeometryOf(
      '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="4" ry="4" fill="none" stroke="#000"/></svg>',
    )!;
    assert.equal(rund.circles.length, 1);
    assert.equal(rund.ellipses.length, 0);

    const oval = symbolGeometryOf(
      '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="6" ry="3" fill="none" stroke="#000"/></svg>',
    )!;
    assert.equal(oval.circles.length, 0);
    assert.deepEqual(oval.ellipses[0], {
      cx: 12, cy: 12, rx: 6, ry: 3, filled: false, fill: null, stroke: '#000',
    });
  });

  it('abstains on a curve rather than dropping it', () => {
    // A dropped curve is a symbol that looks complete in the CAD file and is
    // not. The catalogue forbids curves; a drawing that has one is a source
    // fault to report, not to paper over.
    const withCurve = RAUCHMELDER.replace('L4.7 -4.7', 'C1 2 3 4 5 6');
    assert.equal(symbolGeometryOf(withCurve), null);
  });

  it('abstains on a relative command', () => {
    const relative = RAUCHMELDER.replace('L4.7 -4.7', 'l4.7 -4.7');
    assert.equal(symbolGeometryOf(relative), null);
  });

  it('abstains without a viewBox, which is where the placement comes from', () => {
    assert.equal(symbolGeometryOf(RAUCHMELDER.replace(/viewBox="[^"]*"/, '')), null);
  });

  it('abstains on a drawing with nothing in it', () => {
    assert.equal(symbolGeometryOf('<svg viewBox="-5 -5 10 10"></svg>'), null);
  });
});

describe('symbolFit', () => {
  it('fills the box for a square drawing', () => {
    const fit = symbolFit({ minX: -5, minY: -5, width: 10, height: 10 }, 3);
    assert.equal(fit.scale, 0.3);
    assert.equal(fit.offsetX, 0);
    assert.equal(fit.offsetY, 0);
  });

  it('letterboxes a plate instead of stretching it', () => {
    // Same rule the screen applies with `preserveAspectRatio="meet"`. A plate
    // stretched to a square would be a different symbol.
    const fit = symbolFit({ minX: -6, minY: -3, width: 12, height: 6 }, 3);
    assert.equal(fit.scale, 0.25);
    assert.equal(12 * fit.scale, 3);
    assert.equal(6 * fit.scale, 1.5);
  });

  it('cancels the centre of a drawing that is only nearly centred', () => {
    const fit = symbolFit({ minX: -4, minY: -5, width: 10, height: 10 }, 10);
    assert.equal(fit.offsetX, -1);
    assert.equal(fit.offsetY, 0);
  });
});
