/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Graph panel — elements arranged by what they belong to, not by where
 * they are (PROJECT.md §V35).
 *
 * # Beside the model, not instead of it
 * It docks in the bottom strip, like Lists. It was briefly a third VIEW MODE
 * covering the viewport, and that was the wrong shape: the drawing and the
 * building answer each other. Reading "this detector belongs to the fire alarm
 * system" is worth much more when the building is still on screen with that
 * detector picked out in it — which is what `useGraphOverlay` does with
 * whatever the drawing currently contains. A schematic that hides the thing it
 * describes cannot do that.
 *
 * So it works over 3D and over the plan alike; neither is switched off.
 *
 * # A host, not a diagram
 * Today it draws relation chains ("detector in room in zone"); the electrical
 * schematic that motivated the whole thing is a later kind over the same three
 * layers, and the point of the split is that it arrives without this file
 * changing shape.
 *
 * One model at a time, on purpose — see `graphSourceFor`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, X } from 'lucide-react';
import {
  buildRelationGraph,
  chainRanks,
  danglingNodes,
  elementInSpaceInStorey,
  elementInSpaceInZone,
  plantTopology,
  systemMembers,
  systemMembersInSpace,
  type Graph,
  type GraphNodeKind,
  type RelationChain,
} from '@ifc-lite/graph';
import { getInheritanceChainForEntity } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { expressTypeCounts, graphSourceFor, systemsIn, type GraphStore } from '@/lib/graph/storeSource';
import { layoutGraph, LayoutSuperseded, NODE_SIZE } from '@/lib/graph/layout';
import { RELATION_STYLE } from '@/lib/graph/relationStyle';
import { GRAPH_NODE_TYPES, type GraphNodeData } from './GraphNodes';
import { useGraphOverlay } from '@/hooks/useGraphOverlay';
import { toGlobalIdFromModels } from '@/store/globalId';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The chains on offer, and what each one is picked from.
 *
 * `pick` is the real content here. The two element chains start from a CLASS —
 * nobody selects 33 doors one at a time. The system chains start from NAMED
 * THINGS: a building holds twenty-odd systems, and which of them to draw is
 * the whole question a plant schematic asks. One picker for both would have to
 * be wrong for one of them.
 *
 * A closed list rather than a chain builder: an editor for arbitrary chains,
 * before anyone has drawn a real one, would be guessing at the controls.
 */
/**
 * `isolatedStart` decides what a start node that reached nothing means.
 *
 * `'keep'` for the location chains: an element in no room is a MODELLING GAP
 * about that element, and dropping it would make the drawing read as complete
 * (PROJECT.md §V42.3).
 *
 * `'drop'` for plant topology: a device with no port is not part of the plant
 * at all — that is most of a building, not a fault. Drawing 3,531 unconnected
 * boxes around a 296-node schematic is noise, and it is what blows the node
 * budget. The count stays in the readout either way; only the drawing changes.
 */
type IsolatedStart = 'keep' | 'drop';

type ChainDef = { id: string; label: string; isolatedStart?: IsolatedStart } & (
  | { pick: 'types'; build: (types: readonly string[]) => RelationChain }
  | { pick: 'systems'; build: (ids: readonly number[]) => RelationChain }
);

const CHAINS: readonly ChainDef[] = [
  { id: 'zone', label: 'Element → Raum → Zone', pick: 'types', build: elementInSpaceInZone },
  { id: 'storey', label: 'Element → Raum → Geschoss', pick: 'types', build: elementInSpaceInStorey },
  { id: 'system', label: 'Anlage → Elemente', pick: 'systems', build: systemMembers },
  { id: 'systemSpace', label: 'Anlage → Elemente → Raum', pick: 'systems', build: systemMembersInSpace },
  {
    id: 'plant',
    label: 'Anlagentopologie (Gerät → Anschluss → Anschluss)',
    pick: 'types',
    build: plantTopology,
    isolatedStart: 'drop',
  },
];

/**
 * Types offered as a starting point.
 *
 * Asked of the schema rather than guessed at with a name pattern: a model holds
 * far more types than it holds things, and a picker listing `IfcSurfaceStyle`,
 * `IfcMaterial` and `IfcSIUnit` above `IfcDoor` is a picker nobody reads. Only
 * `IfcElement` descendants can be the `RelatedObjects` of a containment
 * relationship, so only they can start this chain — which makes the schema the
 * exact answer here, not an approximation of one.
 */
function canStartAChain(ifcType: string): boolean {
  return getInheritanceChainForEntity(ifcType).includes('IfcElement');
}

