/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { doorReference, doorSize, formatDoorSize, doorLabelLines } from './doorLabels.js';

describe('doorReference', () => {
  it('takes Name, where a numbered door carries its number', () => {
    assert.equal(
      doorReference({ name: '1.02a', psetReference: 'D-1', tag: 'T99' }),
      '1.02a',
    );
  });

  it('falls back to Pset_DoorCommon.Reference, then to Tag', () => {
    assert.equal(doorReference({ psetReference: 'D-1', tag: 'T99' }), 'D-1');
    assert.equal(doorReference({ tag: 'T99' }), 'T99');
  });

  it('treats blank and whitespace as absent', () => {
    assert.equal(doorReference({ name: '   ', psetReference: '', tag: 'T99' }), 'T99');
    assert.equal(doorReference({}), '');
  });
});

describe('doorSize', () => {
  it('believes the stated nominal size over the measured one', () => {
    // The lining measures 0.92 across; the door is a 90 and the schedule says
    // so. A plan that wrote 92 would match no other document.
    const size = doorSize({ statedWidth: 0.9, statedHeight: 2.1, geometricWidth: 0.92, geometricHeight: 2.16 });
    assert.deepEqual(size, { width: 0.9, height: 2.1 });
  });

  it('falls back per dimension, not all or nothing', () => {
    // The real case: OverallWidth stated, OverallHeight left unset.
    const size = doorSize({ statedWidth: 0.9, statedHeight: null, geometricWidth: 0.92, geometricHeight: 2.1 });
    assert.deepEqual(size, { width: 0.9, height: 2.1 });
  });

  it('has no size when neither source gives a usable pair', () => {
    assert.equal(doorSize({ statedWidth: 0.9 }), null);
    assert.equal(doorSize({ statedWidth: 0, statedHeight: 0, geometricWidth: 0, geometricHeight: 0 }), null);
  });

  it('treats an unusable stated value as absent rather than fatal', () => {
    // Exporters write 0, blanks and the occasional NaN. None of those is a
    // door, and all of them should reach the geometry instead of the label.
    assert.deepEqual(
      doorSize({ statedWidth: Number.NaN, statedHeight: 2.1, geometricWidth: 0.92, geometricHeight: 2.16 }),
      { width: 0.92, height: 2.1 },
    );
  });
});

describe('formatDoorSize', () => {
  it('writes centimetres the way a plan does', () => {
    assert.equal(formatDoorSize({ width: 0.9, height: 2.1 }), '90/210');
    assert.equal(formatDoorSize({ width: 1.0, height: 2.15 }), '100/215');
  });

  it('rounds to whole centimetres — a door has no millimetre on a plan', () => {
    assert.equal(formatDoorSize({ width: 0.885, height: 2.011 }), '89/201');
  });
});

describe('doorLabelLines', () => {
  it('reads mark first, size under it', () => {
    assert.deepEqual(doorLabelLines('D-1', { width: 0.9, height: 2.1 }), ['D-1', '90/210']);
  });

  it('leaves out what the model does not say', () => {
    assert.deepEqual(doorLabelLines('', { width: 0.9, height: 2.1 }), ['90/210']);
    assert.deepEqual(doorLabelLines('D-1', null), ['D-1']);
    assert.deepEqual(doorLabelLines('', null), []);
  });
});
