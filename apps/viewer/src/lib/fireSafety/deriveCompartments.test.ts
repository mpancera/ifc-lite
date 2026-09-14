/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deriving compartment bodies, through a real parse and the real builder.
 *
 * The assertions that matter are the ones a shape check would pass anyway:
 * that a second run REPLACES rather than accumulates, that a compartment with
 * nothing to build from is reported instead of silently skipped, and that the
 * requirements ride along onto the body.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { deriveCompartmentBodies, type CompartmentSource } from './deriveCompartments.js';
import type { PrismMesh } from './roomPrism.js';

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
#40=IFCSPACE('0space0000000000000000',$,'R1',$,$,#20,$,$,.ELEMENT.,.INTERNAL.,$);
#41=IFCSPACE('0space0000000000000001',$,'R2',$,$,#20,$,$,.ELEMENT.,.INTERNAL.,$);
ENDSEC;
END-ISO-10303-21;`;

/** A box in the RENDER frame: X/Z are the plan, Y the height. */
function box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number): PrismMesh {
  return {
    positions: new Float32Array([
      x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1,
      x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1,
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
  };
}

const MESHES = new Map<number, PrismMesh[]>([
  [40, [box(0, 0, 4, 3, 0, 2.8)]],
  [41, [box(5, 0, 9, 3, 0, 2.8)]],
]);

function source(over: Partial<CompartmentSource> = {}): CompartmentSource {
  return {
    zoneId: 500, name: 'BA-01', memberIds: [40, 41],
    requirements: new Map(), ...over,
  };
}

let parsed: IfcDataStore;

before(async () => {
  parsed = await new IfcParser().parseColumnar(
    new TextEncoder().encode(STOREY_MODEL).buffer as ArrayBuffer,
    { disableWorkerScan: true },
  ) as IfcDataStore;
});

function session() {
  const view = new MutablePropertyView(null, 'm1');
  return { view, editor: new StoreEditor(parsed, view) };
}

function run(editor: StoreEditor, sources: readonly CompartmentSource[]) {
  return deriveCompartmentBodies(editor, parsed, sources, {
    meshesOf: (id) => MESHES.get(id),
    frame: {},
    storeyId: 30,
  });
}

describe('deriveCompartmentBodies', () => {
  it('builds one prism per assigned room', () => {
    const { editor, view } = session();
    const result = run(editor, [source()]);

    assert.equal(result.refusal, null);
    assert.equal(result.outcomes[0].bodies, 2);
    assert.equal(result.outcomes[0].skipped, 0);
    assert.equal(view.getNewEntities().filter((e) => e.type === 'IfcExtrudedAreaSolid').length, 2);
    assert.equal(view.getNewEntities().filter((e) => e.type === 'IfcSpatialZone').length, 1);
  });

  it('REPLACES on a second run instead of stacking a second body', () => {
    // Two bodies per compartment in the same place, and the second run's
    // numbers indistinguishable from the first's in the exported file.
    const { editor, view } = session();
    run(editor, [source()]);
    const again = run(editor, [source()]);

    assert.equal(again.replaced, 1);
    const live = view.getNewEntities().filter((e) => e.type === 'IfcSpatialZone');
    assert.equal(live.length, 1, 'one body, not two');
  });

  it('leaves another compartment alone when only one is re-derived', () => {
    const { editor, view } = session();
    run(editor, [source(), source({ zoneId: 501, name: 'BA-02', memberIds: [41] })]);
    const again = run(editor, [source({ zoneId: 501, name: 'BA-02', memberIds: [41] })]);

    assert.equal(again.replaced, 1);
    assert.equal(view.getNewEntities().filter((e) => e.type === 'IfcSpatialZone').length, 2);
  });

  it('reports a compartment with no rooms rather than emitting an empty body', () => {
    const { editor, view } = session();
    const result = run(editor, [source({ memberIds: [] })]);

    assert.equal(result.outcomes[0].reason, 'no-rooms');
    assert.equal(result.outcomes[0].zoneId, null);
    assert.equal(view.getNewEntities().filter((e) => e.type === 'IfcSpatialZone').length, 0);
  });

  it('reports a compartment whose rooms have no geometry', () => {
    // Not the same failure as having no rooms, and the author needs to know
    // which of the two it is.
    const { editor } = session();
    const result = run(editor, [source({ memberIds: [998, 999] })]);

    assert.equal(result.outcomes[0].reason, 'no-geometry');
    assert.equal(result.outcomes[0].skipped, 2);
  });

  it('skips a room with no mesh but still builds from the others', () => {
    const { editor } = session();
    const result = run(editor, [source({ memberIds: [40, 999] })]);

    assert.equal(result.outcomes[0].bodies, 1);
    assert.equal(result.outcomes[0].skipped, 1);
    assert.equal(result.outcomes[0].reason, null);
  });

  it('carries the requirements onto the body', () => {
    const { editor, view } = session();
    run(editor, [source({ requirements: new Map([['FireRatingWalls', 'EI60']]) })]);

    const pset = view.getNewEntities().find((e) => e.type === 'IfcPropertySet');
    assert.equal(pset?.attributes[2], 'CHIBB_FireCompartmentRequirements');
    const value = view.getNewEntities().find((e) => e.type === 'IfcPropertySingleValue');
    assert.equal(value?.attributes[0], 'FireRatingWalls');
  });

  it('writes no property set when nothing has been decided', () => {
    // An empty pset is noise in the file and says the opposite of what it
    // looks like: that the requirements were answered with nothing.
    const { editor, view } = session();
    run(editor, [source()]);

    assert.equal(view.getNewEntities().filter((e) => e.type === 'IfcPropertySet').length, 0);
  });

  it('takes the property set with it when the body is replaced', () => {
    const { editor, view } = session();
    run(editor, [source({ requirements: new Map([['FireRatingWalls', 'EI60']]) })]);
    run(editor, [source({ requirements: new Map([['FireRatingWalls', 'EI90']]) })]);

    const values = view.getNewEntities().filter((e) => e.type === 'IfcPropertySingleValue');
    assert.equal(values.length, 1, 'the old requirement did not survive its body');
    assert.deepEqual(values[0].attributes[2], { typed: { type: 'IfcLabel', value: 'EI90' } });
  });

  it('references the rooms it was built from', () => {
    const { editor, view } = session();
    run(editor, [source()]);

    const rel = view.getNewEntities().find((e) => e.type === 'IfcRelReferencedInSpatialStructure');
    assert.deepEqual(rel?.attributes[4], ['#40', '#41']);
  });

  it('refuses a model that alignment re-based', () => {
    const { editor } = session();
    const result = deriveCompartmentBodies(editor, parsed, [source()], {
      meshesOf: (id) => MESHES.get(id), frame: {}, storeyId: 30, rebased: true,
    });

    assert.equal(result.refusal, 'rescaled-by-alignment');
    assert.deepEqual(result.outcomes, []);
  });
});