/**
 * Above this the drawing is refused, with a prompt to narrow the selection —
 * never a silent truncation.
 *
 * Set from measurement, in this browser on the Bethesda electrical model:
 * 214 nodes laid out in about a second, 530 took nearly nine, and 1470 never
 * finished. The cost is markedly superlinear, so the line sits where waiting
 * is still tolerable rather than where it becomes impossible. Rough figures
 * from one machine, not a benchmark — but the shape of the curve is the point,
 * and it is not close.
 */
const NODE_BUDGET = 400;

const KIND_LABEL: Record<GraphNodeKind, { one: string; many: string }> = {
  element: { one: 'Element', many: 'Elemente' },
  space: { one: 'Raum', many: 'Räume' },
  storey: { one: 'Geschoss', many: 'Geschosse' },
  zone: { one: 'Zone', many: 'Zonen' },
  system: { one: 'Anlage', many: 'Anlagen' },
  port: { one: 'Anschluss', many: 'Anschlüsse' },
};

/**
 * What is missing when a rank leads to another of the SAME kind.
 *
 * The plant chain goes port → port, and "N von M Anschlüssen ohne Anschluss"
 * reads like a typo. Naming the relation instead says the true thing: the
 * port is there, it just goes nowhere.
 */
const SELF_LABEL: Partial<Record<GraphNodeKind, string>> = {
  port: 'Verbindung',
};

/**
 * What the chain could not reach, rank by rank.
 *
 * Names the MISSING rank rather than a fixed phrase: "34 von 35 Elementen ohne
 * Raum" in a location chain, "3 von 21 Anlagen ohne Element" in a plant one.
 * The terminal rank is skipped — nothing is supposed to leave it, so counting
 * it would accuse every node in the drawing.
 */
/**
 * One line of the legend: the line style as drawn, its Data Dictionary name,
 * and the IFC relationship it stands for.
 *
 * The IFC name lives HERE rather than on every edge. It is the thing a reader
 * needs once to know what they are looking at, and repeated forty times across
 * a drawing it is just noise wider than the boxes.
 */
function RelationLegendRow({
  label, ifcEntity, dash, width, muted,
}: {
  label: string;
  ifcEntity: string;
  dash?: string;
  width: number;
  muted?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2', muted && 'opacity-45')} title={ifcEntity}>
      <svg width="34" height="8" viewBox="0 0 34 8" aria-hidden="true" className="shrink-0">
        <line
          x1="1" y1="4" x2="33" y2="4"
          stroke="currentColor"
          strokeWidth={width}
          strokeDasharray={dash}
        />
      </svg>
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0 text-[10px] opacity-50">{ifcEntity}</span>
    </div>
  );
}

function gapsFor(graph: Graph, chain: RelationChain): string[] {
  const ranks = chainRanks(chain);
  const gaps: string[] = [];
  for (let i = 0; i < ranks.length - 1; i++) {
    const kind = ranks[i];
    const missing = danglingNodes(graph, kind).length;
    if (missing === 0) continue;
    const total = graph.nodes.filter((n) => n.kind === kind).length;
    const next = ranks[i + 1];
    const missingLabel = next === kind ? (SELF_LABEL[kind] ?? KIND_LABEL[next].one) : KIND_LABEL[next].one;
    gaps.push(`${missing} von ${total} ${KIND_LABEL[kind].many} ohne ${missingLabel}.`);
  }
  return gaps;
}

export interface GraphPanelProps {
  onClose?: () => void;
}

