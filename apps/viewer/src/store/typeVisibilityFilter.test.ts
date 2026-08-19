/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the shared IFC-class → type-visibility mapping.
 * Locks in issue #1480: the `site` toggle governs `IfcGeographicElement`
 * terrain, not just `IfcSite`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTypeVisible, buildHiddenIfcTypes, allSpaceKindsHidden } from './typeVisibilityFilter.js';

const ALL_ON = {
  spaces: true,
  rooms: true,
  storeySpaces: true,
  parking: true,
  spatialZones: true,
  openings: true,
  virtualElements: true,
  site: true,
  ifcAnnotations: true,
};

describe('isTypeVisible', () => {
  it('shows every mapped class when all toggles are on', () => {
    for (const t of ['IfcSite', 'IfcGeographicElement', 'IfcSpace', 'IfcOpeningElement', 'IfcAnnotation']) {
      assert.equal(isTypeVisible(t, ALL_ON), true, t);
    }
  });

  it('hides IfcGeographicElement (terrain) when site is off (issue #1480)', () => {
    const tv = { ...ALL_ON, site: false };
    assert.equal(isTypeVisible('IfcGeographicElement', tv), false);
    assert.equal(isTypeVisible('IfcSite', tv), false);
  });

  it('leaves unmapped classes (walls, slabs) always visible', () => {
    const allOff = { spaces: false, rooms: false, storeySpaces: false, parking: false, spatialZones: false, openings: false, virtualElements: false, site: false, ifcAnnotations: false };
    assert.equal(isTypeVisible('IfcWall', allOff), true);
    assert.equal(isTypeVisible('IfcBuildingElementProxy', allOff), true);
  });

  it('treats an undefined ifcType as visible', () => {
    assert.equal(isTypeVisible(undefined, { ...ALL_ON, site: false }), true);
  });

  it('gates each class on exactly its own toggle', () => {
    assert.equal(isTypeVisible('IfcSpace', { ...ALL_ON, spaces: false }), false);
    assert.equal(isTypeVisible('IfcSpace', { ...ALL_ON, site: false }), true);
    assert.equal(isTypeVisible('IfcAnnotation', { ...ALL_ON, ifcAnnotations: false }), false);
  });

  it('measures EVERY class→toggle pair independently, in both directions', () => {
    // Per-case measurement: the loop above only ever discriminated
    // `spaces`, `site` and `ifcAnnotations`, so `IfcSpatialZone`,
    // `IfcOpeningElement` and `IfcVirtualElement` could be remapped to each
    // other's toggle with the whole suite still green. On screen that means
    // the Openings switch hides virtual elements and leaves the openings
    // visible (or vice versa).
    const pairs: ReadonlyArray<readonly [string, keyof typeof ALL_ON]> = [
      ['IfcSpace', 'spaces'],
      ['IfcSpatialZone', 'spatialZones'],
      ['IfcOpeningElement', 'openings'],
      ['IfcVirtualElement', 'virtualElements'],
      ['IfcSite', 'site'],
      ['IfcGeographicElement', 'site'],
      ['IfcAnnotation', 'ifcAnnotations'],
    ];

    for (const [ifcType, ownKey] of pairs) {
      // Its own toggle off → hidden.
      assert.equal(
        isTypeVisible(ifcType, { ...ALL_ON, [ownKey]: false }),
        false,
        `${ifcType} must be hidden when ${ownKey} is off`,
      );
      // Every OTHER toggle off → still visible. This is the half that
      // catches a swapped mapping.
      for (const otherKey of Object.keys(ALL_ON) as (keyof typeof ALL_ON)[]) {
        if (otherKey === ownKey) continue;
        assert.equal(
          isTypeVisible(ifcType, { ...ALL_ON, [otherKey]: false }),
          true,
          `${ifcType} must be unaffected by the ${otherKey} toggle`,
        );
      }
    }
  });
});

