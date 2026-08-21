/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Where the nodes go — ELK, in a worker.
 *
 * React Flow does no layout; it is handed x/y and draws. That is right for a
 * diagram someone arranges by hand and useless for one derived from a model,
 * where nobody is going to place three hundred detectors. ELK supplies the two
 * things that make a drawing read as an engineering schematic rather than a
 * bubble chart: layered ranks and **orthogonal** edge routing.
 *
 * In a worker because ELK is a compiled-from-Java layout engine and a few
 * hundred nodes is enough to be felt on the main thread — and a layout that
 * stutters the UI while it runs is worse than one that takes a moment.
 */

import ELK, { type ElkNode } from 'elkjs/lib/elk-api.js';
// `?url` on purpose: it hands back the file's ADDRESS and copies it to the
// build untouched, instead of putting it through the bundler. See `engine()`.
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { Graph, GraphNodeKind } from '@ifc-lite/graph';

/**
 * Node box sizes, per kind, in pixels.
 *
 * ELK needs a size before it can place anything, and React Flow needs the same
 * size to draw the box, so this table is the single source for both. A node
 * whose CSS disagrees with what ELK was told sits with its edges attached to
 * thin air — the classic symptom of two size tables.
 */
export const NODE_SIZE: Record<GraphNodeKind, { width: number; height: number }> = {
  element: { width: 190, height: 44 },
  space: { width: 210, height: 52 },
  storey: { width: 200, height: 48 },
  zone: { width: 210, height: 52 },
  system: { width: 210, height: 52 },
  // Deliberately small. A port carries a two-character name ("CP1") and there
  // are twice as many of them as there are devices; at device size they would
  // dominate a plant drawing that is supposed to be about the devices.
  port: { width: 96, height: 30 },
};

export interface LayoutPosition {
  x: number;
  y: number;
}

/** One shared engine. Spinning up a worker per layout run would cost more than
 *  the layout for anything short of a whole building. */
let elk: InstanceType<typeof ELK> | null = null;

function engine(): InstanceType<typeof ELK> {
  if (elk) return elk;
  elk = new ELK({
    // A classic worker, not a module one: `elk-worker.min.js` is a compiled
    // GWT bundle with no import/export in it, and asking Vite for
    // `type: 'module'` here fails at runtime rather than at build time.
    //
    // Which is why the address comes from `?url` rather than from
    // `new URL(…, import.meta.url)`. The latter asks Vite to BUNDLE the file
    // as a worker, and this app sets `worker.format: 'es'` (the geometry and
    // wasm workers need it) — so the built asset came out as an ES module and
    // died on its own first line the moment a classic worker ran it:
    //
    //   Uncaught SyntaxError: Unexpected token 'export'
    //
    // Invisible in dev, where the original file is served as it is, and broken
    // in every deployed build: the graph simply never appeared. `?url` copies
    // the file verbatim and leaves the format question unasked.
    workerFactory: () => new Worker(elkWorkerUrl),
  });
  return elk;
}

/** Thrown into a layout whose answer is no longer wanted. Not a failure — the
 *  caller asked for something else before this one finished. */
export class LayoutSuperseded extends Error {
  constructor() {
    super('layout superseded');
    this.name = 'LayoutSuperseded';
  }
}

/** The run whose answer is still wanted, or `null` when nothing is going. */
let current: { reject: (err: Error) => void } | null = null;

/**
 * Options tuned for a schematic read left to right.
 *
 * `RIGHT` rather than `DOWN` because of the shape the data actually has: many
 * elements, fewer rooms, fewer zones still. Laid out downward that is one very
 * wide first row; laid out rightward it is one tall first column, and panning a
 * tall drawing is what a scroll wheel already does.
 */
const LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  // Straightens long runs of edges instead of letting them zigzag between
  // ranks, which is what makes a stack of detectors under one room read as a
  // group rather than a scribble.
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  // Lay every connected component into the SAME layering instead of packing
  // each one side by side. With the default on, four selected systems became
  // four little diagrams stacked across the canvas, eight columns wide — and
  // the rank an element sits in stopped meaning anything, because column 3 was
  // the second system's first rank. Off, every system stands in column one and
  // every member in column two, which is what makes a schematic readable.
  'elk.separateConnectedComponents': 'false',
  'elk.spacing.nodeNode': '14',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.edgeNode': '18',
  'elk.padding': '[top=24,left=24,bottom=24,right=24]',
};

/**
 * Lay `graph` out and return a position per node id.
 *
 * Positions are the top-left corner, which is what React Flow's `position`
 * means. ELK reports the same convention, so no conversion is needed — and
 * introducing one "for clarity" is how node boxes end up half a box off.
 */
export function layoutGraph(graph: Graph): Promise<Map<string, LayoutPosition>> {
  if (graph.nodes.length === 0) return Promise.resolve(new Map());

  // A run still going is a run nobody is waiting for any more — the selection
  // changed. ELK queues everything on ONE worker, so leaving it to finish
  // makes every later layout wait behind an answer that will be thrown away.
  // Measured the hard way: an oversized graph left running made a 214-node
  // layout, normally about a second, never arrive at all.
  //
  // Terminating leaves the abandoned `layout()` promise pending forever, so
  // the run is rejected explicitly first; a caller that only ever awaits would
  // otherwise hang on a spinner with nothing behind it.
  if (current) {
    const abandoned = current;
    current = null;
    elk?.terminateWorker();
    elk = null;
    abandoned.reject(new LayoutSuperseded());
  }

  const root: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: graph.nodes.map((n) => ({ id: n.id, ...NODE_SIZE[n.kind] })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  return new Promise<Map<string, LayoutPosition>>((resolve, reject) => {
    const run = { reject };
    current = run;
    engine()
      .layout(root)
      .then((laid) => {
        if (current !== run) return; // superseded, and already rejected
        current = null;
        const positions = new Map<string, LayoutPosition>();
        for (const child of laid.children ?? []) {
          positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
        }
        resolve(positions);
      })
      .catch((err: unknown) => {
        if (current !== run) return;
        current = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}
