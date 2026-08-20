/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A detection tree written to a file has to say the same thing the drawing
 * said — including the parts of it that are findings.
 */

import { describe, expect, it } from 'vitest';
import { graphToCsv, graphToJson, graphTreeOf } from './export.js';
import { elementInSpaceInStorey, elementInSpaceInZone } from './chain.js';
import { edgeId } from './types.js';
import type { Graph, GraphNode, GraphNodeKind } from './types.js';

function node(expressId: number, kind: GraphNodeKind, ifcType: string, name: string): GraphNode {
  return { id: String(expressId), expressId, kind, ifcType, name };
}

/** Storey 1 holds rooms 10 and 11; room 10 holds two detectors, 11 holds one. */
function floorGraph(): Graph {
  const nodes = [
    node(1, 'storey', 'IfcBuildingStorey', '00'),
    node(10, 'space', 'IfcSpace', '0.01'),
    node(11, 'space', 'IfcSpace', '0.02'),
    node(100, 'element', 'IfcSensor', 'RM 001'),
    node(101, 'element', 'IfcSensor', 'RM 002'),
    node(102, 'element', 'IfcAlarm', 'Sirene'),
  ];
  const link = (source: number, target: number, relation: Parameters<typeof edgeId>[2]) => ({
    id: edgeId(String(source), String(target), relation),
    source: String(source),
    target: String(target),
    relation,
  });
  return {
    nodes,
    edges: [
      link(100, 10, 'IfcRelContainedInSpatialStructure'),
      link(101, 10, 'IfcRelContainedInSpatialStructure'),
      link(102, 11, 'IfcRelContainedInSpatialStructure'),
      link(10, 1, 'IfcRelAggregates'),
      link(11, 1, 'IfcRelAggregates'),
    ],
  };
}

const CHAIN = elementInSpaceInStorey(['IfcSensor', 'IfcAlarm']);

describe('graphTreeOf', () => {
  it('roots the tree at the outermost rank, not at the elements', () => {
    const tree = graphTreeOf(floorGraph(), CHAIN);
    expect(tree.map((t) => t.name)).toEqual(['00']);
    expect(tree[0].children.map((c) => c.name).sort()).toEqual(['0.01', '0.02']);
  });

  it('hangs each element under the room it is in', () => {
    const tree = graphTreeOf(floorGraph(), CHAIN);
    const room = tree[0].children.find((c) => c.name === '0.01')!;
    expect(room.children.map((c) => c.name).sort()).toEqual(['RM 001', 'RM 002']);
  });

  it('keeps an element the chain could not place, rather than dropping it', () => {
    // A detector in no room is the finding the tree exists to surface.
    const graph = floorGraph();
    graph.nodes.push(node(103, 'element', 'IfcSensor', 'RM 999'));
    const tree = graphTreeOf(graph, CHAIN);
    const loose = tree.find((t) => t.name === 'RM 999');
    expect(loose, 'the unplaced detector must still appear').toBeTruthy();
    expect(loose!.children).toEqual([]);
  });

  it('lists a room that belongs to two zones under both', () => {
    // Two groups over one room is a real modelling state; picking one would
    // invent a decision the file does not carry.
    const zoneChain = elementInSpaceInZone(['IfcSensor']);
    const graph: Graph = {
      nodes: [
        node(20, 'zone', 'IfcZone', 'MG 13'),
        node(21, 'zone', 'IfcZone', 'MG 14'),
        node(10, 'space', 'IfcSpace', '0.01'),
        node(100, 'element', 'IfcSensor', 'RM 001'),
      ],
      edges: [
        { id: 'a', source: '100', target: '10', relation: 'IfcRelContainedInSpatialStructure' },
        { id: 'b', source: '10', target: '20', relation: 'IfcRelAssignsToGroup' },
        { id: 'c', source: '10', target: '21', relation: 'IfcRelAssignsToGroup' },
      ],
    };
    const tree = graphTreeOf(graph, zoneChain);
    expect(tree.map((t) => t.name).sort()).toEqual(['MG 13', 'MG 14']);
    for (const zone of tree) {
      expect(zone.children[0]?.children[0]?.name).toBe('RM 001');
    }
  });
});

describe('graphToCsv', () => {
  it('puts the outermost rank first and the element last', () => {
    const csv = graphToCsv(floorGraph(), CHAIN);
    const [header, ...rows] = csv.split('\r\n');
    expect(header).toBe('Storey;Space;Element;IfcType;ExpressId');
    expect(rows).toContain('00;0.01;RM 001;IfcSensor;100');
    expect(rows).toContain('00;0.02;Sirene;IfcAlarm;102');
  });

  it('writes one row per element and no more', () => {
    const rows = graphToCsv(floorGraph(), CHAIN).split('\r\n').slice(1);
    expect(rows).toHaveLength(3);
  });

  it('leaves the ancestor cells empty for an element in no room', () => {
    const graph = floorGraph();
    graph.nodes.push(node(103, 'element', 'IfcSensor', 'RM 999'));
    const rows = graphToCsv(graph, CHAIN).split('\r\n').slice(1);
    expect(rows).toContain(';;RM 999;IfcSensor;103');
  });

  it('neutralises a name a spreadsheet would execute', () => {
    const graph = floorGraph();
    graph.nodes.push(node(104, 'element', 'IfcSensor', '=1+1'));
    expect(graphToCsv(graph, CHAIN)).toContain(";;'=1+1;IfcSensor;104");
  });

  it('quotes a name carrying the separator', () => {
    const graph = floorGraph();
    graph.nodes.push(node(105, 'element', 'IfcSensor', 'A;B'));
    expect(graphToCsv(graph, CHAIN)).toContain(';;"A;B";IfcSensor;105');
  });
});

describe('graphToJson', () => {
  it('names the rank order outermost first, so the depth is readable', () => {
    expect(graphToJson(floorGraph(), CHAIN).ranks).toEqual(['storey', 'space', 'element']);
  });

  it('carries the counts the drawing showed', () => {
    const json = graphToJson(floorGraph(), CHAIN);
    expect(json.nodeCount).toBe(6);
    expect(json.edgeCount).toBe(5);
  });

  it('survives a round trip through JSON, which is the point of it', () => {
    const json = graphToJson(floorGraph(), CHAIN);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});
