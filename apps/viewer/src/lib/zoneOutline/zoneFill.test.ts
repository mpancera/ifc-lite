/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trianglesToPathData, ZONE_FILL_OPACITY, ZONE_FILL_RULE } from './zoneFill.js';

const identity = (x: number, y: number) => ({ x, y });
/** One triangle, flat. */
const TRI = new Float32Array([0, 0, 1, 0, 0, 1]);

describe('trianglesToPathData', () => {
  it('closes every triangle, so each is a shape and not a stroke', () => {
    const d = trianglesToPathData(TRI, identity, 0);
    assert.equal(d, 'M 0 0 L 1 0 L 0 1 Z');
  });

  it('keeps them in ONE path — a fill per triangle would show every seam', () => {
    const two = new Float32Array([...TRI, 1, 0, 2, 0, 1, 1]);
    const d = trianglesToPathData(two, identity, 0);
    assert.equal((d.match(/Z/g) ?? []).length, 2, 'two subpaths');
    assert.ok(!d.includes('\n'), 'and one string, handed to one <path>');
  });

  it('projects through the caller, so screen and sheet use their own frames', () => {
    const d = trianglesToPathData(TRI, (x, y) => ({ x: x * 10 + 5, y: -y }), 0);
    assert.equal(d, 'M 5 0 L 15 0 L 5 -1 Z');
  });

  it('drops a trailing partial triangle instead of inventing a corner', () => {
    // Half a triangle is a bug upstream; closing it with whatever came before
    // would hide that behind a shape that looks plausible.
    const ragged = new Float32Array([...TRI, 9, 9, 9]);
    assert.equal(trianglesToPathData(ragged, identity, 0), 'M 0 0 L 1 0 L 0 1 Z');
  });

  it('answers empty for no triangles, so the caller can skip the element', () => {
    assert.equal(trianglesToPathData(new Float32Array(), identity), '');
  });

  it('stays readable over the drawing it covers', () => {
    // The fill answers "which zone"; the plan underneath answers the rest.
    assert.ok(ZONE_FILL_OPACITY > 0 && ZONE_FILL_OPACITY <= 0.25);
    assert.equal(ZONE_FILL_RULE, 'nonzero');
  });
});
