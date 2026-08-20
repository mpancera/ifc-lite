/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A drawn chain, written out as a file.
 *
 * # Why the ranks decide the shape
 * A chain graph is not a general network: `chainRanks` names its layers in
 * order, and every edge joins one layer to the next. That is what makes a
 * detection tree a TREE — zone, room, device — and it is why the writers here
 * take the spec alongside the graph. Serialising `{nodes, edges}` on its own
 * would produce an adjacency dump that a reader has to re-derive the hierarchy
 * from, which is precisely the work the chain already did.
 *
 * # Two shapes, two readers
 * CSV is for the person who opens it in a spreadsheet and sorts by group: one
 * row per leaf, its ancestors as columns, nothing nested. JSON is for the
 * program that wants the tree as a tree. Neither is a rendering — the drawing
 * on screen is React Flow's business, and an SVG of it belongs to whatever
 * draws it.
 *
 * # Orphans are written, not dropped
 * A device in no room is the finding a detection tree exists to surface. It
 * appears with its ancestor columns empty rather than being left out, because
 * a list that silently omits what it could not place reads as complete.
 */

import { chainRanks, type RelationChain } from './chain.js';
import type { Graph, GraphNode, GraphNodeKind } from './types.js';

/** Column and property names per rank, in the reader's language-free form. */
const RANK_LABELS: Record<GraphNodeKind, string> = {
  element: 'Element',
  space: 'Space',
  storey: 'Storey',
  zone: 'Zone',
  system: 'System',
  port: 'Port',
};

export interface GraphTreeNode {
  expressId: number;
  kind: GraphNodeKind;
  ifcType: string;
  name: string;
  children: GraphTreeNode[];
}

/**
 * Index of "which node does this one hop to", by rank position.
 *
 * The walk direction is the chain's: rank 0 hops to rank 1. An edge whose ends
 * sit in the same rank (a symmetric port pair) is not a hop and is skipped —
 * including it would make a port its own ancestor.
 */
function hopTargets(graph: Graph, ranks: readonly GraphNodeKind[]): Map<string, string[]> {
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const rankOf = new Map(ranks.map((kind, index) => [kind, index]));
  const out = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const from = kindOf.get(edge.source);
    const to = kindOf.get(edge.target);
    if (from === undefined || to === undefined) continue;
    const a = rankOf.get(from);
    const b = rankOf.get(to);
    if (a === undefined || b === undefined || a === b) continue;
    // Whichever end is nearer rank 0 is the child; the chain walks outward.
    const [child, parent] = a < b ? [edge.source, edge.target] : [edge.target, edge.source];
    const existing = out.get(child);
    if (existing) existing.push(parent);
    else out.set(child, [parent]);
  }
  return out;
}

/** Ancestors of a leaf, from its own rank outward. Empty slots stay empty. */
function ancestry(
  node: GraphNode,
  byId: Map<string, GraphNode>,
  hops: Map<string, string[]>,
  depth: number,
): Array<GraphNode | null> {
  const chainNodes: Array<GraphNode | null> = [node];
  let current: GraphNode | undefined = node;
  const seen = new Set<string>([node.id]);
  for (let step = 1; step < depth; step += 1) {
    // A node can legitimately reach two parents (a room in two zones). The
    // first is taken and the fact is not hidden: `graphTreeOf` still lists the
    // leaf under both, and the flat row is one reading, not the only one.
    const nextId: string | undefined = current ? hops.get(current.id)?.find((id) => !seen.has(id)) : undefined;
    current = nextId ? byId.get(nextId) : undefined;
    if (current) seen.add(current.id);
    chainNodes.push(current ?? null);
  }
  return chainNodes;
}

/**
 * The chain as a tree, rooted at its outermost rank.
 *
 * A leaf reachable from two roots appears under both: that is what the model
 * says, and collapsing it would invent a decision the file does not carry.
 */
export function graphTreeOf(graph: Graph, chain: RelationChain): GraphTreeNode[] {
  const ranks = chainRanks(chain);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const hops = hopTargets(graph, ranks);

  const childrenOf = new Map<string, string[]>();
  for (const [child, parents] of hops) {
    for (const parent of parents) {
      const existing = childrenOf.get(parent);
      if (existing) existing.push(child);
      else childrenOf.set(parent, [child]);
    }
  }

  const build = (node: GraphNode, seen: ReadonlySet<string>): GraphTreeNode => {
    const nextSeen = new Set(seen).add(node.id);
    const children = (childrenOf.get(node.id) ?? [])
      .filter((id) => !nextSeen.has(id))
      .map((id) => byId.get(id))
      .filter((n): n is GraphNode => n !== undefined)
      .map((child) => build(child, nextSeen));
    return { expressId: node.expressId, kind: node.kind, ifcType: node.ifcType, name: node.name, children };
  };

  const outermost = ranks[ranks.length - 1];
  const roots = graph.nodes.filter((n) => n.kind === outermost);
  const placed = new Set<string>();
  const collect = (t: GraphTreeNode) => { placed.add(String(t.expressId)); t.children.forEach(collect); };
  const trees = roots.map((root) => build(root, new Set()));
  trees.forEach(collect);

  // Anything the chain could not place hangs at the top on its own, so the
  // file accounts for every node the drawing showed.
  for (const node of graph.nodes) {
    if (placed.has(String(node.expressId))) continue;
    if (node.kind === outermost) continue;
    trees.push({ expressId: node.expressId, kind: node.kind, ifcType: node.ifcType, name: node.name, children: [] });
  }
  return trees;
}

/** `a;b` with quoting, and the formula guard every export here applies. */
function csvCell(value: string): string {
  // A cell starting with = + - @ is executed on open by spreadsheet software;
  // the leading apostrophe is the standard neutralisation and is what the
  // other exports in this repository do.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * One row per leaf, ancestors as columns, outermost rank first.
 *
 * Semicolon-separated: these files are opened in a spreadsheet on a machine
 * whose list separator is a semicolon, and a comma-separated file lands there
 * as one column.
 */
export function graphToCsv(graph: Graph, chain: RelationChain): string {
  const ranks = chainRanks(chain);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const hops = hopTargets(graph, ranks);
  const leaves = graph.nodes.filter((n) => n.kind === ranks[0]);

  const header = [...ranks].reverse().flatMap((kind) => [RANK_LABELS[kind]]);
  const rows = leaves.map((leaf) => {
    const line = ancestry(leaf, byId, hops, ranks.length);
    return [...line].reverse().map((n) => csvCell(n?.name ?? ''));
  });

  const leafExtra = ['IfcType', 'ExpressId'];
  const body = rows.map((cells, i) => {
    const leaf = leaves[i];
    return [...cells, csvCell(leaf.ifcType), String(leaf.expressId)].join(';');
  });
  return [[...header, ...leafExtra].join(';'), ...body].join('\r\n');
}

export interface GraphJsonExport {
  /** Rank order, outermost first — the tree's depth described. */
  ranks: GraphNodeKind[];
  nodeCount: number;
  edgeCount: number;
  tree: GraphTreeNode[];
}

/** The tree as JSON, with the rank order it was built from. */
export function graphToJson(graph: Graph, chain: RelationChain): GraphJsonExport {
  return {
    ranks: [...chainRanks(chain)].reverse(),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    tree: graphTreeOf(graph, chain),
  };
}