export function GraphPanel({ onClose }: GraphPanelProps) {
  const models = useViewerStore((s) => s.models);
  const selectedModelId = useViewerStore((s) => s.selectedModelId);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);
  const setGraphHighlight = useViewerStore((s) => s.setGraphHighlight);
  const highlightInView = useViewerStore((s) => s.graphHighlightInView);
  const setHighlightInView = useViewerStore((s) => s.setGraphHighlightInView);

  // Owns the viewport overlay for as long as the panel is mounted, so closing
  // the panel gives the model back — see `useGraphOverlay`.
  useGraphOverlay();

  const [modelId, setModelId] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string>('zone');
  const [startTypes, setStartTypes] = useState<string[]>([]);
  const [startSystems, setStartSystems] = useState<number[]>([]);
  const [positioned, setPositioned] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [laying, setLaying] = useState(false);

  const chain = CHAINS.find((c) => c.id === chainId) ?? CHAINS[0];

  // Follow the app's model selection unless the user picked one here.
  const effectiveModelId = modelId ?? selectedModelId ?? [...models.keys()][0] ?? null;
  const store = effectiveModelId
    ? (models.get(effectiveModelId)?.ifcDataStore as GraphStore | null | undefined)
    : null;

  const typeCounts = useMemo(() => (store ? expressTypeCounts(store) : new Map<string, number>()), [store]);

  const offeredTypes = useMemo(
    () =>
      [...typeCounts.entries()]
        .filter(([name]) => canStartAChain(name))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [typeCounts],
  );

  const offeredSystems = useMemo(() => (store ? systemsIn(store) : []), [store]);

  // A model swap invalidates both selections: express ids and the type list
  // belong to the model they came from. Picked systems are express ids, so
  // carrying them over would point at whatever happens to share the number.
  useEffect(() => {
    setStartTypes([]);
    setStartSystems([]);
    setPositioned(null);
  }, [effectiveModelId]);

  const chosenCount = chain.pick === 'types' ? startTypes.length : startSystems.length;

  // The built chain is kept beside the graph: what counts as a dead end
  // depends on which rank is terminal, and only the chain knows that.
  const built: { graph: Graph; spec: RelationChain } | null = useMemo(() => {
    if (!store || chosenCount === 0) return null;
    const spec = chain.pick === 'types' ? chain.build(startTypes) : chain.build(startSystems);
    return { graph: buildRelationGraph(graphSourceFor(store), spec), spec };
  }, [store, chain, chosenCount, startTypes, startSystems]);

  /**
   * The drawing, which is not always the whole graph.
   *
   * `gapsFor` keeps reading the FULL graph below, so the readout still reports
   * every device with no connection point — the finding survives even when the
   * boxes do not.
   */
  const drawn: { graph: Graph; hiddenIsolated: number } | null = useMemo(() => {
    if (!built) return null;
    if (chain.isolatedStart !== 'drop') return { graph: built.graph, hiddenIsolated: 0 };
    const startKind = chainRanks(built.spec)[0];
    const isolated = new Set(danglingNodes(built.graph, startKind).map((n) => n.id));
    // Only start-rank nodes that touch NOTHING. A node with an incoming edge
    // is part of the picture even if nothing leaves it.
    for (const e of built.graph.edges) isolated.delete(e.target);
    if (isolated.size === 0) return { graph: built.graph, hiddenIsolated: 0 };
    return {
      graph: {
        nodes: built.graph.nodes.filter((n) => !isolated.has(n.id)),
        edges: built.graph.edges,
      },
      hiddenIsolated: isolated.size,
    };
  }, [built, chain]);

  const graph = drawn?.graph ?? null;

  const overBudget = (graph?.nodes.length ?? 0) > NODE_BUDGET;

  /**
   * Tell the viewport what the drawing contains.
   *
   * Every node, not only the elements: a room or a zone in the drawing has
   * geometry of its own and belongs in the highlight too. Published even when
   * the graph is over budget and therefore not drawn — the selection is still
   * a statement about which part of the model is meant, and the two would
   * otherwise disagree about what is being looked at.
   */
  useEffect(() => {
    if (!graph || !effectiveModelId || graph.nodes.length === 0) {
      setGraphHighlight(null);
      return;
    }
    setGraphHighlight({
      modelId: effectiveModelId,
      expressIds: graph.nodes.map((n) => n.expressId),
    });
  }, [graph, effectiveModelId, setGraphHighlight]);

  useEffect(() => {
    if (!built || !drawn || overBudget) {
      setPositioned(null);
      return;
    }
    // The DRAWN graph, not the full one — `drawn` is what the node budget was
    // measured against and what the reader is meant to see. The chain spec
    // still comes from `built`, since the ranks are a property of the chain.
    const graph = drawn.graph;
    const spec = built.spec;
    let cancelled = false;
    setLaying(true);
    layoutGraph(graph)
      .then((positions) => {
        if (cancelled) return;
        // Only non-terminal ranks can be dead ends — see `chainRanks`. Marking
        // the last rank would draw every node in the drawing as a gap.
        const ranks = chainRanks(spec);
        const dangling = new Set(
          ranks.slice(0, -1).flatMap((kind) => danglingNodes(graph, kind).map((n) => n.id)),
        );
        setPositioned({
          nodes: graph.nodes.map((n) => ({
            id: n.id,
            type: 'box',
            position: positions.get(n.id) ?? { x: 0, y: 0 },
            // Stated, not measured. React Flow otherwise waits for a DOM pass
            // before it knows how big a node is, and holds every node hidden
            // and every edge undrawn until it does — for sizes this file
            // already handed to ELK. `NODE_SIZE` is the one source for both.
            ...NODE_SIZE[n.kind],
            // Likewise stated: the layout runs left to right, so every edge
            // leaves a right edge and arrives at a left one. Letting React Flow
            // discover that from handle geometry is a measurement pass for an
            // answer that is fixed by the layout direction.
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            draggable: false,
            data: {
              kind: n.kind,
              ifcType: n.ifcType,
              name: n.name,
              dangling: dangling.has(n.id),
            } satisfies GraphNodeData,
          })),
          edges: graph.edges.map((e) => {
            const style = RELATION_STYLE[e.relation];
            return {
              id: e.id,
              source: e.source,
              target: e.target,
              // Right-angled, matching what ELK routed. A bézier here would
              // draw a curve where the layout computed a corner.
              type: 'smoothstep',
              // The kind is carried by the LINE — see `relationStyle.ts`.
              style: {
                strokeDasharray: style.dash,
                strokeWidth: style.width,
                stroke: 'var(--rf-edge-stroke, #94a3b8)',
              },
              // The Data Dictionary's short name, not the EXPRESS one: the full
              // `IfcRelContainedInSpatialStructure` is wider than most of the
              // boxes it sits between, and the legend carries the IFC name in
              // one place instead of on every edge.
              label: style.label,
              labelShowBg: false,
              // Lifted clear of the line rather than sitting on it, so the line
              // — which is what now carries the kind — stays unbroken.
              labelStyle: {
                fontSize: 9,
                fill: 'var(--rf-edge-label, #64748b)',
                transform: 'translateY(-6px)',
              },
            };
          }),
        });
      })
      .catch((err: unknown) => {
        // A superseded run is the normal consequence of changing the
        // selection while one is going, not a fault worth a console entry.
        if (cancelled || err instanceof LayoutSuperseded) return;
        console.error('[GraphPanel] layout failed', err);
        setPositioned(null);
      })
      .finally(() => {
        if (!cancelled) setLaying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [built, drawn, overBudget]);

  /**
   * Clicking a box selects that element everywhere.
   *
   * Through `setSelectedEntityId` with a GLOBAL id — the app's one selection
   * channel. The multi-model `setSelectedEntity(ref)` looks like the more
   * modern call and is the wrong one to make here: the Information panel, the
   * hierarchy tree and the renderer's highlight all key off `selectedEntityId`,
   * and `useModelSelection` derives the ref from it, not the other way round.
   * Setting only the ref selects the element in a store nobody is reading.
   */
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (!effectiveModelId) return;
      setSelectedEntityId(toGlobalIdFromModels(models, effectiveModelId, Number(node.id)));
    },
    [effectiveModelId, models, setSelectedEntityId],
  );

  const toggleType = useCallback((name: string) => {
    setStartTypes((prev) => (prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]));
  }, []);

  const toggleSystem = useCallback((expressId: number) => {
    setStartSystems((prev) =>
      prev.includes(expressId) ? prev.filter((id) => id !== expressId) : [...prev, expressId],
    );
  }, []);

  // Deliberately the FULL graph, not the drawn one: a device dropped from the
  // picture is still a device with no connection point.
  const gaps = built ? gapsFor(built.graph, built.spec) : [];

  // Only the relations this drawing actually contains. A legend listing six
  // kinds when two are drawn asks the reader to work out which lines are
  // absent — which is the opposite of what a legend is for.
  const drawnRelations = graph
    ? [...new Set(graph.edges.map((e) => e.relation))]
    : [];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" data-graph-view>
      <header className="flex shrink-0 items-center gap-2 border-b px-2 py-1">
        <span className="text-xs font-medium">Graph</span>
        <span className="text-[11px] text-muted-foreground">
          Elemente nach Zugehörigkeit, nicht nach Lage
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* The link into the viewport, switchable — the drawing reaching into
              the model is the point of docking it here, but not everyone wants
              the model touched while they read. */}
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={highlightInView}
              onChange={(e) => setHighlightInView(e.target.checked)}
            />
            Im Modell hervorheben
          </label>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} aria-label="Graph schliessen">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
      {/* The sidebar scrolls only where it has to. The picker is long — 17
          classes, 21 systems — and when the whole column scrolled, everything
          below it (the count, the gaps, the legend) sat under the fold and was
          simply never found. So the readout and the legend are pinned above,
          and the list takes whatever height is left. */}
      <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-zinc-200 p-3 text-xs dark:border-zinc-800">
        {models.size > 1 && (
          <label className="flex flex-col gap-1">
            <span className="font-medium text-zinc-500 dark:text-zinc-400">Modell</span>
            <select
              className="border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              value={effectiveModelId ?? ''}
              onChange={(e) => setModelId(e.target.value)}
            >
              {[...models.entries()].map(([id, m]) => (
                <option key={id} value={id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">Beziehungskette</span>
          <select
            className="border border-zinc-300 bg-white px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
          >
            {CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {graph && (
          <div className="text-zinc-500 dark:text-zinc-400">
            <p>
              {graph.nodes.length} Knoten, {graph.edges.length} Kanten.
            </p>
            {/* Said out loud rather than left to be noticed: a drawing that
                omits its gaps reads as if everything were placed. */}
            {gaps.map((gap) => (
              <p key={gap} className="text-amber-600 dark:text-amber-400">
                {gap}
              </p>
            ))}
            {/* Said rather than done silently: the reader has to know the
                drawing is not everything that was asked for. */}
            {(drawn?.hiddenIsolated ?? 0) > 0 && (
              <p>
                {drawn?.hiddenIsolated} ohne Anschluss nicht gezeichnet — sie gehören zu keiner
                Anlage.
              </p>
            )}
          </div>
        )}

        {drawnRelations.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-zinc-200 pt-2 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            <span className="font-medium text-zinc-500 dark:text-zinc-400">Beziehungsarten</span>
            {drawnRelations.map((relation) => (
              <RelationLegendRow
                key={relation}
                ifcEntity={relation}
                label={RELATION_STYLE[relation].label}
                dash={RELATION_STYLE[relation].dash}
                width={RELATION_STYLE[relation].width}
              />
            ))}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            {chain.pick === 'types' ? 'IFC-Klassen' : 'Anlagen'}
            {chosenCount > 0 && ` (${chosenCount})`}
          </span>

          {chain.pick === 'types' ? (
            <div className="flex flex-col overflow-y-auto">
              {offeredTypes.length === 0 && <span className="text-zinc-400">Kein Modell geladen.</span>}
              {offeredTypes.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleType(name)}
                  className={cn(
                    'flex items-center justify-between px-1.5 py-0.5 text-left transition-colors',
                    startTypes.includes(name)
                      ? 'bg-sky-100 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  )}
                >
                  <span className="truncate">{name}</span>
                  <span className="ml-2 shrink-0 tabular-nums opacity-50">{count}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col overflow-y-auto">
              {offeredSystems.length === 0 && (
                // Worth saying rather than showing an empty list: a model with
                // no systems in it is a fact about the model, and an empty box
                // reads as a broken picker.
                <span className="text-zinc-400">
                  Dieses Modell führt keine Anlagen (`IfcSystem`).
                </span>
              )}
              {offeredSystems.map((s) => (
                <button
                  key={s.expressId}
                  type="button"
                  onClick={() => toggleSystem(s.expressId)}
                  title={`${s.ifcType} #${s.expressId}`}
                  className={cn(
                    'flex items-center justify-between px-1.5 py-0.5 text-left transition-colors',
                    startSystems.includes(s.expressId)
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                  )}
                >
                  <span className="truncate">{s.name || `#${s.expressId}`}</span>
                  <span className="ml-2 shrink-0 tabular-nums opacity-50">{s.memberCount}</span>
                </button>
              ))}
            </div>
          )}
        </div>

      </aside>

      <div className="relative flex-1">
        {chosenCount === 0 && (
          <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-xs text-zinc-400">
            {chain.pick === 'types'
              ? 'Links eine oder mehrere IFC-Klassen wählen — daraus wird die Kette gezeichnet.'
              : 'Links eine oder mehrere Anlagen wählen — daraus wird das Schema gezeichnet.'}
          </p>
        )}

        {overBudget && (
          <p className="absolute inset-0 flex items-center justify-center p-8 text-center text-xs text-amber-600 dark:text-amber-400">
            {graph?.nodes.length} Knoten sind mehr, als sich zeichnen und lesen lässt (Grenze:{' '}
            {NODE_BUDGET}). Weniger {chain.pick === 'types' ? 'Klassen' : 'Anlagen'} wählen.
          </p>
        )}

        {laying && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Layout …
          </div>
        )}

        {positioned && (
          <ReactFlow
            nodes={positioned.nodes}
            edges={positioned.edges}
            nodeTypes={GRAPH_NODE_TYPES}
            onNodeClick={onNodeClick}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            fitView
            minZoom={0.05}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
      </div>
      </div>
    </div>
  );
}
