/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THEME_ID, ZONE_THEMES, resolveSpatialType, themeById, themeOfZone,
} from './themes.js';

/** Every value `IfcSpatialZoneTypeEnum` declares, per schema. */
const IFC4 = new Set([
  'CONSTRUCTION', 'FIRESAFETY', 'LIGHTING', 'OCCUPANCY', 'SECURITY',
  'THERMAL', 'TRANSPORT', 'VENTILATION', 'USERDEFINED', 'NOTDEFINED',
]);
const IFC4X3 = new Set([...IFC4, 'INTERFERENCE', 'RESERVATION']);

describe('the theme catalogue', () => {
  it('only uses PredefinedType values IFC4X3 declares', () => {
    for (const theme of ZONE_THEMES) {
      assert.ok(
        IFC4X3.has(theme.spatialPredefinedType),
        `${theme.id} uses ${theme.spatialPredefinedType}, which is not in IfcSpatialZoneTypeEnum`,
      );
    }
  });

  it('marks every IFC4X3-only value as such', () => {
    // The whole point of `since`: writing one of these into an IFC4 file
    // produces a token the schema does not declare.
    for (const theme of ZONE_THEMES) {
      const ifc4Only = !IFC4.has(theme.spatialPredefinedType);
      assert.equal(theme.since === 'IFC4X3', ifc4Only, `${theme.id}`);
    }
  });

  it('keeps ids and ObjectTypes unique', () => {
    // A repeated ObjectType would make `themeOfZone` ambiguous.
    assert.equal(new Set(ZONE_THEMES.map((t) => t.id)).size, ZONE_THEMES.length);
    assert.equal(new Set(ZONE_THEMES.map((t) => t.zoneObjectType)).size, ZONE_THEMES.length);
  });

  it('keeps every theme distinguishable on an IfcSpatialZone too', () => {
    // Three themes map to VENTILATION and six to FIRESAFETY: without the
    // ObjectType refinement they would all export as the same bare enum and
    // become one indistinguishable zone kind in the file.
    const keys = ZONE_THEMES.map((t) => `${t.spatialPredefinedType}/${t.spatialObjectType ?? ''}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('uses the four ObjectType values IFC itself documents', () => {
    const documented = ['FireCompartment', 'ElevatorShaft', 'RisingDuct', 'RunningDuct'];
    for (const value of documented) {
      assert.ok(
        ZONE_THEMES.some((t) => t.zoneObjectType === value),
        `${value} is documented by IFC for IfcZone and should be the token we write`,
      );
    }
  });

  it('offers an explicit "not classified" so the theme can be mandatory', () => {
    const fallback = themeById(DEFAULT_THEME_ID);
    assert.equal(fallback.spatialPredefinedType, 'NOTDEFINED');
  });
});

describe('themeById', () => {
  it('finds a theme', () => {
    assert.equal(themeById('fire-compartment').zoneObjectType, 'FireCompartment');
  });

  it('falls back rather than throwing on an unknown id', () => {
    // A saved zone from an older catalogue must still open.
    assert.equal(themeById('gibt-es-nicht').id, DEFAULT_THEME_ID);
    assert.equal(themeById(null).id, DEFAULT_THEME_ID);
  });
});

describe('themeOfZone', () => {
  it('recognises a zone by its ObjectType', () => {
    assert.equal(themeOfZone('FireCompartment')?.id, 'fire-compartment');
  });

  it('ignores case, because other tools round-trip the string', () => {
    assert.equal(themeOfZone('firecompartment')?.id, 'fire-compartment');
    assert.equal(themeOfZone('  TriggerZoneFire  ')?.id, 'fire-trigger');
  });

  it('reports null for somebody else\'s convention', () => {
    // NOT the fallback: "classified by a convention we do not know" and
    // "not classified" are different answers and a list must not merge them.
    assert.equal(themeOfZone('Brandabschnitt_Nord'), null);
    assert.equal(themeOfZone(''), null);
    assert.equal(themeOfZone(null), null);
  });
});

describe('resolveSpatialType', () => {
  it('passes an IFC4 value through unchanged', () => {
    const mapping = resolveSpatialType(themeById('fire-compartment'), 'IFC4');

    assert.deepEqual(mapping, { predefinedType: 'FIRESAFETY', objectType: null, degraded: false });
  });

  it('keeps the refinement', () => {
    const mapping = resolveSpatialType(themeById('rising-duct'), 'IFC4');

    assert.equal(mapping.predefinedType, 'VENTILATION');
    assert.equal(mapping.objectType, 'RisingDuct');
  });

  it('degrades an IFC4X3-only value on IFC4', () => {
    // INTERFERENCE is not in the IFC4 enum; writing it would be invalid.
    const mapping = resolveSpatialType(themeById('interference'), 'IFC4');

    assert.equal(mapping.predefinedType, 'USERDEFINED');
    assert.equal(mapping.objectType, 'InterferenceZone', 'identity survives in ObjectType');
    assert.equal(mapping.degraded, true);
  });

  it('uses the real value on IFC4X3', () => {
    const mapping = resolveSpatialType(themeById('reservation'), 'IFC4X3');

    assert.equal(mapping.predefinedType, 'RESERVATION');
    assert.equal(mapping.degraded, false);
  });

  it('treats an unknown schema string as IFC4', () => {
    // Degrading is the safe direction: USERDEFINED is valid in every schema.
    assert.equal(resolveSpatialType(themeById('interference'), 'IFC2X3').predefinedType, 'USERDEFINED');
    assert.equal(resolveSpatialType(themeById('interference'), '').predefinedType, 'USERDEFINED');
  });
});
