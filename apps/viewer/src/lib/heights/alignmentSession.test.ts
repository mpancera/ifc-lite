/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignmentPairs, alignmentPrompt, alignmentStep, alignmentTarget, constrainToAxis,
  isLineComplete,
  type DxfAlignmentSession,
} from './alignmentSession.js';

const p = (n: number) => ({ x: n, y: n });

function session(over: Partial<DxfAlignmentSession> = {}): DxfAlignmentSession {
  return {
    underlayId: 'u1', reference: null, fit: null, editing: null, lockScale: false, ...over,
  };
}

const line = (a: number, b: number) => ({ start: p(a), end: p(b) });
const half = (a: number) => ({ start: p(a), end: null });

describe('alignmentStep · the normal order', () => {
  it('starts with the reference line on the model', () => {
    assert.deepEqual(alignmentStep(session()), { kind: 'start', target: 'reference' });
  });

  it('asks for the end once the start is down', () => {
    assert.deepEqual(alignmentStep(session({ reference: half(0) })),
      { kind: 'end', target: 'reference' });
  });

  it('moves to the fitting line once the reference is complete', () => {
    assert.deepEqual(alignmentStep(session({ reference: line(0, 1) })),
      { kind: 'start', target: 'fit' });
  });

  it('is ready once both lines are complete', () => {
    assert.deepEqual(
      alignmentStep(session({ reference: line(0, 1), fit: line(2, 3) })), { kind: 'ready' },
    );
  });
});

describe('alignmentStep · correcting one line', () => {
  it('sends the next clicks to the line being edited', () => {
    // The whole reason for named lines: the reference is usually right first
    // time and the fitting line is the one that needs nudging.
    const s = session({ reference: line(0, 1), fit: null, editing: 'fit' });

    assert.deepEqual(alignmentStep(s), { kind: 'start', target: 'fit' });
  });

  it('lets the reference be corrected even though both were drawn', () => {
    const s = session({ reference: null, fit: line(2, 3), editing: 'reference' });

    assert.deepEqual(alignmentStep(s), { kind: 'start', target: 'reference' });
  });

  it('does not fall back to the normal order while editing', () => {
    // Without the explicit target this would say "ready" and swallow the click.
    const s = session({ reference: line(0, 1), fit: half(2), editing: 'fit' });

    assert.deepEqual(alignmentStep(s), { kind: 'end', target: 'fit' });
  });
});

describe('alignmentTarget', () => {
  it('names the line the next click belongs to', () => {
    assert.equal(alignmentTarget(session()), 'reference');
    assert.equal(alignmentTarget(session({ reference: line(0, 1) })), 'fit');
  });

  it('is null when there is nothing left to draw', () => {
    assert.equal(alignmentTarget(session({ reference: line(0, 1), fit: line(2, 3) })), null);
  });
});

describe('alignmentPrompt', () => {
  it('names the drawing, not just the action', () => {
    // With a plan lying over a model section, "click a point" is exactly the
    // instruction that cannot be followed.
    assert.match(alignmentPrompt(session()), /Modell/);
    assert.match(alignmentPrompt(session({ reference: line(0, 1) })), /Plan/);
  });

  it('distinguishes the start from the end', () => {
    assert.match(alignmentPrompt(session()), /Startpunkt/);
    assert.match(alignmentPrompt(session({ reference: half(0) })), /Endpunkt/);
  });

  it('stops asking for clicks once both lines are down', () => {
    assert.doesNotMatch(
      alignmentPrompt(session({ reference: line(0, 1), fit: line(2, 3) })), /anklicken/,
    );
  });
});

describe('isLineComplete', () => {
  it('needs both ends', () => {
    assert.equal(isLineComplete(line(0, 1)), true);
    assert.equal(isLineComplete(half(0)), false);
    assert.equal(isLineComplete(null), false);
  });
});

describe('alignmentPairs', () => {
  it('pairs start with start and end with end', () => {
    const pairs = alignmentPairs(session({
      reference: { start: { x: 10, y: 10 }, end: { x: 20, y: 10 } },
      fit: { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
    }));

    assert.ok(pairs);
    assert.deepEqual(pairs[0], { from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    assert.deepEqual(pairs[1], { from: { x: 5, y: 0 }, to: { x: 20, y: 10 } });
  });

  it('lets opposite drawing directions produce a turn rather than fixing it silently', () => {
    // Drawing the two lines head-to-tail is a real statement about
    // orientation. Quietly swapping the ends would hide a 180° error that is
    // obvious on screen from the two arrows.
    const forward = alignmentPairs(session({
      reference: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      fit: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    }));
    const reversed = alignmentPairs(session({
      reference: { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      fit: { start: { x: 10, y: 0 }, end: { x: 0, y: 0 } },
    }));

    assert.notDeepEqual(forward, reversed);
  });

  it('gives nothing while either line is unfinished', () => {
    // Solving from one line and a guess is exactly the trial and error this
    // replaces.
    for (const s of [
      session(),
      session({ reference: line(0, 1) }),
      session({ reference: half(0), fit: line(2, 3) }),
    ]) {
      assert.equal(alignmentPairs(s), null);
    }
  });
});

describe('constrainToAxis', () => {
  const start = { x: 10, y: 10 };

  it('holds the horizontal when the line runs mostly sideways', () => {
    assert.deepEqual(constrainToAxis(start, { x: 30, y: 12 }), { x: 30, y: 10 });
  });

  it('holds the vertical when it runs mostly up or down', () => {
    assert.deepEqual(constrainToAxis(start, { x: 12, y: 30 }), { x: 10, y: 30 });
  });

  it('follows the gesture rather than overriding it', () => {
    // Snapping always to one axis would fight the hand; the point is to
    // tidy up what was already meant.
    assert.equal(constrainToAxis(start, { x: 0, y: 11 }).y, 10);
    assert.equal(constrainToAxis(start, { x: 11, y: 0 }).x, 10);
  });

  it('makes two constrained lines differ by exactly 0 or 90 degrees', () => {
    // The reason it exists: freehand, two orthogonal drawings end up a
    // fraction of a degree apart, and the solver reports that fraction as a
    // rotation — leaving a square plan very slightly askew.
    const a = constrainToAxis({ x: 0, y: 0 }, { x: 10, y: 0.3 });
    const b = constrainToAxis({ x: 5, y: 5 }, { x: 15, y: 5.2 });
    const angle = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.atan2(q.y - p.y, q.x - p.x);

    assert.equal(angle({ x: 0, y: 0 }, a), angle({ x: 5, y: 5 }, b));
  });

  it('leaves a degenerate line where it is', () => {
    assert.deepEqual(constrainToAxis(start, start), start);
  });
});
