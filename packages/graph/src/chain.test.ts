/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  buildRelationGraph,
  chainRanks,
  danglingNodes,
  elementInSpaceInStorey,
  elementInSpaceInZone,
  plantTopology,
  systemMembers,
  systemMembersInSpace,
} from './chain.js';
import type { GraphSource } from './source.js';
import type { GraphRelation, RelationDirection } from './types.js';

/**
 * A model small enough to hold in your head, shaped like the ones that cause
 * trouble:
 *
 *   Storey 100 ──aggregates──> Space 200 "Buero 1.01" ──in zone──> Zone 400
 *                          └─> Space 201 "Flur 1.02"   (in no zone)
 *
 *   Sensor 300 in Space 200        — the ordinary case
 *   Sensor 301 in Space 200        — two elements, one room
 *   Sensor 302 in Space 201        — a room outside every zone
 *   Sensor 303 in STOREY 100       — contained in the storey directly
 *
 * Sensor 303 is the case worth pinning: authoring tools do this all the time,
 * and it is the reason the space hop filters on type instead of trusting
 * `IfcRelContainedInSpatialStructure` to mean "room".
 */
interface Entity {
  type: string;
  name?: string;
}

const ENTITIES: Record<number, Entity> = {
  100: { type: 'IfcBuildingStorey', name: '1. Obergeschoss' },
  200: { type: 'IfcSpace', name: 'Buero 1.01' },
  201: { type: 'IfcSpace', name: 'Flur 1.02' },
  300: { type: 'IfcSensor', name: 'BM-01' },
  301: { type: 'IfcSensor', name: 'BM-02' },
  302: { type: 'IfcSensor', name: 'BM-03' },
  303: { type: 'IfcSensor', name: 'BM-04' },
  400: { type: 'IfcZone', name: 'Brandabschnitt A' },
  // Two systems over the same relationship the zone uses. That overlap is the
  // point: `IfcRelAssignsToGroup` carries zones AND systems, and only the
  // direction plus the kept types tell the two chains apart.
  500: { type: 'IfcSystem', name: 'Brandmeldeanlage' },
  501: { type: 'IfcSystem', name: 'Fluchtwegleuchten' },
};

/** relating → related, exactly as the STEP relationship carries it. */
const RELATIONS: Record<GraphRelation, ReadonlyArray<readonly [number, number]>> = {
  IfcRelContainedInSpatialStructure: [
    [200, 300],
    [200, 301],
    [201, 302],
    [100, 303],
  ],
  IfcRelAggregates: [
    [100, 200],
    [100, 201],
  ],
  IfcRelAssignsToGroup: [
    [400, 200],
    [500, 300],
    [500, 301],
    [500, 303],
    // 501 has no members — an empty system, which is a finding rather than
    // something to hide.
  ],
  IfcRelReferencedInSpatialStructure: [],
  // The port relations belong to the plant-topology chain, which brings its
  // own fixture. Named here because the map is exhaustive over GraphRelation:
  // a relation added to the union has to be answered for, even if the answer
  // is "this fixture has none".
  IfcRelConnectsPortToElement: [],
  IfcRelConnectsPorts: [],
};

const source: GraphSource = {
  idsOfType: (ifcType) =>
    Object.entries(ENTITIES)
      .filter(([, e]) => e.type === ifcType)
      .map(([id]) => Number(id)),
  typeOf: (id) => ENTITIES[id]?.type ?? null,
  nameOf: (id) => ENTITIES[id]?.name ?? null,
  related: (id, relation: GraphRelation, direction: RelationDirection) =>
    RELATIONS[relation]
      .filter(([relating, related]) => (direction === 'forward' ? relating : related) === id)
      .map(([relating, related]) => (direction === 'forward' ? related : relating)),
};

