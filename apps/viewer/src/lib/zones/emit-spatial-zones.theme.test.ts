/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * WHAT an emitted zone says it is.
 *
 * The sibling test covers where a zone lands. This one covers the other half,
 * which was missing entirely: until the theme was threaded through, every
 * emitted `IfcSpatialZone` carried the builder's default `CONSTRUCTION` — a
 * fire compartment and a takt area arrived in the file as the same kind of
 * thing, and nothing on screen said so.
 *
 * These assertions go through a REAL parse and the real builder rather than a
 * fake editor, because the claim is about what ends up in the file, and the
 * two attributes it rests on are positional: `ObjectType` at index 4 and
 * `PredefinedType` at index 8 of the nine `IfcSpatialZone` has.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { IfcParser } from '@ifc-lite/parser';
import type { IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { emitSpatialZones } from './emit-spatial-zones.js';
import type { Zone, ZoneSet } from './types.js';

/** Minimal IFC4 model with one storey — enough to resolve a spatial anchor. */
const STOREY_MODEL = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('t.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0proj00000000000000000',$,'P',$,$,$,$,(#7),#9);
#5=IFCCARTESIANPOINT((0.,0.,0.));
#6=IFCAXIS2PLACEMENT3D(#5,$,$);
#7=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#6,$);
#8=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#7,$,.MODEL_VIEW.,$);
#9=IFCUNITASSIGNMENT((#91));
#91=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#20=IFCLOCALPLACEMENT($,#6);
#30=IFCBUILDINGSTOREY('0storey000000000000000',$,'Level 0',$,$,#20,$,$,.ELEMENT.,0.);
#40=IFCWALL('0wall00000000000000000',$,'Wall',$,$,#20,$,$,$);
ENDSEC;
END-ISO-10303-21;`;

/** `IfcSpatialZone` attribute positions, of the nine the schema gives it. */
const OBJECT_TYPE = 4;
const PREDEFINED_TYPE = 8;

const ZONE: Zone = {
  id: 'z-a', name: 'BA 1', center: [0, 2, 0], size: [6, 4, 8], rotationY: 0,
};

function zoneSet(themeId?: string): ZoneSet {
  return {
    id: 'set-1', name: 'Brandabschnitte', zones: [ZONE], visible: true,
    createdAt: 0, updatedAt: 0, ...(themeId === undefined ? {} : { themeId }),
  };
}

let parsed: IfcDataStore;

before(async () => {
  parsed = await new IfcParser().parseColumnar(
    new TextEncoder().encode(STOREY_MODEL).buffer as ArrayBuffer,
    { disableWorkerScan: true },
  ) as IfcDataStore;
});

/** Emit one set into a fresh overlay and hand back the zone's attributes. */
function emitOne(set: ZoneSet): { attributes: readonly unknown[]; degraded: boolean } {
  const view = new MutablePropertyView(null, 'm1');
  const editor = new StoreEditor(parsed, view);
  const result = emitSpatialZones(
    editor, parsed, set, [{ expressId: 40, touchedZoneIds: ['z-a'] }], {}, { storeyId: 30 },
  );
  assert.equal(result.refusal, null, 'the fixture should emit');
  assert.equal(result.zonesEmitted, 1);
  const zone = view.getNewEntities().find((e) => e.type === 'IfcSpatialZone');
  assert.ok(zone, 'an IfcSpatialZone was emitted');
  return { attributes: zone.attributes, degraded: result.themeDegraded === true };
}

describe('the theme reaches the file', () => {
  it('writes a Brandabschnitt as FIRESAFETY / FIRECOMPARTMENT', () => {
    // The two tokens the Swiss fire-safety exchange requirement names for a
    // Brandabschnitt. It checks for exactly these, so a near miss is a fail.
    const { attributes } = emitOne(zoneSet('fire-compartment'));

    assert.equal(attributes[PREDEFINED_TYPE], '.FIRESAFETY.');
    assert.equal(attributes[OBJECT_TYPE], 'FIRECOMPARTMENT');
  });

  it('keeps the refinement that tells two FIRESAFETY themes apart', () => {
    const { attributes } = emitOne(zoneSet('fire-trigger'));

    assert.equal(attributes[PREDEFINED_TYPE], '.FIRESAFETY.');
    // Without this both themes are a bare FIRESAFETY zone in the file, and an
    // Auslösezone becomes indistinguishable from the compartment it sits in.
    assert.equal(attributes[OBJECT_TYPE], 'TriggerZoneFire');
  });

  it('still writes CONSTRUCTION for a set saved before themes existed', () => {
    // Every themeless set is a takt area or a building phase: that is what the
    // feature was for, and CONSTRUCTION is what it has always written. A
    // migration that silently relabelled them would be a worse bug than the
    // one being fixed.
    const { attributes } = emitOne(zoneSet(undefined));

    assert.equal(attributes[PREDEFINED_TYPE], '.CONSTRUCTION.');
    assert.equal(attributes[OBJECT_TYPE], null);
  });

  it('degrades a theme the bundled schema cannot write, rather than throwing', () => {
    // INTERFERENCE entered the enum with IFC4X3 and the generated schema here
    // is IFC4, so the builder REJECTS it — by throwing, out of a button press.
    // USERDEFINED plus the name is valid everywhere and keeps the identity.
    const { attributes, degraded } = emitOne(zoneSet('interference'));

    assert.equal(attributes[PREDEFINED_TYPE], '.USERDEFINED.');
    assert.equal(attributes[OBJECT_TYPE], 'InterferenceZone');
    assert.equal(degraded, true, 'and the panel is told, so it can say so');
  });

  it('reports no degradation for a theme that went in whole', () => {
    assert.equal(emitOne(zoneSet('fire-compartment')).degraded, false);
  });
});
