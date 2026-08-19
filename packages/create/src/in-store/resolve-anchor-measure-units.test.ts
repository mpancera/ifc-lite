/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `resolveSpatialAnchor` reads AREAUNIT and VOLUMEUNIT from the file, rather
 * than deriving them from LENGTHUNIT.
 *
 * The two files below are the two halves of the argument. An imperial Revit
 * export declares FOOT *and* SQUARE FOOT: squaring the length scale happens to
 * land close (0.3048² = 0.0929) but only because that file is internally
 * consistent, and nothing guarantees it. A metric millimetre export declares
 * MILLI.METRE lengths with plain SQUARE_METRE areas, where squaring is wrong
 * by a factor of a million — quantities are stated in the unit their own
 * measure type declares, which is the rule this pins.
 */

import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { resolveSpatialAnchor } from './resolve-anchor.js';

function model(units: string): string {
  return `ISO-10303-21;
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
${units}
#20=IFCLOCALPLACEMENT($,#6);
#30=IFCBUILDINGSTOREY('0storey000000000000000',$,'Level 0',$,$,#20,$,$,.ELEMENT.,0.);
ENDSEC;
END-ISO-10303-21;`;
}

/** Feet, square feet and cubic feet, each as its own conversion-based unit. */
const IMPERIAL_UNITS = `#9=IFCUNITASSIGNMENT((#41,#51,#61));
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

/** Millimetre lengths, SI areas and volumes — the usual metric CAD export. */
const METRIC_MM_UNITS = `#9=IFCUNITASSIGNMENT((#40,#50,#60));
#40=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#50=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#60=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`;

/** No unit assignment entries at all — IFC then means SI throughout. */
const NO_UNITS = `#9=IFCUNITASSIGNMENT(());`;

async function anchorFor(units: string) {
  const store = await new IfcParser().parseColumnar(
    new TextEncoder().encode(model(units)).buffer as ArrayBuffer,
    { disableWorkerScan: true },
  );
  return resolveSpatialAnchor(store, 30);
}

describe('resolveSpatialAnchor: declared area and volume units', () => {
  it('takes the imperial area/volume units from the file, not from the length unit', async () => {
    const anchor = await anchorFor(IMPERIAL_UNITS);
    expect(anchor.lengthUnitScale).toBeCloseTo(0.3048, 9);
    expect(anchor.areaUnitScale).toBeCloseTo(0.09290304, 9);
    expect(anchor.volumeUnitScale).toBeCloseTo(0.028316846592, 9);
  });

  it('keeps SI areas in a millimetre model instead of squaring the length scale', async () => {
    // The case that makes the squaring shortcut indefensible: 0.001² is
    // 1e-6, and the file plainly says square metre.
    const anchor = await anchorFor(METRIC_MM_UNITS);
    expect(anchor.lengthUnitScale).toBeCloseTo(0.001, 9);
    expect(anchor.areaUnitScale).toBe(1);
    expect(anchor.volumeUnitScale).toBe(1);
  });

  it('defaults to SI when the project declares no units', async () => {
    const anchor = await anchorFor(NO_UNITS);
    expect(anchor.areaUnitScale).toBe(1);
    expect(anchor.volumeUnitScale).toBe(1);
  });
});
