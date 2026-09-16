/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Placing an example, read out of the STEP it produces.
 *
 * Every hop in this chain has already hidden a defect from a test that stopped
 * one hop short, so these go all the way: real file in, real file out.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import type { SpatialAnchor } from '@ifc-lite/create';
import { readExampleModel } from './exampleModel.js';
import { placeExampleInStore } from './placeExample.js';

const EXAMPLE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('probe','2026-09-16T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCAXIS2PLACEMENT3D(#1,$,$);
#3=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#2,$);
#4=IFCLOCALPLACEMENT($,#2);
#5=IFCOWNERHISTORY($,$,$,.ADDED.,$,$,$,0);
#6=IFCBUILDINGSTOREY('0storey',#5,'Ebene',$,$,#4,$,$,.ELEMENT.,0.);
#10=IFCCIRCLEPROFILEDEF(.AREA.,$,#2,0.1);
#11=IFCEXTRUDEDAREASOLID(#10,#2,$,0.5);
#12=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#11));
#13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));
#14=IFCFIRESUPPRESSIONTERMINAL('0device',#5,'Handfeuerloescher',$,'FIREEXTINGUISHER',#4,#13,'HFL',.USERDEFINED.);
#20=IFCEXTRUDEDAREASOLID(#10,#2,$,0.8);
#21=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#20));
#22=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));
#23=IFCVIRTUALELEMENT('0clear',#5,'Freihaltebereich',$,$,#4,#22,$,.CLEARANCE.);
#40=IFCRELCONTAINEDINSPATIALSTRUCTURE('0rel1',#5,$,$,(#14,#23),#6);
#41=IFCRELASSIGNSTOPRODUCT('0rel2',#5,$,$,(#23),$,#14);
ENDSEC;
END-ISO-10303-21;
`;

function anchorFor(lengthUnitScale: number): SpatialAnchor {
  return {
    ownerHistoryId: 5,
    bodyContextId: 3,
    axisContextId: 3,
    storeyId: 6,
    storeyPlacementId: 4,
    lengthUnitScale,
    guidRandom: () => 0.42,
  };
}

async function place(targetLengthUnitScale = 1) {
  const store = await new IfcParser().parseColumnar(
    new TextEncoder().encode(EXAMPLE).buffer as ArrayBuffer,
  );
  const model = readExampleModel(store, 1);
  assert.ok(model, 'the example must read');

  const view = new MutablePropertyView(null, 'ziel');
  const editor = new StoreEditor(store as never, view);
  const result = placeExampleInStore(editor, anchorFor(targetLengthUnitScale), model, {
    position: [2, 3, 0],
    targetLengthUnitScale,
    exampleId: 'handfeuerloescher',
  });

  const exported = await new StepExporter(store as never, view as never).export({
    applyMutations: true,
    schema: 'IFC4',
  });
  const raw = (exported as { content: unknown }).content;
  const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as Uint8Array);
  const lines = content.split(/\r?\n/);
  const find = (type: string) => lines.filter((l) => l.includes(`=${type}(`));
  return { result, view, lines, find };
}

describe('placing an example', () => {
  it('places the device AND its companion, not just the device', async () => {
    // The clearance is its own product. Dropped, the model would gain an
    // extinguisher and lose the space that has to stay free in front of it.
    const { result } = await place();
    assert.equal(result.companionIds.length, 1);
    assert.ok(result.deviceId > 0);
  });

  it('shows the geometry through a mapped item, once per occurrence', async () => {
    const { find } = await place();
    // Two occurrences, each with its own mapped item and operator, over two
    // representation maps — one per product.
    assert.equal(find('IFCMAPPEDITEM').length, 2);
    assert.equal(find('IFCREPRESENTATIONMAP').length, 2);
    assert.equal(find('IFCCARTESIANTRANSFORMATIONOPERATOR3D').length, 2);
  });

  it('hangs the maps on a type, resolved from the schema', async () => {
    const { result, find } = await place();
    assert.ok(result.typeId, 'IfcFireSuppressionTerminal has a type entity');
    const type = find('IFCFIRESUPPRESSIONTERMINALTYPE')[0];
    assert.ok(type, 'the type was written');
    assert.match(type, /handfeuerloescher/);
  });

  it('gives the companion no type, because its entity has none', async () => {
    // `IfcVirtualElementType` does not exist. Appending `Type` by rule would
    // have produced it and failed at the editor's name check.
    const { find } = await place();
    assert.equal(find('IFCVIRTUALELEMENTTYPE').length, 0);
    assert.equal(find('IFCVIRTUALELEMENT').length, 2, 'source and placement');
  });

  it('relates the companion to the device rather than aggregating it', async () => {
    const { find, result } = await place();
    const rels = find('IFCRELASSIGNSTOPRODUCT');
    // The source has one; the placement adds its own.
    assert.equal(rels.length, 2);
    const added = rels.find((l) => l.includes(`#${result.deviceId}`));
    assert.ok(added, 'the new relation names the placed device');
  });

  it('carries the unit factor on the operator when the units differ', async () => {
    // A metre example in a millimetre model.
    const { find } = await place(0.001);
    for (const operator of find('IFCCARTESIANTRANSFORMATIONOPERATOR3D')) {
      assert.match(operator, /1000\./, `expected the factor: ${operator}`);
    }
  });

  it('leaves the factor at one when they agree', async () => {
    const { find } = await place(1);
    for (const operator of find('IFCCARTESIANTRANSFORMATIONOPERATOR3D')) {
      // `1.`, a REAL — not the INTEGER `1`, which the attribute is not.
      assert.match(operator, /,1\.,/, `expected a plain REAL one: ${operator}`);
    }
  });

  it('converts the position into the model’s own unit', async () => {
    // The position is an ordinary coordinate of THIS file and follows its
    // unit; only the mapped geometry is scaled by the operator.
    const { lines } = await place(0.001);
    assert.ok(
      lines.some((l) => l.includes('IFCCARTESIANPOINT((2000.,3000.,0.))')),
      'the placement point in millimetres',
    );
  });

  it('keeps the copied geometry’s own numbers untouched', async () => {
    // The whole reason for the operator: a copy that rescaled coordinates
    // would need to know which attribute is a length.
    const { find } = await place(0.001);
    const solids = find('IFCEXTRUDEDAREASOLID');
    assert.equal(solids.length, 4, 'two in the source, two copied');
    assert.equal(solids.filter((l) => /,0\.5\)/.test(l)).length, 2);
    assert.equal(solids.filter((l) => /,0\.8\)/.test(l)).length, 2);
  });

  it('points the copied geometry at this model’s context', async () => {
    const { view } = await place();
    const copies = view.getNewEntities().filter((e) => e.type === 'IFCSHAPEREPRESENTATION');
    // Two copied 'Body' representations, plus the two 'MappedRepresentation'
    // wrappers the occurrences get.
    const bodies = copies.filter((e) => e.attributes[1] === 'Body');
    assert.equal(bodies.length, 2);
    for (const body of bodies) assert.equal(body.attributes[0], '#3');
  });

  it('refuses a unit relation that cannot mean anything', async () => {
    const store = await new IfcParser().parseColumnar(
      new TextEncoder().encode(EXAMPLE).buffer as ArrayBuffer,
    );
    const model = readExampleModel(store, 0)!;
    const view = new MutablePropertyView(null, 'ziel');
    const editor = new StoreEditor(store as never, view);
    assert.throws(
      () => placeExampleInStore(editor, anchorFor(1), model, {
        position: [0, 0, 0],
        targetLengthUnitScale: 1,
      }),
      /unit/i,
    );
  });
});
