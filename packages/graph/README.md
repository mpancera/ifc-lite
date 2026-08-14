# @ifc-lite/graph

Neutral `{nodes, edges}` extracted from IFC relationships — the model behind a
schematic view, with no layout, no DOM and no rendering library in it.

## Why a package of its own

A schematic drawing arranges elements by their **logical** relations rather than
their position in space: a detector under the room it monitors, the room under
the zone it belongs to. That is a graph, and a graph has three separable
concerns — what the nodes and edges *are*, where they end up on screen, and how
they are painted. This package is only the first.

Keeping it separate is what makes the other two swappable. Layout and renderer
both have real alternatives; the extraction does not change when either is
replaced.

## Chains

Most useful schematics are a few ranks joined by a relationship each. Rather
than one hand-written extractor per case, a chain spells out the hops:

```ts
import { buildRelationGraph, elementInSpaceInZone } from '@ifc-lite/graph';

const graph = buildRelationGraph(source, elementInSpaceInZone(['IfcSensor']));
```

Every hop is 1:n by construction — a room in two zones produces two edges, and
the drawing shows both.

Chains are values, so a new one needs no code here:

```ts
const spaceInZone: RelationChain = {
  start: { kind: 'space', types: ['IfcSpace'] },
  hops: [
    {
      relation: 'IfcRelAssignsToGroup',
      direction: 'inverse',
      keepTypes: ['IfcZone'],
      kind: 'zone',
    },
  ],
};
```

## Two ways to start

A chain begins either from a **class** or from **specific things**:

```ts
{ kind: 'element', types: ['IfcDoor'] }        // every door
{ kind: 'system',  ids: [232, 414, 7846] }     // these three systems
```

The two questions are genuinely different. Nobody picks 33 doors one at a time,
and nobody wants all 21 systems in a building drawn at once — which of them to
show *is* the question a plant schematic asks.

That is the difference between `elementInSpaceInZone(['IfcDoor'])` and
`systemMembers([232, 414])`. The second walks `IfcRelAssignsToGroup` **forward**
(group → members) where the zone chain walks the same relationship **inverse** —
which is exactly why direction belongs to a hop rather than to a relationship.

## Dead ends are kept, on purpose

`IfcRelContainedInSpatialStructure` from an element reaches whatever spatial
container the authoring tool chose — usually an `IfcSpace`, often an
`IfcBuildingStorey` directly. A hop that means "the room" filters on `IfcSpace`,
and the elements that fall out stay in the graph with no outgoing edge.

`danglingNodes(graph, 'element')` returns them. Put the count next to the
drawing: "12 of 340 detectors sit in no room" is a modelling finding, and a
drawing that shows it without saying it will be read as complete.

**Only ask about non-terminal ranks.** `chainRanks(chain)` gives the ranks in
order; the last one is the end of the chain, and nothing is supposed to leave
it. Counting dead ends there would accuse every node in the drawing — in
`systemMembers`, every single member.

## The source port

The package asks a model four questions and nothing else, so the extraction can
be tested against a model that fits on a screen:

```ts
interface GraphSource {
  idsOfType(ifcType: string): readonly number[];
  typeOf(expressId: number): string | null;
  nameOf(expressId: number): string | null;
  related(expressId: number, relation: GraphRelation, direction: RelationDirection): readonly number[];
}
```

The shapes line up one-to-one with the parsed store (`store.entities.getTypeName`
/ `getName`, `store.relationships.getRelated`), so the viewer's adapter carries
no logic of its own.

## Relationship names

Edges name their IFC relationship in full — `IfcRelContainedInSpatialStructure`,
not `Contains`. The name *is* the meaning: a reader has to be able to tell
containment from `IfcRelReferencedInSpatialStructure`, and any shorter name
loses exactly that distinction.
