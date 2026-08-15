/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readOverlayRelations, type OverlayEntity } from './overlayRelations.js';

/** As `emitRelAssignsToGroup` writes it: RelatedObjectsType sits between. */
const assigns = (id: number, members: number[], group: number): OverlayEntity => ({
  expressId: id,
  type: 'IfcRelAssignsToGroup',
  attributes: ['guid', '#7', null, null, members.map((m) => `#${m}`), null, `#${group}`],
});

/** As `emitRelDefinesByType` writes it: the type follows RelatedObjects. */
const defines = (id: number, members: number[], type: number): OverlayEntity => ({
  expressId: id,
  type: 'IfcRelDefinesByType',
  attributes: ['guid', '#7', null, null, members.map((m) => `#${m}`), `#${type}`],
});

const names: Record<number, string> = { 900: 'Starkstrom', 901: 'KIR 16', 902: 'Licht' };
const nameOf = (id: number) => names[id] ?? '';

describe('readOverlayRelations', () => {
  it('maps every member of a group assignment to its system', () => {
    const { systemOf } = readOverlayRelations([assigns(1, [11, 22, 33], 900)], nameOf);
    assert.equal(systemOf.get(11), 'Starkstrom');
    assert.equal(systemOf.get(33), 'Starkstrom');
    assert.equal(systemOf.size, 3);
  });

  it('reads the type from its own position, not the group\'s', () => {
    // The two layouts diverge by one slot; reading the group's index on a
    // DefinesByType would land on RelatedObjects and find nothing.
    const { typeOf } = readOverlayRelations([defines(2, [11], 901)], nameOf);
    assert.equal(typeOf.get(11), 'KIR 16');
  });

  it('keeps systems and types apart', () => {
    const { systemOf, typeOf } = readOverlayRelations(
      [assigns(1, [11], 900), defines(2, [11], 901)], nameOf,
    );
    assert.equal(systemOf.get(11), 'Starkstrom');
    assert.equal(typeOf.get(11), 'KIR 16');
  });

  it('lets the later statement win', () => {
    // Re-deciding a group writes a second relationship rather than editing the
    // first, and the newer one is what the user meant.
    const { systemOf } = readOverlayRelations(
      [assigns(1, [11], 900), assigns(2, [11], 902)], nameOf,
    );
    assert.equal(systemOf.get(11), 'Licht');
  });

  it('ignores a relationship whose target has no name', () => {
    const { systemOf } = readOverlayRelations([assigns(1, [11], 999)], nameOf);
    assert.equal(systemOf.size, 0);
  });

  it('ignores overlay entities that are not these two relationships', () => {
    const other: OverlayEntity = { expressId: 5, type: 'IfcWall', attributes: [] };
    const { systemOf, typeOf } = readOverlayRelations([other], nameOf);
    assert.equal(systemOf.size, 0);
    assert.equal(typeOf.size, 0);
  });

  it('has nothing to read from an empty overlay', () => {
    const { systemOf } = readOverlayRelations([], nameOf);
    assert.equal(systemOf.size, 0);
  });
});
