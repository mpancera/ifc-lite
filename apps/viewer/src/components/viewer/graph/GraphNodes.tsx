/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The node shapes.
 *
 * One component per rank rather than one generic box, because the rank is the
 * thing a reader picks up first: an element, the room it sits in, the zone the
 * room belongs to. Colour alone would carry that badly in a printed drawing and
 * not at all for anyone who cannot separate the hues.
 *
 * Handles sit left and right only. The layout runs left to right, so a handle
 * on the top or bottom edge would give ELK's orthogonal router somewhere to
 * attach that the eye does not expect an edge to leave from.
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNodeKind } from '@ifc-lite/graph';
import { NODE_SIZE } from '@/lib/graph/layout';
import { cn } from '@/lib/utils';

export interface GraphNodeData extends Record<string, unknown> {
  kind: GraphNodeKind;
  /** Exact EXPRESS name, e.g. `IfcSensor`. */
  ifcType: string;
  name: string;
  /** True when nothing leaves this node — the chain could not place it. */
  dangling: boolean;
}

/**
 * One palette entry per rank.
 *
 * Kept as whole Tailwind class strings rather than assembled from fragments:
 * Tailwind scans source text for complete class names, and a class built at
 * runtime is a class that silently does not exist in the stylesheet.
 */
const KIND_STYLE: Record<GraphNodeKind, string> = {
  element:
    'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100',
  space:
    'border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-900 dark:text-sky-100',
  storey:
    'border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/50 text-violet-900 dark:text-violet-100',
  zone:
    'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-100',
  system:
    'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-100',
  port:
    'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-100',
};

export function GraphBoxNode({ data, selected }: NodeProps) {
  const { kind, ifcType, name, dangling } = data as GraphNodeData;
  const size = NODE_SIZE[kind];

  return (
    <div
      className={cn(
        'flex flex-col justify-center gap-0.5 overflow-hidden border px-2 py-1 text-[11px] leading-tight',
        KIND_STYLE[kind],
        // A dashed outline, not a red one: "the chain stopped here" is a
        // finding to look at, not an error to be alarmed by, and half these
        // are legitimate (an element genuinely hung off the storey).
        dangling && 'border-dashed',
        selected && 'ring-2 ring-sky-500 ring-offset-1 dark:ring-offset-zinc-950',
      )}
      style={{ width: size.width, height: size.height }}
      title={`${ifcType}${name ? ` — ${name}` : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-400" />
      <span className="truncate font-medium">{name || '(ohne Name)'}</span>
      {/* A port box is a third the width and carries a two-character name;
          `IfcDistributionPort` under it would be an ellipsis. The class is in
          the tooltip, where it is one hover away rather than never. */}
      {kind !== 'port' && <span className="truncate text-[10px] opacity-60">{ifcType}</span>}
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-zinc-400" />
    </div>
  );
}

export const GRAPH_NODE_TYPES = { box: GraphBoxNode };
