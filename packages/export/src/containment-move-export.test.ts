/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Refiling an element under another storey survives the export.
 *
 * The move is TWO edits that only make sense together: the old
 * `IfcRelContainedInSpatialStructure` loses the element from its
 * `RelatedElements` (a positional rewrite of an existing record), and the
 * target gains it — through a rewrite when it already has a relationship, and
 * through a freshly created one when it does not. Losing either half is worse
 * than losing both: the element ends up filed nowhere at all, in a file that
 * still parses.
 *
 * Both halves go through machinery that is generic (positional overrides,
 * overlay-created entities), which is exactly why they deserve a test naming
 * this use of it — a regression here is silent, and only visible after the
 * file has been handed on.
 */

import { describe, it, expect } from 'vitest';
import { IfcParser, extractPropertiesOnDemand } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { StepExporter } from './step-exporter.js';

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const NL = String.fromCharCode(10);

const IFC = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('t.ifc','',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0proj00000000000000001',$,'P',$,$,$,$,$,$);
#40=IFCBUILDINGSTOREY('0stor00000000000000001',$,'EG',$,$,$,$,$,.ELEMENT.,0.);
#41=IFCBUILDINGSTOREY('0stor00000000000000002',$,'OG',$,$,$,$,$,.ELEMENT.,3.);
#10=IFCWALL('0wall00000000000000001',$,'W1',$,$,$,$,$,$);
#20=IFCWALL('0wall00000000000000002',$,'W2',$,$,$,$,$,$);
#50=IFCRELCONTAINEDINSPATIALSTRUCTURE('0rel000000000000000001',$,$,$,(#10,#20),#40);
ENDSEC;
END-ISO-10303-21;`;

async function parse() {
  const store = await new IfcParser().parseColumnar(
    new TextEncoder().encode(IFC).buffer, { disableWorkerScan: true },
  );
  const view = new MutablePropertyView(null, 'm');
  view.setOnDemandExtractor((id: number) => extractPropertiesOnDemand(store, id));
  return { store, view };
}

const exportStep = (store: Awaited<ReturnType<typeof parse>>['store'], view: MutablePropertyView) =>
  decode(new StepExporter(store, view).export({ schema: 'IFC4', applyMutations: true }).content);

const containments = (step: string) =>
  step.split(NL).filter((l) => l.includes('IFCRELCONTAINEDINSPATIALSTRUCTURE'));

describe('StepExporter — an element refiled under another storey', () => {
  it('writes the shortened source relationship AND the created one', async () => {
    const { store, view } = await parse();
    const editor = new StoreEditor(store, view);

    // The move, exactly as `assignElementsToStorey` performs it.
    view.setPositionalAttribute(50, 4, ['#20'] as never);
    const created = editor.addEntity('IfcRelContainedInSpatialStructure', [
      '0new000000000000000001', null, null, null, ['#10'], '#41',
    ] as never);

    const out = exportStep(store, view);
    const rels = containments(out);

    expect(rels).toHaveLength(2);
    // #10 left the ground floor …
    expect(rels.find((l) => l.startsWith('#50='))).toContain('(#20),#40');
    // … and arrived on the upper one, in a relationship that did not exist.
    const arrival = rels.find((l) => l.startsWith(`#${created.expressId}=`));
    expect(arrival).toBeTruthy();
    expect(arrival).toContain('(#10),#41');
  });

  it('leaves no element filed nowhere — every wall is in exactly one relationship', async () => {
    const { store, view } = await parse();
    const editor = new StoreEditor(store, view);
    view.setPositionalAttribute(50, 4, ['#20'] as never);
    editor.addEntity('IfcRelContainedInSpatialStructure', [
      '0new000000000000000001', null, null, null, ['#10'], '#41',
    ] as never);

    const out = exportStep(store, view);
    for (const wall of ['#10', '#20']) {
      const holding = containments(out).filter((l) => {
        const list = l.slice(l.indexOf('$,$,(') + 5, l.indexOf('),#'));
        return list.split(',').includes(wall);
      });
      expect(holding, `${wall} should be filed exactly once`).toHaveLength(1);
    }
  });

  it('drops a relationship the move emptied rather than writing an empty set', async () => {
    const { store, view } = await parse();
    // Both walls leave: RelatedElements is SET[1:?], so the record must go.
    view.setPositionalAttribute(50, 4, ['#20'] as never);
    const editor = new StoreEditor(store, view);
    editor.addEntity('IfcRelContainedInSpatialStructure', [
      '0new000000000000000001', null, null, null, ['#10'], '#41',
    ] as never);
    editor.removeEntity(50);

    const out = exportStep(store, view);
    expect(out).not.toContain('#50=');
    expect(containments(out).some((l) => l.includes('()'))).toBe(false);
  });
});