describe('buildHiddenIfcTypes', () => {
  it('is empty when nothing is toggled off', () => {
    assert.equal(buildHiddenIfcTypes(ALL_ON).size, 0);
  });

  it('drops both IfcSite and IfcGeographicElement when site is off', () => {
    const hidden = buildHiddenIfcTypes({ ...ALL_ON, site: false });
    assert.ok(hidden.has('IfcSite'));
    assert.ok(hidden.has('IfcGeographicElement'));
    assert.equal(hidden.size, 2);
  });

  it('drops IfcAnnotation when annotations are off', () => {
    const hidden = buildHiddenIfcTypes({ ...ALL_ON, ifcAnnotations: false });
    assert.deepEqual([...hidden], ['IfcAnnotation']);
  });

  it('drops exactly the classes owned by each toggle, one toggle at a time', () => {
    // Mirrors the per-pair check above for the GLB-export gate, so the two
    // consumers can never disagree about which class a toggle owns.
    // The kinds of space are deliberately absent here — see the test below.
    const expected: Partial<Record<keyof typeof ALL_ON, string[]>> = {
      spaces: ['IfcSpace'],
      spatialZones: ['IfcSpatialZone'],
      openings: ['IfcOpeningElement'],
      virtualElements: ['IfcVirtualElement'],
      site: ['IfcSite', 'IfcGeographicElement'],
      ifcAnnotations: ['IfcAnnotation'],
    };

    for (const [key, classes] of Object.entries(expected) as [keyof typeof ALL_ON, string[]][]) {
      const hidden = buildHiddenIfcTypes({ ...ALL_ON, [key]: false });
      assert.deepEqual([...hidden].sort(), [...classes].sort(), `toggle ${key}`);
    }
  });

  it('cannot drop a class for one kind of space, and drops it once no kind is left', () => {
    // Rooms, storey areas and parking are all IfcSpace. Excluding the class
    // because rooms are hidden would take the parking spaces with it, so one
    // kind off is a per-entity decision (`isTypeVisible` with the kind) that
    // a class-level exclusion cannot express — the export keeps the class.
    for (const kind of ['rooms', 'storeySpaces', 'parking'] as const) {
      assert.deepEqual([...buildHiddenIfcTypes({ ...ALL_ON, [kind]: false })], [], `kind ${kind}`);
    }

    // With no kind of space wanted, the two agree again and the class goes —
    // otherwise a "visible only" export ships spaces the viewport does not
    // show.
    const noKinds = { ...ALL_ON, rooms: false, storeySpaces: false, parking: false };
    assert.equal(allSpaceKindsHidden(noKinds), true);
    assert.deepEqual([...buildHiddenIfcTypes(noKinds)], ['IfcSpace']);
  });

  it('hides every mapped class when all toggles are off', () => {
    const allOff = {
      spaces: false, rooms: false, storeySpaces: false, parking: false, spatialZones: false, openings: false,
      virtualElements: false, site: false, ifcAnnotations: false,
    };
    assert.deepEqual([...buildHiddenIfcTypes(allOff)].sort(), [
      'IfcAnnotation',
      'IfcGeographicElement',
      'IfcOpeningElement',
      'IfcSite',
      'IfcSpace',
      'IfcSpatialZone',
      'IfcVirtualElement',
    ]);
  });
});

describe('isTypeVisible · kinds of space', () => {
  it('keeps the coarse answer when the caller cannot resolve a PredefinedType', () => {
    // A mesh carries no PredefinedType. Guessing would be worse than the
    // master switch's answer.
    assert.equal(isTypeVisible('IfcSpace', ALL_ON), true);
    assert.equal(isTypeVisible('IfcSpace', { ...ALL_ON, spaces: false }), false);
  });

  it('hides the storey-sized gross-area volume on its own', () => {
    // The whole point: look at rooms without a slab over the entire floor.
    const tv = { ...ALL_ON, storeySpaces: false };
    assert.equal(isTypeVisible('IfcSpace', tv, 'storeySpace'), false);
    assert.equal(isTypeVisible('IfcSpace', tv, 'room'), true);
    assert.equal(isTypeVisible('IfcSpace', tv, 'parking'), true);
  });

  it('hides parking on its own', () => {
    const tv = { ...ALL_ON, parking: false };
    assert.equal(isTypeVisible('IfcSpace', tv, 'parking'), false);
    assert.equal(isTypeVisible('IfcSpace', tv, 'storeySpace'), true);
  });

  it('hides rooms on their own', () => {
    const tv = { ...ALL_ON, rooms: false };
    assert.equal(isTypeVisible('IfcSpace', tv, 'room'), false);
    assert.equal(isTypeVisible('IfcSpace', tv, 'storeySpace'), true);
  });

  it('lets the master switch beat every kind', () => {
    const tv = { ...ALL_ON, spaces: false };
    for (const kind of ['room', 'storeySpace', 'parking'] as const) {
      assert.equal(isTypeVisible('IfcSpace', tv, kind), false, kind);
    }
  });

  it('does not apply space kinds to a spatial zone', () => {
    // The bug this replaces: the panel called IfcSpatialZone a "gross-area
    // volume", which is an IfcSpace.GFA. They are unrelated.
    const tv = { ...ALL_ON, storeySpaces: false };
    assert.equal(isTypeVisible('IfcSpatialZone', tv), true);
    assert.equal(isTypeVisible('IfcSpatialZone', { ...ALL_ON, spatialZones: false }), false);
  });
});

describe('allSpaceKindsHidden', () => {
  it('is false while any kind is wanted', () => {
    assert.equal(allSpaceKindsHidden({ ...ALL_ON, rooms: false, parking: false }), false);
  });

  it('is true when every kind is off', () => {
    assert.equal(
      allSpaceKindsHidden({ ...ALL_ON, rooms: false, storeySpaces: false, parking: false }),
      true,
    );
  });

  it('is true when the master switch is off', () => {
    assert.equal(allSpaceKindsHidden({ ...ALL_ON, spaces: false }), true);
  });
});
