/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { copySubgraph, type SourceEntity } from './copy-subgraph.js';

/** A target model with a handful of existing ids, so renumbering is visible. */
function makeEditor(existingIds = [1, 2, 3]) {
  const store = {
    entityIndex: { byId: new Map(existingIds.map((id) => [id, { expressId: id }])) },
  } as never;
  const view = new MutablePropertyView();
  return new StoreEditor(store, view);
}

/** The source file, as a plain map — this is all `copySubgraph` ever sees. */
function reader(entities: Record<number, SourceEntity>) {
  return (id: number) => entities[id] ?? null;
}

/** What actually landed in the overlay, keyed by new express id. */
function written(editor: StoreEditor) {
  const out = new Map<number, SourceEntity>();
  for (const e of editor.getNewEntities()) {
    out.set(e.expressId, { type: e.type, attributes: e.attributes });
  }
  return out;
}

describe('copySubgraph', () => {
  it('renumbers every reference into the target’s id space', () => {
    const editor = makeEditor();
    const read = reader({
      10: { type: 'IfcCartesianPoint', attributes: [[0, 0, 0]] },
      11: { type: 'IfcAxis2Placement3D', attributes: [10, null, null] },
      12: { type: 'IfcCircleProfileDef', attributes: ['.AREA.', null, 11, 0.1] },
    });

    const root = copySubgraph(editor, read, 12, { substitutions: new Map() });
    const overlay = written(editor);

    // Nothing may still point at a source id: the target has its own #10-#12.
    const profile = overlay.get(root)!;
    expect(profile.type).toBe('IfcCircleProfileDef');
    const placementId = Number((profile.attributes[2] as string).slice(1));
    expect(placementId).not.toBe(11);
    const placement = overlay.get(placementId)!;
    expect(placement.type).toBe('IfcAxis2Placement3D');
    const pointId = Number((placement.attributes[0] as string).slice(1));
    expect(overlay.get(pointId)!.type).toBe('IfcCartesianPoint');
  });

  it('puts the target’s context in place of the source’s, instead of copying it', () => {
    // The load-bearing substitution. Copied along, the source's context would
    // bring its own units and precision into a model that already has both —
    // and the geometry would be declared against a context nobody here uses.
    const editor = makeEditor();
    const read = reader({
      20: { type: 'IfcGeometricRepresentationContext', attributes: [null, "'Model'", 3, 1e-5] },
      21: { type: 'IfcShapeRepresentation', attributes: [20, 'Body', 'SweptSolid', []] },
    });

    const substitutions = new Map([[20, 2]]); // #2 is the target's own context
    const root = copySubgraph(editor, read, 21, { substitutions });
    const overlay = written(editor);

    expect(overlay.get(root)!.attributes[0]).toBe('#2');
    // And it was not copied: only the shape representation is new.
    expect([...overlay.values()].map((e) => e.type)).toEqual(['IfcShapeRepresentation']);
  });

  it('copies a shared child once, so a diamond stays a diamond', () => {
    // Two solids over one profile. Copied twice, the file would carry two
    // profiles that happen to hold the same numbers — and a reader checking
    // whether two solids share a profile would get the wrong answer.
    const editor = makeEditor();
    const read = reader({
      30: { type: 'IfcCircleProfileDef', attributes: ['.AREA.', null, null, 0.1] },
      31: { type: 'IfcExtrudedAreaSolid', attributes: [30, null, null, 0.5] },
      32: { type: 'IfcExtrudedAreaSolid', attributes: [30, null, null, 0.8] },
      33: { type: 'IfcBooleanResult', attributes: ['.DIFFERENCE.', 31, 32] },
    });

    copySubgraph(editor, read, 33, { substitutions: new Map() });
    const types = [...written(editor).values()].map((e) => e.type);

    expect(types.filter((t) => t === 'IfcCircleProfileDef')).toHaveLength(1);
  });

  it('copies a subgraph shared by two roots once', () => {
    // The same map is handed to both calls, which is what makes the second
    // root reuse what the first already brought over — a device and its
    // clearance body sharing a profile, say.
    const editor = makeEditor();
    const read = reader({
      40: { type: 'IfcCircleProfileDef', attributes: ['.AREA.', null, null, 0.1] },
      41: { type: 'IfcExtrudedAreaSolid', attributes: [40, null, null, 0.5] },
      42: { type: 'IfcExtrudedAreaSolid', attributes: [40, null, null, 0.8] },
    });

    const substitutions = new Map<number, number>();
    copySubgraph(editor, read, 41, { substitutions });
    copySubgraph(editor, read, 42, { substitutions });

    const types = [...written(editor).values()].map((e) => e.type);
    expect(types.filter((t) => t === 'IfcCircleProfileDef')).toHaveLength(1);
  });

  it('shortens a list around a dropped member instead of leaving a hole', () => {
    // `$` inside a SET OF IfcRepresentationItem is the kind of record a reader
    // accepts and then cannot use.
    const editor = makeEditor();
    const read = reader({
      50: { type: 'IfcCartesianPoint', attributes: [[0, 0, 0]] },
      51: { type: 'IfcPresentationLayerAssignment', attributes: ["'Layer'", null, [], null] },
      52: { type: 'IfcShapeRepresentation', attributes: [null, 'Body', 'Brep', [50, 51]] },
    });

    const root = copySubgraph(editor, read, 52, {
      substitutions: new Map(),
      drop: new Set(['IfcPresentationLayerAssignment']),
    });

    const items = written(editor).get(root)!.attributes[3] as string[];
    expect(items).toHaveLength(1);
    expect(items[0].startsWith('#')).toBe(true);
  });

  it('refuses a cyclic graph rather than paste something wrong', () => {
    const editor = makeEditor();
    const read = reader({
      60: { type: 'IfcBooleanResult', attributes: ['.UNION.', 61, null] },
      61: { type: 'IfcBooleanResult', attributes: ['.UNION.', 60, null] },
    });

    expect(() => copySubgraph(editor, read, 60, { substitutions: new Map() }))
      .toThrow(/cyclic/i);
  });

  it('refuses when the source is missing an id the graph references', () => {
    // A truncated or half-written file. Pasting what could be read would give
    // a solid with no profile, which renders as nothing and reads as fine.
    const editor = makeEditor();
    const read = reader({
      70: { type: 'IfcExtrudedAreaSolid', attributes: [71, null, null, 0.5] },
    });

    expect(() => copySubgraph(editor, read, 70, { substitutions: new Map() }))
      .toThrow(/#71/);
  });

  it('leaves a diamond legal: the same child, reached twice on one path, is not a cycle', () => {
    const editor = makeEditor();
    const read = reader({
      80: { type: 'IfcCartesianPoint', attributes: [[0, 0, 0]] },
      81: { type: 'IfcPolyline', attributes: [[80, 80]] },
    });

    const root = copySubgraph(editor, read, 81, { substitutions: new Map() });
    const points = written(editor).get(root)!.attributes[0] as string[];

    // The closed-polyline idiom: first point repeated at the end, as the SAME
    // reference. A reader checking for closure on reference equality must
    // still see it closed after the copy.
    expect(points[0]).toBe(points[1]);
  });
  it('writes a reference as "#n", though the source spells it as a number', () => {
    // THE TWO SIDES DISAGREE, and a first version of this file got it wrong.
    // `extractEntity` hands a reference back as a plain NUMBER; an entity
    // authored through the overlay must carry the STRING. A number written
    // into the slot is a STEP integer, `authoredEntityRefs` sees no reference
    // there, and the child drops out of the export closure — leaving a solid
    // whose profile is missing from the file.
    const editor = makeEditor();
    const read = reader({
      90: { type: 'IfcCartesianPoint', attributes: [[0, 0, 0]] },
      91: { type: 'IfcPolyline', attributes: [[90, 90]] },
    });

    const root = copySubgraph(editor, read, 91, { substitutions: new Map() });
    const points = written(editor).get(root)!.attributes[0] as string[];

    expect(points).toHaveLength(2);
    for (const point of points) expect(point).toMatch(/^#\d+$/);
    expect(points[0]).toBe(points[1]);
  });

  it('quotes a string that STEP would otherwise read as a token', () => {
    // The extractor hands strings back UNQUOTED, so a Name whose text happens
    // to be `#12` or `.FOO.` arrives indistinguishable from a reference or an
    // enum. The serializer's own comment names this one.
    const editor = makeEditor();
    const read = reader({
      95: {
        type: 'IfcSensor',
        attributes: ['0guid', null, '#12', '.NOTAREALENUM.', null, null, null, null, '.SMOKESENSOR.'],
        // Only the LAST attribute was a bare enum in the source.
        enumAttrIndices: [8],
      },
    });

    const root = copySubgraph(editor, read, 95, { substitutions: new Map() });
    const sensor = written(editor).get(root)!;

    expect(sensor.attributes[2]).toBe("'#12'");
    expect(sensor.attributes[3]).toBe("'.NOTAREALENUM.'");
    // The real enum keeps its dots and stays an enum.
    expect(sensor.attributes[8]).toBe('.SMOKESENSOR.');
  });
});