describe('buildRelationGraph', () => {
  it('joins element, room and zone into one chain', () => {
    const graph = buildRelationGraph(source, elementInSpaceInZone(['IfcSensor']));

    expect(graph.nodes.filter((n) => n.kind === 'element')).toHaveLength(4);
    expect(graph.nodes.filter((n) => n.kind === 'space').map((n) => n.name).sort()).toEqual([
      'Buero 1.01',
      'Flur 1.02',
    ]);
    expect(graph.nodes.filter((n) => n.kind === 'zone').map((n) => n.name)).toEqual([
      'Brandabschnitt A',
    ]);

    // BM-01 and BM-02 both reach Buero 1.01, which reaches the zone once.
    expect(graph.edges.filter((e) => e.relation === 'IfcRelContainedInSpatialStructure')).toHaveLength(3);
    expect(graph.edges.filter((e) => e.relation === 'IfcRelAssignsToGroup')).toHaveLength(1);
  });

  it('keeps an element the chain could not place, rather than dropping it', () => {
    const graph = buildRelationGraph(source, elementInSpaceInZone(['IfcSensor']));

    // BM-04 hangs off the storey, so the space hop finds nothing for it. It has
    // to stay visible: a drawing that omits it reads as if every detector were
    // placed.
    const orphan = graph.nodes.find((n) => n.name === 'BM-04');
    expect(orphan).toBeDefined();
    expect(graph.edges.filter((e) => e.source === orphan?.id)).toHaveLength(0);

    // And the storey it actually sits in must not sneak in as a "room".
    expect(graph.nodes.some((n) => n.ifcType === 'IfcBuildingStorey')).toBe(false);
  });

  it('reports what it could not place', () => {
    const graph = buildRelationGraph(source, elementInSpaceInZone(['IfcSensor']));

    expect(danglingNodes(graph, 'element').map((n) => n.name)).toEqual(['BM-04']);
    // Flur 1.02 is in no zone — the second finding the drawing should carry.
    expect(danglingNodes(graph, 'space').map((n) => n.name)).toEqual(['Flur 1.02']);
  });

  it('reaches the storey through IfcRelAggregates, not through containment', () => {
    const graph = buildRelationGraph(source, elementInSpaceInStorey(['IfcSensor']));

    const storeys = graph.nodes.filter((n) => n.kind === 'storey');
    expect(storeys.map((n) => n.name)).toEqual(['1. Obergeschoss']);
    // Both rooms are aggregated out of the same storey: two edges, one node.
    expect(graph.edges.filter((e) => e.relation === 'IfcRelAggregates')).toHaveLength(2);
  });

  it('walks a room in two zones as two edges', () => {
    const twoZones: GraphSource = {
      ...source,
      idsOfType: (t) => (t === 'IfcZone' ? [400, 401] : source.idsOfType(t)),
      typeOf: (id) => (id === 401 ? 'IfcZone' : source.typeOf(id)),
      nameOf: (id) => (id === 401 ? 'Lueftungszone Nord' : source.nameOf(id)),
      related: (id, relation, direction) => {
        if (relation === 'IfcRelAssignsToGroup') {
          const pairs: ReadonlyArray<readonly [number, number]> = [
            [400, 200],
            [401, 200],
          ];
          return pairs
            .filter(([relating, related]) => (direction === 'forward' ? relating : related) === id)
            .map(([relating, related]) => (direction === 'forward' ? related : relating));
        }
        return source.related(id, relation, direction);
      },
    };

    const graph = buildRelationGraph(twoZones, elementInSpaceInZone(['IfcSensor']));
    expect(graph.nodes.filter((n) => n.kind === 'zone')).toHaveLength(2);
    expect(graph.edges.filter((e) => e.relation === 'IfcRelAssignsToGroup')).toHaveLength(2);
  });

  it('walks a system to its members — the same relationship, the other way', () => {
    const graph = buildRelationGraph(source, systemMembers([500]));

    expect(graph.nodes.filter((n) => n.kind === 'system').map((n) => n.name)).toEqual([
      'Brandmeldeanlage',
    ]);
    expect(graph.nodes.filter((n) => n.kind === 'element').map((n) => n.name).sort()).toEqual([
      'BM-01',
      'BM-02',
      'BM-04',
    ]);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges.every((e) => e.relation === 'IfcRelAssignsToGroup')).toBe(true);

    // The zone chain walks this same relationship INVERSE and finds nothing
    // from a system, which is what keeps the two drawings apart.
    expect(graph.nodes.some((n) => n.kind === 'zone')).toBe(false);
  });

  it('keeps a system with no members', () => {
    const graph = buildRelationGraph(source, systemMembers([500, 501]));

    const empty = graph.nodes.find((n) => n.name === 'Fluchtwegleuchten');
    expect(empty).toBeDefined();
    expect(graph.edges.filter((e) => e.source === empty?.id)).toHaveLength(0);
    // Reported at the system rank: "1 of 2 systems with no element".
    expect(danglingNodes(graph, 'system').map((n) => n.name)).toEqual(['Fluchtwegleuchten']);
  });

  it('takes a system chain on to the room, and merges members sharing one', () => {
    const graph = buildRelationGraph(source, systemMembersInSpace([500]));

    // BM-01 and BM-02 are both in Buero 1.01; BM-04 hangs off the storey.
    expect(graph.nodes.filter((n) => n.kind === 'space').map((n) => n.name)).toEqual(['Buero 1.01']);
    expect(graph.edges.filter((e) => e.relation === 'IfcRelContainedInSpatialStructure')).toHaveLength(2);
    expect(danglingNodes(graph, 'element').map((n) => n.name)).toEqual(['BM-04']);
  });

  it('names its ranks in order, so callers know which one is terminal', () => {
    expect(chainRanks(systemMembers([500]))).toEqual(['system', 'element']);
    expect(chainRanks(systemMembersInSpace([500]))).toEqual(['system', 'element', 'space']);
    expect(chainRanks(elementInSpaceInZone(['IfcSensor']))).toEqual(['element', 'space', 'zone']);
    // Three ranks, and the last is `port` — NOT `element`. A fourth hop back
    // to the elements would repeat the first rank and make "has no outgoing
    // edge" mean two different things in one drawing.
    expect(chainRanks(plantTopology(['IfcPump']))).toEqual(['element', 'port', 'port']);
  });

  it('walks a plant: element to its ports to the ports they are joined to', () => {
    // Pump 300 --port 600-- connected to --port 601-- pipe 301.
    const plant: GraphSource = {
      idsOfType: (t) => (t === 'IfcPump' ? [700] : t === 'IfcFlowSegment' ? [701] : []),
      typeOf: (id) =>
        id === 700 ? 'IfcPump'
          : id === 701 ? 'IfcFlowSegment'
            : id === 600 || id === 601 ? 'IfcDistributionPort'
              : null,
      nameOf: (id) => `#${id}`,
      related: (id, relation, direction) => {
        if (relation === 'IfcRelConnectsPortToElement') {
          const owns: ReadonlyArray<readonly [number, number]> = [[600, 700], [601, 701]];
          return owns
            .filter(([port, el]) => (direction === 'forward' ? port : el) === id)
            .map(([port, el]) => (direction === 'forward' ? el : port));
        }
        if (relation === 'IfcRelConnectsPorts') {
          // Recorded once, 600 → 601. The pipe's side must still find it.
          if (direction === 'forward' && id === 600) return [601];
          if (direction === 'inverse' && id === 601) return [600];
        }
        return [];
      },
    };

    const graph = buildRelationGraph(plant, plantTopology(['IfcPump', 'IfcFlowSegment']));

    expect(graph.nodes.filter((n) => n.kind === 'element').map((n) => n.ifcType).sort()).toEqual([
      'IfcFlowSegment',
      'IfcPump',
    ]);
    expect(graph.nodes.filter((n) => n.kind === 'port')).toHaveLength(2);

    // Two element→port edges, and the connection ONCE despite being reachable
    // from both ends — the whole point of the symmetric hop.
    expect(graph.edges.filter((e) => e.relation === 'IfcRelConnectsPortToElement')).toHaveLength(2);
    expect(graph.edges.filter((e) => e.relation === 'IfcRelConnectsPorts')).toHaveLength(1);
  });

  it('finds the connection from the end the file did NOT list first', () => {
    // Only the pipe is selected. Its port is the RELATED end, so a
    // forward-only hop would find nothing at all.
    const plant: GraphSource = {
      idsOfType: (t) => (t === 'IfcFlowSegment' ? [701] : []),
      typeOf: (id) => (id === 701 ? 'IfcFlowSegment' : id === 600 || id === 601 ? 'IfcDistributionPort' : null),
      nameOf: () => '',
      related: (id, relation, direction) => {
        if (relation === 'IfcRelConnectsPortToElement' && direction === 'inverse' && id === 701) return [601];
        if (relation === 'IfcRelConnectsPorts' && direction === 'inverse' && id === 601) return [600];
        return [];
      },
    };

    const graph = buildRelationGraph(plant, plantTopology(['IfcFlowSegment']));
    expect(graph.edges.filter((e) => e.relation === 'IfcRelConnectsPorts')).toHaveLength(1);
    expect(graph.nodes.some((n) => n.expressId === 600)).toBe(true);
  });

  it('counts a symmetric edge as leading away from both ends', () => {
    // 600 --connected-- 601, recorded once. Stored directionally because a
    // renderer needs two ends, but NEITHER port is a dead end.
    const plant: GraphSource = {
      idsOfType: (t) => (t === 'IfcPump' ? [700, 701] : []),
      typeOf: (id) =>
        id === 700 || id === 701 ? 'IfcPump' : id === 600 || id === 601 ? 'IfcDistributionPort' : null,
      nameOf: () => '',
      related: (id, relation, direction) => {
        if (relation === 'IfcRelConnectsPortToElement' && direction === 'inverse') {
          if (id === 700) return [600];
          if (id === 701) return [601];
        }
        if (relation === 'IfcRelConnectsPorts') {
          if (direction === 'forward' && id === 600) return [601];
          if (direction === 'inverse' && id === 601) return [600];
        }
        return [];
      },
    };

    const graph = buildRelationGraph(plant, plantTopology(['IfcPump']));
    expect(graph.edges.filter((e) => e.symmetric)).toHaveLength(1);
    expect(danglingNodes(graph, 'port')).toEqual([]);
  });

  it('does not draw a port as connected to itself', () => {
    const selfJoined: GraphSource = {
      idsOfType: (t) => (t === 'IfcPump' ? [700] : []),
      typeOf: (id) => (id === 700 ? 'IfcPump' : id === 600 ? 'IfcDistributionPort' : null),
      nameOf: () => '',
      related: (id, relation, direction) => {
        if (relation === 'IfcRelConnectsPortToElement' && direction === 'inverse' && id === 700) return [600];
        // A file that records a port joined to itself.
        if (relation === 'IfcRelConnectsPorts' && id === 600) return [600];
        return [];
      },
    };

    const graph = buildRelationGraph(selfJoined, plantTopology(['IfcPump']));
    expect(graph.edges.filter((e) => e.relation === 'IfcRelConnectsPorts')).toHaveLength(0);
  });

  it('skips an id the model cannot type, the shape a dangling reference takes', () => {
    const dangling: GraphSource = {
      ...source,
      related: (id, relation, direction) =>
        relation === 'IfcRelContainedInSpatialStructure' && direction === 'inverse' && id === 300
          ? [999]
          : source.related(id, relation, direction),
    };

    const graph = buildRelationGraph(dangling, elementInSpaceInZone(['IfcSensor']));
    expect(graph.nodes.some((n) => n.expressId === 999)).toBe(false);
    expect(danglingNodes(graph, 'element').map((n) => n.name).sort()).toEqual(['BM-01', 'BM-04']);
  });
});
