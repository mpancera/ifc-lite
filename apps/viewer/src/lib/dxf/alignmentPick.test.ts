/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The rules two surfaces now share. Each assertion is one of them, and each
 * one is a thing that looks right when it is wrong: a fitting point snapped to
 * the model reads as a perfect alignment, and a point recorded in the wrong
 * space reads as a plan that drifts a little further every time it is aligned.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAlignmentPick } from './alignmentPick.js';
import { constrainToAxis } from '@/lib/heights/alignmentSession';
import type { DxfAlignmentSession } from '@/lib/heights/alignmentSession';

const PLACEMENT = { offsetX: 100, offsetY: 50, rotationDeg: 0, scale: 1 };

function session(over: Partial<DxfAlignmentSession> = {}): DxfAlignmentSession {
  return {
    underlayId: 'u1',
    reference: { start: null, end: null },
    fit: { start: null, end: null },
    editing: null,
    lockScale: false,
    ...over,
  } as DxfAlignmentSession;
}

const MODEL_SNAP = { x: 7, y: 7 };
const UNDERLAY_SNAP = { x: 3, y: 3 };
const snapModel = () => MODEL_SNAP;
const snapUnderlay = () => UNDERLAY_SNAP;
const never = () => null;

describe('resolveAlignmentPick', () => {
  it('snaps the REFERENCE line to the model', () => {
    const pick = resolveAlignmentPick({
      session: session(), raw: { x: 0, y: 0 }, shiftKey: false,
      placement: PLACEMENT, snapModel, snapUnderlay, constrainToAxis,
    });

    assert.equal(pick.kind, 'pick');
    assert.deepEqual(pick.kind === 'pick' ? pick.point : null, MODEL_SNAP);
  });

  it('snaps the FITTING line to the underlay, never to the model', () => {
    // The tautology this exists to prevent: a plan point pulled onto the very
    // geometry it is being aligned against looks like a perfect fit.
    const pick = resolveAlignmentPick({
      session: session({ reference: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } }),
      raw: { x: 0, y: 0 }, shiftKey: false,
      placement: PLACEMENT, snapModel, snapUnderlay, constrainToAxis,
    });

    assert.equal(pick.kind, 'pick');
    // Recorded in the underlay's own coordinates: the snap was at (3,3) in
    // drawing space, and the placement offsets by (100, 50).
    assert.deepEqual(pick.kind === 'pick' ? pick.point : null, { x: -97, y: -47 });
  });

  it('records a fitting point in the underlay\'s OWN coordinates', () => {
    // So that re-aligning a plan that was already moved REPLACES its placement
    // instead of compounding the two.
    const moved = { offsetX: 1000, offsetY: 0, rotationDeg: 0, scale: 1 };
    const pick = resolveAlignmentPick({
      session: session({ reference: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } }),
      raw: { x: 0, y: 0 }, shiftKey: false,
      placement: moved, snapModel, snapUnderlay: () => ({ x: 1003, y: 0 }), constrainToAxis,
    });

    assert.deepEqual(pick.kind === 'pick' ? pick.point : null, { x: 3, y: 0 });
  });

  it('constrains the SECOND point to an axis when shift is held', () => {
    const pick = resolveAlignmentPick({
      session: session({ reference: { start: { x: 0, y: 0 }, end: null } }),
      raw: { x: 10, y: 1 }, shiftKey: true,
      placement: PLACEMENT, snapModel, snapUnderlay, constrainToAxis,
    });

    // Along x, because the cursor is further from the anchor that way.
    assert.deepEqual(pick.kind === 'pick' ? pick.point : null, { x: 10, y: 0 });
  });

  it('does not constrain the FIRST point — there is nothing to constrain to', () => {
    const pick = resolveAlignmentPick({
      session: session(), raw: { x: 10, y: 1 }, shiftKey: true,
      placement: PLACEMENT, snapModel, snapUnderlay, constrainToAxis,
    });

    assert.deepEqual(pick.kind === 'pick' ? pick.point : null, MODEL_SNAP);
  });

  it('falls back to the raw cursor when nothing snapped', () => {
    const pick = resolveAlignmentPick({
      session: session(), raw: { x: 4, y: 9 }, shiftKey: false,
      placement: PLACEMENT, snapModel: never, snapUnderlay: never, constrainToAxis,
    });

    assert.deepEqual(pick.kind === 'pick' ? pick.point : null, { x: 4, y: 9 });
  });

  it('reports a placement it cannot invert rather than recording nonsense', () => {
    const pick = resolveAlignmentPick({
      session: session({ reference: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } }),
      raw: { x: 0, y: 0 }, shiftKey: false,
      placement: { offsetX: 0, offsetY: 0, rotationDeg: 0, scale: 0 },
      snapModel, snapUnderlay, constrainToAxis,
    });

    assert.equal(pick.kind, 'not-invertible');
  });

  it('answers "done" once both lines are drawn', () => {
    // The caller still swallows the click: the only thing left is to press
    // apply, and a stray selection behind the dialog is noise.
    const pick = resolveAlignmentPick({
      session: session({
        reference: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        fit: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      }),
      raw: { x: 5, y: 5 }, shiftKey: false,
      placement: PLACEMENT, snapModel, snapUnderlay, constrainToAxis,
    });

    assert.equal(pick.kind, 'done');
  });
});
