/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A detector IS its symbol on the plan — so a symbol that cannot be clicked is
 * a detector that cannot be picked, and every tool that means "this detector"
 * is unreachable there. The layer stays transparent to the pointer as a whole;
 * each mark opts in, or a click that missed a device would be swallowed and
 * the rooms and walls beneath it would stop answering.
 */

import '@/test/setup-dom.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { render, cleanup } from '@/test/render.js';
import { PlanDeviceMarks } from './PlanDeviceMarks.js';
import type { DeviceMark } from '@/lib/plan/deviceSymbols';

const TRANSFORM = { x: 100, y: 100, scale: 10, rotation: 0 };

const mark = (expressId: number, x: number): DeviceMark => ({
  key: `m${expressId}`,
  expressId,
  kind: 'sensor',
  position: { x, y: 0 },
  name: `Melder ${expressId}`,
  ifcType: 'IfcSensor',
  predefinedType: 'SMOKESENSOR',
  objectType: null,
  tag: '',
  assetIdentifier: '',
});

const marksIn = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-plan-device-mark]')];

beforeEach(() => cleanup());
after(() => cleanup());

describe('PlanDeviceMarks', () => {
  it('hands the clicked device to the caller', () => {
    const picked: Array<[number, boolean]> = [];
    const container = render(
      <PlanDeviceMarks
        marks={[mark(41, 0), mark(57, 2)]}
        transform={TRANSFORM}
        onMarkClick={(id, additive) => picked.push([id, additive])}
      />,
    );
    const [first] = marksIn(container);
    first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.deepEqual(picked, [[41, false]]);
  });

  it('carries Ctrl through, so a run of detectors can be collected here', () => {
    // The plan is where somebody picks the detectors of one Meldebereich; it
    // must not be the one surface where a multi-selection cannot be built.
    const picked: Array<[number, boolean]> = [];
    const container = render(
      <PlanDeviceMarks
        marks={[mark(41, 0)]}
        transform={TRANSFORM}
        onMarkClick={(id, additive) => picked.push([id, additive])}
      />,
    );
    marksIn(container)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    assert.deepEqual(picked, [[41, true]]);
  });

  it('keeps the click from reaching the drawing underneath', () => {
    // The plan's own handlers sit on the canvas below and would read this as a
    // click on empty paper — clearing the selection that was just made.
    let reachedBelow = 0;
    const container = render(
      <div onClick={() => { reachedBelow++; }}>
        <PlanDeviceMarks marks={[mark(41, 0)]} transform={TRANSFORM} onMarkClick={() => {}} />
      </div>,
    );
    marksIn(container)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(reachedBelow, 0);
  });

  it('takes no clicks at all when the caller wants none', () => {
    const container = render(
      <PlanDeviceMarks marks={[mark(41, 0)]} transform={TRANSFORM} />,
    );
    const group = marksIn(container)[0];
    assert.ok(!group.className.toString().includes('pointer-events-auto'));
    assert.equal(group.querySelector('circle[fill="transparent"]'), null,
      'no hit target, so the drawing below keeps answering');
  });

  it('draws one mark per device, keyed by its express id', () => {
    const container = render(
      <PlanDeviceMarks marks={[mark(41, 0), mark(57, 2)]} transform={TRANSFORM} onMarkClick={() => {}} />,
    );
    assert.deepEqual(
      marksIn(container).map((el) => el.getAttribute('data-plan-device-mark')),
      ['41', '57'],
    );
  });
});
