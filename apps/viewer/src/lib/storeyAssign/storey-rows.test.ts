/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { storeyRows } from './storey-rows.js';

const STOREYS = [
  { expressId: 35, name: 'U1', elevation: 0 },
  { expressId: 39, name: 'SIT', elevation: 3.6576 },
  { expressId: 43, name: '00', elevation: 4.4196 },
  { expressId: 47, name: '01', elevation: 8.2296 },
];

describe('storeyRows', () => {
  it('reads top down, the way a building is drawn in section', () => {
    assert.deepEqual(storeyRows(STOREYS, []).map((r) => r.name), ['01', '00', 'SIT', 'U1']);
  });

  it('says how much of the selection each storey already holds', () => {
    const rows = storeyRows(STOREYS, [39, 39, 43, null]);
    assert.equal(rows.find((r) => r.name === 'SIT')?.here, 2);
    assert.equal(rows.find((r) => r.name === '00')?.here, 1);
    assert.equal(rows.find((r) => r.name === '01')?.here, 0,
      'an element with no storey belongs to no row');
  });

  it('lets the caller see that a storey holds ALL of it — the move that writes nothing', () => {
    const rows = storeyRows(STOREYS, [39, 39, 39]);
    assert.equal(rows.find((r) => r.name === 'SIT')?.here, 3, 'equal to the selection size');
  });

  it('puts a storey without elevation last rather than pretending it is at zero', () => {
    const rows = storeyRows([...STOREYS, { expressId: 99, name: 'Dach', elevation: null }], []);
    assert.equal(rows[rows.length - 1].name, 'Dach');
  });

  it('does not let a session-authored storey displace the parsed one it shadows', () => {
    const rows = storeyRows(
      [...STOREYS, { expressId: 43, name: 'ganz anders', elevation: 99 }],
      [],
    );
    assert.equal(rows.filter((r) => r.expressId === 43).length, 1);
    assert.equal(rows.find((r) => r.expressId === 43)?.name, '00');
  });
});
