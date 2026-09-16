/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupDetectors, describeGroups, MAX_DETECTORS_PER_GROUP, type UngroupedDetector,
} from './detectorGroups.js';

function detectors(compartmentKey: string, n: number, alongX = true): UngroupedDetector[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${compartmentKey}-${i}`,
    compartmentKey,
    at: alongX ? { x: i * 4, y: 0 } : { x: 0, y: i * 4 },
  }));
}

describe('groupDetectors', () => {
  it('never lets a group span two compartments', () => {
    // The rule the panel's display depends on: "group 3 has alarmed" answers
    // "which compartment is burning" only if the two coincide.
    const mixed = [...detectors('00.1', 3), ...detectors('00.2', 3)];

    for (const group of groupDetectors(mixed)) {
      const keys = new Set(group.detectors.map((d) => d.compartmentKey));
      assert.equal(keys.size, 1, `group ${group.key} spans ${[...keys].join(', ')}`);
    }
  });

  it('keeps a compartment under the limit as one group', () => {
    const groups = groupDetectors(detectors('00.3', MAX_DETECTORS_PER_GROUP));

    assert.equal(groups.length, 1);
    assert.equal(groups[0].detectors.length, MAX_DETECTORS_PER_GROUP);
  });

  it('splits one past the limit', () => {
    const groups = groupDetectors(detectors('00.3', MAX_DETECTORS_PER_GROUP + 1));

    assert.equal(groups.length, 2);
    assert.ok(groups.every((g) => g.detectors.length <= MAX_DETECTORS_PER_GROUP));
  });

  it('balances instead of filling', () => {
    // Forty become 20 + 20, not 32 + 8. The limit is a ceiling, not a target,
    // and the group of eight is the one somebody has to explain.
    const sizes = groupDetectors(detectors('00.3', 40)).map((g) => g.detectors.length);

    assert.deepEqual(sizes, [20, 20]);
  });

  it('cuts by position, so a group is somewhere rather than everywhere', () => {
    // A group scattered across a compartment tells the panel nothing about
    // where to go.
    const groups = groupDetectors(detectors('00.3', 40));
    const first = groups[0].detectors.map((d) => d.at.x);
    const second = groups[1].detectors.map((d) => d.at.x);

    assert.ok(Math.max(...first) < Math.min(...second),
      'the two groups overlap in space');
  });

  it('cuts along the LONGER extent', () => {
    // A tall compartment is cut top from bottom, not left from right.
    const groups = groupDetectors(detectors('00.3', 40, /* alongX */ false));
    const first = groups[0].detectors.map((d) => d.at.y);
    const second = groups[1].detectors.map((d) => d.at.y);

    assert.ok(Math.max(...first) < Math.min(...second));
  });

  it('numbers groups inside their compartment', () => {
    const groups = groupDetectors(detectors('00.2', 40));

    assert.deepEqual(groups.map((g) => g.key), ['00.2.1', '00.2.2']);
  });

  it('keeps the compartments in the order they arrived', () => {
    // So the numbering follows the proposal — the stair is compartment 1 and
    // its group is 1.1, on every floor.
    const groups = groupDetectors([...detectors('00.1', 1), ...detectors('00.2', 1)]);

    assert.deepEqual(groups.map((g) => g.compartmentKey), ['00.1', '00.2']);
  });

  it('answers nothing for nothing', () => {
    assert.deepEqual(groupDetectors([]), []);
  });

  it('refuses a limit that is not a limit rather than looping forever', () => {
    assert.deepEqual(groupDetectors(detectors('00.1', 5), 0), []);
  });
});

describe('describeGroups', () => {
  it('says how many detectors each group holds', () => {
    assert.deepEqual(describeGroups(groupDetectors(detectors('00.1', 3))), ['00.1.1: 3 Melder']);
  });
});
