/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The space graph, drawn over the plan.
 *
 * What the escape routes are walked on and the door numbers are derived from,
 * as a picture: a dot per room, a line per doorway, and the number of doors
 * left to pass before somebody is safe. It answers the question that always
 * comes first when a derived number looks wrong — did the graph even find that
 * doorway — without anybody having to read code.
 *
 * # Deliberately unlike the drawing
 * Round dots, straight lines between room centres and a colour nothing else on
 * the plan uses: this is a diagram laid over a drawing, not part of it. A
 * doorway drawn to scale here would invite the reader to measure it, and the
 * line's only claim is "these two rooms are connected through this door".
 *
 * # The count is the point
 * Every door number comes from comparing two of these counts, so a wrong
 * number is nearly always a wrong count — and a count is checkable at a
 * glance: the corridor with the exit is 1, the rooms off it 2, the store room
 * behind one of them 3. A room with no count at all was never reached from any
 * way out, which is worth seeing on its own.
 */

import React from 'react';
import type { GraphEdgeView, GraphNodeView, SpaceGraphView } from '@/lib/spaceGraph/graphView';

export interface PlanSpaceGraphProps {
  view: SpaceGraphView;
  /** The transform the canvas paints with — the same one, or the graph drifts. */
  transform: { x: number; y: number; scale: number; rotation: number };
  /** Highlighted room, so a selection in a list can be found on the plan. */
  activeSpaceId?: number | null;
  onPickSpace?: (spaceId: number) => void;
}

/** Screen pixels — the diagram keeps its size as the plan zooms. */
const NODE_RADIUS = 9;
const STRANDED_RADIUS = 11;

const NODE_FILL: Record<GraphNodeView['kind'], string> = {
  room: '#0ea5e9',       // sky-500
  safe: '#10b981',       // emerald-500 — the way out
  stranded: '#f59e0b',   // amber-500 — nothing leads out of here
};

function project(
  p: { x: number; y: number },
  t: PlanSpaceGraphProps['transform'],
): { x: number; y: number } {
  const sx = p.x * t.scale;
  const sy = p.y * t.scale;
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return { x: sx * c - sy * s + t.x, y: sx * s + sy * c + t.y };
}

function edgeTitle(edge: GraphEdgeView): string {
  return edge.exterior
    ? `Tür #${edge.doorId} — ins Freie`
    : `Tür #${edge.doorId} — verbindet zwei Räume`;
}

function nodeTitle(node: GraphNodeView): string {
  const doors = `${node.degree} ${node.degree === 1 ? 'Tür' : 'Türen'}`;
  if (node.kind === 'safe') return `${node.label} — Ausgang selbst, ${doors}`;
  if (node.steps === null) {
    return `${node.label} — von keinem Ausgang aus erreichbar, ${doors}`;
  }
  return `${node.label} — ${node.steps} ${node.steps === 1 ? 'Tür' : 'Türen'} bis ins Sichere, ${doors}`;
}

export function PlanSpaceGraph({
  view, transform, activeSpaceId, onPickSpace,
}: PlanSpaceGraphProps): React.ReactElement | null {
  if (view.nodes.length === 0) return null;

  return (
    <svg className="absolute inset-0 h-full w-full" data-plan-space-graph>
      <g>
        {view.edges.map((edge) => {
          const a = project(edge.from, transform);
          const b = project(edge.to, transform);
          return (
            <line
              key={edge.doorId}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={edge.exterior ? '#10b981' : '#0ea5e9'}
              strokeWidth={2}
              // A stub into the open is dashed: it ends at a threshold, not at
              // a place, and a solid line would claim there is something there.
              strokeDasharray={edge.exterior ? '5 3' : undefined}
              opacity={0.85}
            >
              <title>{edgeTitle(edge)}</title>
            </line>
          );
        })}
      </g>
      <g>
        {view.nodes.map((node) => {
          const p = project(node.at, transform);
          const active = node.spaceId === activeSpaceId;
          const r = node.kind === 'stranded' ? STRANDED_RADIUS : NODE_RADIUS;
          return (
            <g
              key={node.spaceId}
              data-space-graph-node={node.spaceId}
              onClick={onPickSpace ? () => onPickSpace(node.spaceId) : undefined}
              style={{ cursor: onPickSpace ? 'pointer' : undefined, pointerEvents: 'auto' }}
            >
              <title>{nodeTitle(node)}</title>
              <circle
                cx={p.x} cy={p.y} r={r}
                fill={NODE_FILL[node.kind]}
                fillOpacity={0.9}
                stroke={active ? '#111827' : '#ffffff'}
                strokeWidth={active ? 3 : 1.5}
              />
              <text
                x={p.x} y={p.y}
                textAnchor="middle" dominantBaseline="central"
                fontSize={10} fontWeight={700} fill="#ffffff"
              >
                {node.kind === 'safe' ? '0' : node.steps ?? '?'}
              </text>
              <text
                x={p.x} y={p.y + r + 9}
                textAnchor="middle" dominantBaseline="central"
                fontSize={10} className="fill-zinc-700 dark:fill-zinc-200"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default PlanSpaceGraph;
