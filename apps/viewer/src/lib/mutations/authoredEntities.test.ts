/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { authoredEntities } from './authoredEntities.js';

function view() {
  return new MutablePropertyView(null, 'm1');
}

describe('authoredEntities', () => {
  it('returns a freshly created entity unchanged', () => {
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);

    const [entity] = authoredEntities(v);
    assert.equal(entity.expressId, expressId);
    assert.equal(entity.type, 'IfcZone');
    assert.equal(entity.attributes[2], 'AZ-A');
  });

  it('applies a later positional edit', () => {
    // The whole reason this helper exists: getNewEntities() alone still says
    // 'AZ-A' here, while the exporter would write 'AZ-B'.
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.setPositionalAttribute(expressId, 2, 'AZ-B');

    assert.equal(authoredEntities(v)[0].attributes[2], 'AZ-B');
  });

  it('applies the last of several edits to the same index', () => {
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.setPositionalAttribute(expressId, 3, 'ZoneDisplay=#111111');
    v.setPositionalAttribute(expressId, 3, 'ZoneDisplay=#472A24');

    assert.equal(authoredEntities(v)[0].attributes[3], 'ZoneDisplay=#472A24');
  });

  it('leaves the stored record alone', () => {
    // Merging must not write back into the overlay: undo restores from there.
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.setPositionalAttribute(expressId, 2, 'AZ-B');

    authoredEntities(v);

    assert.equal(v.getNewEntity(expressId)!.attributes[2], 'AZ-A');
  });

  it('drops an entity that was deleted', () => {
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.deleteEntity(expressId);

    assert.deepEqual(authoredEntities(v), []);
  });

  it('does not touch an entity that only exists in the file', () => {
    // Positional edits on source entities are common; they must not conjure
    // an authored entity out of nothing.
    const v = view();
    v.setPositionalAttribute(4711, 2, 'edited');

    assert.deepEqual(authoredEntities(v), []);
  });

  it('is empty for an untouched view', () => {
    assert.deepEqual(authoredEntities(view()), []);
  });

  it('applies a named attribute edit', () => {
    // `setAttribute` is the channel the properties panel and list cells use;
    // merging only the positional one left a renamed zone stale in half the UI.
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.setAttribute(expressId, 'Name', 'AZ-B');

    assert.equal(authoredEntities(v)[0].attributes[2], 'AZ-B');
  });

  it('lets a named edit win over a positional one on the same attribute', () => {
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.setPositionalAttribute(expressId, 3, 'aus dem Panel');
    v.setAttribute(expressId, 'Description', 'aus der Liste');

    assert.equal(authoredEntities(v)[0].attributes[3], 'aus der Liste');
  });

  it('merges both channels when they touch different attributes', () => {
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.setPositionalAttribute(expressId, 3, 'ZoneDisplay=#472A24');
    v.setAttribute(expressId, 'Name', 'AZ-B');

    const [entity] = authoredEntities(v);
    assert.equal(entity.attributes[2], 'AZ-B');
    assert.equal(entity.attributes[3], 'ZoneDisplay=#472A24');
  });

  it('ignores an attribute name it has no index for', () => {
    const v = view();
    const { expressId } = v.createEntity('IfcZone', ['guid', null, 'AZ-A', null, null, null]);
    v.setAttribute(expressId, 'LongName', 'egal');

    assert.deepEqual([...authoredEntities(v)[0].attributes], ['guid', null, 'AZ-A', null, null, null]);
  });
});
