/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Duplicate a product through the REAL parser and look at the exported STEP.
 *
 * `duplicate.test.ts` drives the builder from a hand-written `SourceAttributes`,
 * which is the right shape for pinning what the builder rewrites — but its
 * fixture spells references as strings (`'#99'`), and the parser never
 * produces that. So the one attribute the builder passed through untouched was
 * wrong in production and green in the test for two years: `Representation`
 * came out of the extractor as the NUMBER 13 and was written into the
 * duplicate as a STEP integer.
 *
 * This file closes that gap the only way it can be closed — by starting from
 * real STEP and reading real STEP back out.
 */

import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { resolveDuplicateSource } from './resolve-source.js';
import { duplicateInStore } from './duplicate.js';

const SOURCE = `ISO-10303-21;
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
#10=IFCRECTANGLEPROFILEDEF(.AREA.,$,#2,1.,0.2);
#11=IFCEXTRUDEDAREASOLID(#10,#2,$,3.);
#12=IFCSHAPEREPRESENTATION(#3,'Body','SweptSolid',(#11));
#13=IFCPRODUCTDEFINITIONSHAPE($,$,(#12));
#14=IFCLOCALPLACEMENT(#4,#2);
#15=IFCWALL('0wall00000000000000000',#5,'Wand A',$,$,#14,#13,'W1',.STANDARD.);
#40=IFCRELCONTAINEDINSPATIALSTRUCTURE('0rel1',#5,$,$,(#15),#6);
ENDSEC;
END-ISO-10303-21;
`;

async function duplicateAndExport() {
  const store = await new IfcParser().parseColumnar(
    new TextEncoder().encode(SOURCE).buffer as ArrayBuffer,
  );
  const view = new MutablePropertyView(null, 'probe');
  const editor = new StoreEditor(store as never, view);
  const source = resolveDuplicateSource(store, 15);
  const result = duplicateInStore(editor, source);

  const exported = await new StepExporter(store as never, view as never).export({
    applyMutations: true,
    schema: 'IFC4',
  });
  // `content` is bytes, not a string — the exporter hands back what a
  // download would write.
  const raw = (exported as { content: unknown }).content;
  const content = typeof raw === 'string'
    ? raw
    : new TextDecoder().decode(raw as Uint8Array);
  const walls = content.split(/\r?\n/).filter((line) => line.includes('IFCWALL'));
  return { source, result, walls };
}

describe('duplicating a product, end to end', () => {
  it('writes Representation as a reference, not as an integer', async () => {
    const { walls } = await duplicateAndExport();
    expect(walls).toHaveLength(2);

    const copy = walls.find((line) => line.includes('(copy)'))!;
    // The exact shape of the defect: `...,#43,13,'W1',...` — an integer where
    // the schema wants an IfcProductRepresentation.
    expect(copy).not.toMatch(/,13,/);
    expect(copy).toContain('#13');
  });

  it('gives the duplicate the same geometry the source has', async () => {
    const { walls } = await duplicateAndExport();
    const original = walls.find((line) => !line.includes('(copy)'))!;
    const copy = walls.find((line) => line.includes('(copy)'))!;

    const representationOf = (line: string) => line.split(',').at(-3);
    expect(representationOf(copy)).toBe(representationOf(original));
  });

  it('still gives it its own placement', async () => {
    // The point of a duplicate: same geometry, different place. A fix that
    // shared the placement too would be a different bug.
    const { walls } = await duplicateAndExport();
    const original = walls.find((line) => !line.includes('(copy)'))!;
    const copy = walls.find((line) => line.includes('(copy)'))!;

    const placementOf = (line: string) => line.split(',').at(-4);
    expect(placementOf(copy)).not.toBe(placementOf(original));
  });

  it('reads a reference out of the parser as a number — the reason for all this', async () => {
    // Pinned so the asymmetry cannot be forgotten again: the parser hands back
    // a number, the overlay demands a string, and nothing in between complains.
    const { source } = await duplicateAndExport();
    expect(typeof source.attributes[6]).toBe('number');
    expect(source.attributes[6]).toBe(13);
  });
});
