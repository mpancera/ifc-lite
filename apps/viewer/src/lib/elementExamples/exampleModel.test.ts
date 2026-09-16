/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IfcParser } from '@ifc-lite/parser';
import { readExampleModel } from './exampleModel.js';

/**
 * A miniature of what the dictionary publishes: a device, a clearance body
 * that points at it, and a plan symbol that points at it too.
 *
 * Written out as real STEP and put through the real parser rather than faked
 * as an object graph — the reading logic depends on how the parser spells
 * entity types in `byType` and on what `extractEntity` hands back, and a fake
 * would test the fake.
 */
function exampleFile(): ArrayBuffer {
  const step = `ISO-10303-21;
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
#5=IFCPROJECT('0project',$,'Probe',$,$,$,$,(#3),$);
#6=IFCBUILDINGSTOREY('0storey',$,'Ebene',$,$,#4,$,$,.ELEMENT.,0.);
#10=IFCCIRCLEPROFILEDEF(.AREA.,$,#2,0.1);
#11=IFCEXTRUDEDAREASOLID(#10,#2,$,0.5);
#12=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#11));
#13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));
#14=IFCFIRESUPPRESSIONTERMINAL('0device',$,'Handfeuerloescher',$,'FIREEXTINGUISHER',#4,#13,$,.USERDEFINED.);
#20=IFCEXTRUDEDAREASOLID(#10,#2,$,0.8);
#21=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#20));
#22=IFCPRODUCTDEFINITIONSHAPE($,$,(#21));
#23=IFCVIRTUALELEMENT('0clear',$,'Freihaltebereich',$,$,#4,#22,$,.CLEARANCE.);
#30=IFCPOLYLINE((#1,#1));
#31=IFCSHAPEREPRESENTATION(#3,'Annotation','Curve2D',(#30));
#32=IFCPRODUCTDEFINITIONSHAPE($,$,(#31));
#33=IFCANNOTATION('0symbol',$,'Plansymbol',$,$,#4,#32);
#40=IFCRELCONTAINEDINSPATIALSTRUCTURE('0rel1',$,$,$,(#14,#23,#33),#6);
#41=IFCRELASSIGNSTOPRODUCT('0rel2',$,$,$,(#23,#33),$,#14);
ENDSEC;
END-ISO-10303-21;
`;
  return new TextEncoder().encode(step).buffer as ArrayBuffer;
}

async function readProbe() {
  const store = await new IfcParser().parseColumnar(exampleFile());
  const model = readExampleModel(store, 1);
  assert.ok(model, 'the probe must read as a placeable example');
  return model;
}

describe('readExampleModel', () => {
  it('picks the device the companions point at, not the first product', () => {
    return readProbe().then((model) => {
      assert.equal(model.device.type, 'IFCFIRESUPPRESSIONTERMINAL');
      assert.equal(model.device.name, 'Handfeuerloescher');
      assert.equal(model.device.predefinedType, 'USERDEFINED');
      assert.equal(model.device.objectType, 'FIREEXTINGUISHER');
    });
  });

  it('keeps the clearance and the symbol as their own products', () => {
    // Placing them into the device would make the file say the device is as
    // deep as the space that must stay free in front of it.
    return readProbe().then((model) => {
      const types = model.companions.map((c) => c.type).sort();
      assert.deepEqual(types, ['IFCANNOTATION', 'IFCVIRTUALELEMENT']);
    });
  });

  it('resolves each product’s representations through its shape', () => {
    return readProbe().then((model) => {
      assert.deepEqual(
        model.device.representations.map((r) => r.identifier),
        ['Body'],
      );
      const symbol = model.companions.find((c) => c.type === 'IFCANNOTATION')!;
      assert.deepEqual(symbol.representations.map((r) => r.identifier), ['Annotation']);
    });
  });

  it('collects the contexts that have to be substituted on copy', () => {
    // Copied along, the source's context would bring its own units and
    // precision into a model that already has both.
    return readProbe().then((model) => {
      assert.deepEqual(model.contextIds, [3]);
      for (const representation of model.device.representations) {
        assert.equal(representation.contextId, 3);
      }
    });
  });

  it('reads every entity of the source, for the copier', () => {
    return readProbe().then((model) => {
      const solid = model.read(11);
      // The type comes back as the FILE spells it, in STEP's uppercase.
      // `StoreEditor.addEntity` accepts that and normalises, so the copy needs
      // no case handling of its own.
      assert.equal(solid?.type, 'IFCEXTRUDEDAREASOLID');
      // An id the file does not have reads as null, which the copier turns
      // into a refusal rather than a hole.
      assert.equal(model.read(9999), null);
    });
  });

  it('returns null for a file with nothing placed in the spatial structure', () => {
    // Not a crash: the caller says "this cannot be placed" instead of placing
    // nothing and reporting success.
    const empty = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('leer','2026-09-16T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
ENDSEC;
END-ISO-10303-21;
`;
    return new IfcParser()
      .parseColumnar(new TextEncoder().encode(empty).buffer as ArrayBuffer)
      .then((store) => {
        assert.equal(readExampleModel(store, 1), null);
      });
  });
});
