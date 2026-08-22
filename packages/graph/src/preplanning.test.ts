/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The pre-planning list, asserted against the case it was built for: a
 * detection installation partitioned into circuits, with the devices hanging
 * off them. That is the one that goes across to the schematic tool first, so
 * it is what the columns are checked against rather than a neutral fixture.
 *
 * The test that matters most is `is not fooled by the direction the graph was
 * walked`. Reading the structure off the chain's rank order published
 * eighteen detection circuits as planning objects hanging under detectors —
 * a file that imports without complaint and is upside down.
 */

import { describe, expect, it } from 'vitest';
import { buildRelationGraph, systemMembers } from './chain.js';
import { graphToPreplanning, preplanningToCsv, PREPLANNING_COLUMNS } from './preplanning.js';
import { edgeId } from './types.js';
import type { GraphSource } from './source.js';
import type { Graph, GraphNode, GraphNodeKind } from './types.js';

function node(
  expressId: number,
  kind: GraphNodeKind,
  ifcType: string,
  name: string,
  extras: Partial<GraphNode> = {},
): GraphNode {
  return {
    id: String(expressId),
    expressId,
    kind,
    ifcType,
    globalId: `guid${expressId}`,
    tag: '',
    name,
    assetIdentifier: '',
    predefinedType: '',
    flowDirection: '',
    systemType: '',
    ...extras,
  };
}

/**
 * Two circuits, three detectors, and one circuit nobody has put a detector in.
 *
 * The empty circuit is the point of the fixture: it is the finding a handover
 * check exists to surface, and a list that dropped it would read as complete.
 */
function circuitGraph(): Graph {
  const nodes = [
    node(500, 'system', 'IfcDistributionCircuit', 'MZ01', { predefinedType: 'FIREPROTECTION' }),
    node(501, 'system', 'IfcDistributionCircuit', 'MZ02', { predefinedType: 'FIREPROTECTION' }),
    node(502, 'system', 'IfcDistributionCircuit', 'MZ03', { predefinedType: 'FIREPROTECTION' }),
    node(100, 'element', 'IfcSensor', 'Melder', {
      predefinedType: 'FIRESENSOR',
      assetIdentifier: 'MZ01.01',
    }),
    node(101, 'element', 'IfcSensor', 'Melder', {
      predefinedType: 'FIRESENSOR',
      assetIdentifier: 'MZ01.02',
    }),
    node(102, 'element', 'IfcAlarm', 'Sirene', {
      predefinedType: 'SIREN',
      assetIdentifier: 'MZ02.01',
    }),
  ];
  const link = (source: number, target: number) => ({
    id: edgeId(String(source), String(target), 'IfcRelAssignsToGroup' as const),
    source: String(source),
    target: String(target),
    relation: 'IfcRelAssignsToGroup' as const,
  });
  return {
    nodes,
    edges: [link(100, 500), link(101, 500), link(102, 501)],
  };
}

