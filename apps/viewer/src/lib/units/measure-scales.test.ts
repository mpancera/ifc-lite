/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Read against real parsed files, because the whole point of this module is
 * what a FILE declares — a stub would only restate the expectation.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { areaUnitScaleFor, volumeUnitScaleFor, measureScalesFor } from './measure-scales.js';

function model(units: string): string {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('t.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0proj00000000000000000',$,'P',$,$,$,$,$,#9);
${units}
ENDSEC;
END-ISO-10303-21;`;
}

/** What a Revit imperial export writes: three separate conversion units. */
const IMPERIAL = `#9=IFCUNITASSIGNMENT((#41,#51,#61));
#40=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#41=IFCCONVERSIONBASEDUNIT(#42,.LENGTHUNIT.,'FOOT',#43);
#42=IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0);
#43=IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),#40);
#50=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#51=IFCCONVERSIONBASEDUNIT(#52,.AREAUNIT.,'SQUARE FOOT',#53);
#52=IFCDIMENSIONALEXPONENTS(2,0,0,0,0,0,0);
#53=IFCMEASUREWITHUNIT(IFCAREAMEASURE(0.09290304),#50);
#60=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#61=IFCCONVERSIONBASEDUNIT(#62,.VOLUMEUNIT.,'CUBIC FOOT',#63);
#62=IFCDIMENSIONALEXPONENTS(3,0,0,0,0,0,0);
#63=IFCMEASUREWITHUNIT(IFCVOLUMEMEASURE(0.028316846592),#60);`;

/** Millimetre lengths beside SI areas — the combination that broke the square. */
const METRIC_MM = `#9=IFCUNITASSIGNMENT((#40,#50));
#40=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#50=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`;

async function parse(units: string): Promise<IfcDataStore> {
  const bytes = new TextEncoder().encode(model(units));
  return new IfcParser().parseColumnar(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

let imperial: IfcDataStore;
let metricMm: IfcDataStore;

before(async () => {
  imperial = await parse(IMPERIAL);
  metricMm = await parse(METRIC_MM);
});

describe('measure scales', () => {
  it('reads the imperial area and volume units the file declares', () => {
    assert.ok(Math.abs(areaUnitScaleFor(imperial) - 0.09290304) < 1e-9);
    assert.ok(Math.abs(volumeUnitScaleFor(imperial) - 0.028316846592) < 1e-9);
  });

  it('keeps square metres in a millimetre model', () => {
    // 0.001² would be 1e-6 — the factor that made a 24.5 m² room print as
    // 0.0000245 m² before this stopped being derived from the length unit.
    assert.equal(areaUnitScaleFor(metricMm), 1);
  });

  it('assumes SI for a project that declares nothing', () => {
    assert.deepEqual(measureScalesFor(null), { area: 1, volume: 1 });
  });

  it('answers the same store from cache, not by re-parsing it', () => {
    // Same object identity means the WeakMap hit, which is what keeps the
    // plan labels off a full source re-scan per storey.
    assert.equal(measureScalesFor(imperial), measureScalesFor(imperial));
  });
});
