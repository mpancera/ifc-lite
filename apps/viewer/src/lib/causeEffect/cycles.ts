/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cycle protection for cause-and-effect chains.
 *
 * A chain links processes to processes (`IfcRelSequence`), so chains of any
 * length are possible — and so are rings. A valve that closes, causing an
 * effect that ultimately closes the same valve, is not a clever edge case: it
 * is a modelling error that would make evaluation run forever and, worse, make
 * a plausible-looking matrix that nobody can act on.
 *
 * The check belongs at the moment a link is *proposed*, not at evaluation
 * time. Refusing to draw the edge tells the author exactly which step closed
 * the ring; discovering it later means unpicking a graph that already looks
 * finished.
 *
 * Pure — the graph is passed in as adjacency, so this is testable without a
 * store, and the same function serves both the editor's live check and a
 * whole-graph audit of imported data.
 */

/** Directed edges: process id → the processes it triggers. */
export type ChainGraph = ReadonlyMap<number, readonly number[]>;

export interface CyclePath {
  /** The ring, first node repeated at the end, e.g. `[7, 9, 12, 7]`. */
  path: number[];
}

/**
 * Would adding `from → to` close a ring?
 *
 * Returns the path that would be closed, or `null` when the edge is safe. A
 * self-link is a ring of one and is reported as such rather than waved through.
 */
export function wouldCloseCycle(
  graph: ChainGraph,
  from: number,
  to: number,
): CyclePath | null {
  if (from === to) return { path: [from, from] };

  // The new edge closes a ring exactly when `to` already reaches `from`.
  const back = findPath(graph, to, from);
  return back ? { path: [from, ...back] } : null;
}

/**
 * A path from `start` to `goal` following the edges, or `null`.
 *
 * Depth-first with an explicit stack: a chain deep enough to overflow the call
 * stack is unlikely here, but a graph walk that can crash the tab on malformed
 * imported data is not worth the brevity.
 */
function findPath(graph: ChainGraph, start: number, goal: number): number[] | null {
  const previous = new Map<number, number>();
  const seen = new Set<number>([start]);
  const stack: number[] = [start];

  while (stack.length > 0) {
    const node = stack.pop() as number;
    for (const next of graph.get(node) ?? []) {
      if (seen.has(next)) continue;
      previous.set(next, node);
      if (next === goal) {
        // Walk back to `start` and hand the path out in forward order.
        const path = [goal];
        let cursor = goal;
        while (cursor !== start) {
          cursor = previous.get(cursor) as number;
          path.push(cursor);
        }
        return path.reverse();
      }
      seen.add(next);
      stack.push(next);
    }
  }
  return null;
}

/**
 * Every ring already present in a graph.
 *
 * For auditing data that arrived rather than data being authored — an imported
 * file, or a chain built before this check existed. Each ring is reported once,
 * normalised so the same ring found from two different entry points is not
 * counted twice.
 */
export function findCycles(graph: ChainGraph): CyclePath[] {
  const found = new Map<string, number[]>();
  const visiting = new Set<number>();
  const done = new Set<number>();
  const trail: number[] = [];

  const walk = (node: number): void => {
    visiting.add(node);
    trail.push(node);

    for (const next of graph.get(node) ?? []) {
      if (visiting.has(next)) {
        const start = trail.indexOf(next);
        const ring = trail.slice(start);
        found.set(fingerprint(ring), [...ring, next]);
      } else if (!done.has(next)) {
        walk(next);
      }
    }

    trail.pop();
    visiting.delete(node);
    done.add(node);
  };

  for (const node of graph.keys()) {
    if (!done.has(node)) walk(node);
  }
  return [...found.values()].map((path) => ({ path }));
}

/**
 * A rotation-independent key for a ring.
 *
 * `[7, 9, 12]` and `[9, 12, 7]` are the same ring reached from different
 * starting points; rotating to the smallest member makes them one entry.
 */
function fingerprint(ring: readonly number[]): string {
  const lowest = ring.indexOf(Math.min(...ring));
  return [...ring.slice(lowest), ...ring.slice(0, lowest)].join('>');
}