describe('graphToPreplanning', () => {
  it('makes containers structure and devices planning objects', () => {
    const rows = graphToPreplanning(circuitGraph());

    expect(rows.filter((r) => r.Typ === 'Strukturabschnitt').map((r) => r.Kennzeichen)).toEqual([
      'MZ01',
      'MZ02',
      'MZ03',
    ]);
    expect(rows.filter((r) => r.Typ === 'Planungsobjekt')).toHaveLength(3);
  });

  it('writes the structure before what hangs off it', () => {
    const rows = graphToPreplanning(circuitGraph());
    const firstObject = rows.findIndex((r) => r.Typ === 'Planungsobjekt');
    const lastSegment = rows.map((r) => r.Typ).lastIndexOf('Strukturabschnitt');
    expect(lastSegment).toBeLessThan(firstObject);
  });

  it('names each object its parent', () => {
    const rows = graphToPreplanning(circuitGraph());
    const detector = rows.find((r) => r.Kennzeichen === 'MZ01.02');
    expect(detector?.Uebergeordnet).toBe('MZ01');
    // Nothing in this graph contains a circuit, so it is a root.
    expect(rows.find((r) => r.Kennzeichen === 'MZ01')?.Uebergeordnet).toBe('');
  });

  it('keeps a circuit with no devices in it', () => {
    // The whole reason this is not `graphToCsv`: a leaf-per-row list has no
    // room for a group nobody has filled, and that group is the finding.
    const rows = graphToPreplanning(circuitGraph());
    const empty = rows.find((r) => r.Kennzeichen === 'MZ03');
    expect(empty?.Typ).toBe('Strukturabschnitt');
    expect(empty?.Betriebsmittel).toBe('');
  });

  it('fills the installation and device aspects from the lineage', () => {
    const rows = graphToPreplanning(circuitGraph());
    const detector = rows.find((r) => r.Kennzeichen === 'MZ01.01');
    expect(detector?.Anlage).toBe('MZ01');
    expect(detector?.Betriebsmittel).toBe('MZ01.01');
    // Nothing in this graph says where the detector stands, so the location
    // aspect stays empty rather than borrowing the circuit's name.
    expect(detector?.Aufstellungsort).toBe('');
  });

  it('is not fooled by the direction the graph was walked', () => {
    // `systemMembers` starts at the installation and hops INWARD, the opposite
    // of every element-first chain. Read positionally, that inverts the whole
    // file. Built through the real chain rather than by hand, because the
    // rank order is exactly what used to be trusted.
    const source: GraphSource = {
      idsOfType: () => [],
      typeOf: (id) => (id === 500 ? 'IfcDistributionCircuit' : 'IfcSensor'),
      nameOf: (id) => (id === 500 ? 'MZ01' : 'Melder'),
      identifierOf: (id) => (id === 500 ? null : 'MZ01.01'),
      related: (id, relation, direction) =>
        relation === 'IfcRelAssignsToGroup' && direction === 'forward' && id === 500 ? [100] : [],
    };
    const graph = buildRelationGraph(source, systemMembers([500]));
    const rows = graphToPreplanning(graph);

    expect(rows.find((r) => r.Kennzeichen === 'MZ01')?.Typ).toBe('Strukturabschnitt');
    expect(rows.find((r) => r.Kennzeichen === 'MZ01.01')?.Typ).toBe('Planungsobjekt');
    expect(rows.find((r) => r.Kennzeichen === 'MZ01.01')?.Uebergeordnet).toBe('MZ01');
  });

  it('hangs a device under the nearest container, not the widest', () => {
    // A detector is in a room AND in an installation. A list can hang it under
    // one; the room is nearer, and the installation is not lost — it is what
    // the `Anlage` column is for.
    const graph: Graph = {
      nodes: [
        node(500, 'system', 'IfcDistributionCircuit', 'MZ01'),
        node(10, 'space', 'IfcSpace', '1.04'),
        node(100, 'element', 'IfcSensor', 'Melder', { assetIdentifier: 'MZ01.01' }),
      ],
      edges: [
        { id: 'a', source: '100', target: '500', relation: 'IfcRelAssignsToGroup' },
        { id: 'b', source: '100', target: '10', relation: 'IfcRelContainedInSpatialStructure' },
      ],
    };
    const detector = graphToPreplanning(graph).find((r) => r.Kennzeichen === 'MZ01.01');
    expect(detector?.Uebergeordnet).toBe('1.04');
    expect(detector?.Anlage).toBe('MZ01');
    expect(detector?.Aufstellungsort).toBe('1.04');
  });

  it('reads the location outward, storey before room', () => {
    // A location key is written coarse to fine.
    const nodes = [
      node(1, 'storey', 'IfcBuildingStorey', '01'),
      node(10, 'space', 'IfcSpace', '1.04'),
      node(100, 'element', 'IfcSensor', 'Melder', { assetIdentifier: 'MZ01.01' }),
    ];
    const graph: Graph = {
      nodes,
      edges: [
        { id: 'a', source: '100', target: '10', relation: 'IfcRelContainedInSpatialStructure' },
        { id: 'b', source: '10', target: '1', relation: 'IfcRelAggregates' },
      ],
    };
    const detector = graphToPreplanning(graph).find((r) => r.Kennzeichen === 'MZ01.01');
    expect(detector?.Aufstellungsort).toBe('01.1.04');
  });

  it('falls back from identifier to name to class, never to blank', () => {
    const graph = circuitGraph();
    graph.nodes.push(node(999, 'element', 'IfcSensor', ''));
    const rows = graphToPreplanning(graph);
    // No identifier and no name: still addressable, because a blank key
    // cannot be matched, corrected or reported.
    expect(rows.some((r) => r.Kennzeichen === 'IfcSensor-999')).toBe(true);
  });

  it('carries the GlobalId, which is what the round trip matches on', () => {
    const rows = graphToPreplanning(circuitGraph());
    expect(rows.find((r) => r.Kennzeichen === 'MZ01.01')?.IfcGlobalId).toBe('guid100');
  });

  it('separates the class from its PredefinedType', () => {
    const rows = graphToPreplanning(circuitGraph());
    const sounder = rows.find((r) => r.Kennzeichen === 'MZ02.01');
    // A schematic tool matches an article on the pair, and a column holding
    // `IfcAlarm.SIREN` cannot be filtered on either half.
    expect(sounder?.IfcKlasse).toBe('IfcAlarm');
    expect(sounder?.IfcTyp).toBe('SIREN');
    expect(sounder?.Beschreibung).toBe('IfcAlarm.SIREN');
  });
});

describe('preplanningToCsv', () => {
  it('leads with the column names the field assignment reads', () => {
    const csv = preplanningToCsv(circuitGraph());
    expect(csv.split('\r\n')[0]).toBe(PREPLANNING_COLUMNS.join(';'));
  });

  it('separates with semicolons and ends lines with CRLF', () => {
    const csv = preplanningToCsv(circuitGraph());
    expect(csv).toContain('\r\n');
    expect(csv).toContain('Planungsobjekt;MZ01.01;MZ01;');
  });

  it('neutralises a cell a spreadsheet would execute', () => {
    // This guard matters more here than in the other exports: an IEC 81346
    // key legitimately begins with `=` or `-`, so the case is normal rather
    // than adversarial.
    const graph = circuitGraph();
    graph.nodes.push(node(998, 'element', 'IfcSensor', '=MZ01+EG-B1'));
    const csv = preplanningToCsv(graph);
    expect(csv).toContain("'=MZ01+EG-B1");
  });

  it('quotes a cell holding the separator', () => {
    const graph = circuitGraph();
    graph.nodes.push(node(997, 'element', 'IfcSensor', 'Melder; Flur'));
    const csv = preplanningToCsv(graph);
    expect(csv).toContain('"Melder; Flur"');
  });
});
