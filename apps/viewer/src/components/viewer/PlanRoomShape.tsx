/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A room's outline, with handles you can drag.
 *
 * The corners of the selected room as circles, the middle of each edge as a
 * smaller square. Drag a corner to move it; drag an edge midpoint and a corner
 * appears there and follows the cursor — a rectangle becomes an L in one drag,
 * which is the move this tool exists for.
 *
 * # The handles are fixed on screen, the outline is not
 * The outline is the building and scales with the zoom. The handles are things
 * to hit with a mouse, so they keep their size in pixels — the same rule the
 * labels and the device marks follow.
 *
 * # Nothing is written until the mode is finished
 * The draft lives here across every drag of the session and reaches the model
 * once, on Enter or the tick. Writing per drag made three corners of one room
 * three undo steps and three geometry rebuilds — and, worse, left no state in
 * which the shape was half-changed on purpose.
 *
 * # A corner lands on what is drawn
 * Dragged by hand a corner is never right — 30 mm off the wall, and the area
 * is wrong by a hundredth while the space boundary touches nothing. So it
 * snaps to the cut lines and to the outline's own corners; hold Alt to put one
 * exactly where the cursor is instead.
 */

import React, { useCallback, useRef, useState } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { planScreenToDrawing } from '@/lib/plan/planPick';
import {
  edgeMidpoints, insertVertex, moveVertex, nearestHandle, outlineProblem,
  polygonArea, type RoomHandle,
} from '@/lib/roomShape/roomShape';
import { snapPoint, type SnapResult, type SnapSegment } from '@/lib/roomShape/snap';

export interface PlanRoomShapeProps {
  /** The room's current outline, in drawing space (metres). */
  outline: readonly Point2D[];
  /** The transform the canvas paints with — the same one, or the handles drift. */
  transform: { x: number; y: number; scale: number; rotation: number };
  /** Called once, when the mode is finished, with the outline as it stands. */
  onCommit: (outline: Point2D[]) => void;
  /** Called when the mode is left without writing. */
  onCancel?: () => void;
  /** Wall lines to snap onto, in drawing space. */
  snapSegments?: readonly SnapSegment[];
  /** Whether snapping is on at all — the same toggle the measure tool uses. */
  snapEnabled?: boolean;
  /**
   * Rises when somebody asks, from outside, that the draft be written — the
   * "Fertig" button in the properties panel. Enter does the same thing from
   * here; this is the same act arriving from the other side of the tree.
   */
  commitSignal?: number;
}

/** Screen pixels. A corner handle's radius; the edge handle is smaller. */
const VERTEX_R = 6;
const EDGE_R = 4;
/** How close the cursor has to be to grab one, in screen pixels. */
const GRAB_PX = 10;
/** How far a dragged corner reaches for a wall to land on, in screen pixels. */
const SNAP_PX = 12;

function project(
  p: Point2D,
  t: PlanRoomShapeProps['transform'],
): { x: number; y: number } {
  const sx = p.x * t.scale;
  const sy = p.y * t.scale;
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return { x: sx * c - sy * s + t.x, y: sx * s + sy * c + t.y };
}

export function PlanRoomShape({
  outline, transform, onCommit, onCancel, snapSegments = [], snapEnabled = true,
  commitSignal = 0,
}: PlanRoomShapeProps): React.ReactElement | null {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<Point2D[] | null>(null);
  const [snapped, setSnapped] = useState<SnapResult | null>(null);
  const dragging = useRef<{ index: number } | null>(null);

  const points = draft ?? outline;

  /** Cursor position in drawing space, with the plan's rotation undone. */
  const toDrawing = useCallback((event: React.PointerEvent): Point2D => {
    const rect = svgRef.current?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0);
    const y = event.clientY - (rect?.top ?? 0);
    return planScreenToDrawing(x, y, transform);
  }, [transform]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const at = toDrawing(event);
    // The grab radius is a SCREEN distance; at the zoom the user is working
    // at, a fixed distance in metres would be unusable at both ends.
    const handle: RoomHandle | null = nearestHandle(points, at, GRAB_PX / transform.scale);
    if (!handle) return;

    event.stopPropagation();
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);

    if (handle.kind === 'vertex') {
      dragging.current = { index: handle.index };
      setDraft([...points]);
      return;
    }
    const inserted = insertVertex(points, handle.index, handle.at);
    dragging.current = { index: inserted.index };
    setDraft(inserted.points);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragging.current;
    if (!drag || !draft) return;
    event.stopPropagation();

    const free = toDrawing(event);
    // Snap targets: the walls of the cut, plus the outline's OWN other corners
    // — the second is what lets a room be closed square on itself, and it has
    // to exclude the corner being dragged or it would snap to where it is.
    // Alt suppresses the snap for one drag, the way every CAD does it. The
    // global toggle (S) only reaches the keyboard while the Measure tool is
    // held, so without a modifier there would be no way to place a corner
    // deliberately off the wall.
    const hit = snapEnabled && !event.altKey
      ? snapPoint(free, {
        segments: snapSegments,
        points: draft.filter((_, i) => i !== drag.index),
        tolerance: SNAP_PX / transform.scale,
      })
      : null;
    setSnapped(hit);
    setDraft(moveVertex(draft, drag.index, hit?.at ?? free));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    dragging.current = null;
    // The draft STAYS: the next drag continues on it, and the model hears
    // once, when the mode is finished.
    setSnapped(null);
  };

  // The button in the properties panel, arriving as a signal. Skipped on the
  // first render — a mode that committed the moment it opened would write the
  // unchanged outline and close again.
  const seenCommitSignal = React.useRef(commitSignal);
  React.useEffect(() => {
    if (commitSignal === seenCommitSignal.current) return;
    seenCommitSignal.current = commitSignal;
    onCommit(draft ?? [...outline]);
  }, [commitSignal, draft, outline, onCommit]);

  // Enter finishes, Escape leaves it alone. Bound while the mode is open, on
  // the window, because the handles are not focusable and the pointer is
  // usually over the plan rather than over anything that could take a key.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        onCommit(draft ?? [...outline]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDraft(null);
        onCancel?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft, outline, onCommit, onCancel]);

  if (points.length < 3) return null;

  const screen = points.map((p) => project(p, transform));
  const mids = edgeMidpoints(points).map((p) => project(p, transform));
  const path = `${screen.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} Z`;
  const problem = outlineProblem(points);
  const centre = screen.reduce(
    (acc, p) => ({ x: acc.x + p.x / screen.length, y: acc.y + p.y / screen.length }),
    { x: 0, y: 0 },
  );

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      // The SVG itself lets clicks through; only the handles take them. The
      // outline is up whenever a room is selected in edit mode, and a full-pane
      // overlay that swallowed every click would make the plan unusable.
      style={{ pointerEvents: 'none' }}
      data-plan-room-shape
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <path
        d={path}
        fill={problem ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)'}
        stroke={problem ? '#ef4444' : '#10b981'}
        strokeWidth={1.5}
      />
      {/* Where the corner will land. Drawn only while it IS snapped, because
          the point of the mark is to say "this is on the wall, not near it". */}
      {snapped && (() => {
        const p = project(snapped.at, transform);
        return (
          <g>
            <line x1={p.x - 7} y1={p.y} x2={p.x + 7} y2={p.y} stroke="#f59e0b" strokeWidth={1.5} />
            <line x1={p.x} y1={p.y - 7} x2={p.x} y2={p.y + 7} stroke="#f59e0b" strokeWidth={1.5} />
            {snapped.kind === 'vertex' && (
              <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
            )}
          </g>
        );
      })()}
      {/* The area, live: a corner dragged to the wrong wall is much easier to
          see as a number than as a shape. */}
      <text
        x={centre.x} y={centre.y}
        textAnchor="middle" dominantBaseline="central"
        fontSize={11} fontWeight={600}
        className="fill-emerald-700 dark:fill-emerald-300 stroke-white dark:stroke-zinc-950"
        strokeWidth={2.5} paintOrder="stroke"
      >
        {problem ?? `${polygonArea(points).toFixed(2)} m²`}
      </text>
      {mids.map((p, i) => (
        <rect
          key={`e${i}`}
          x={p.x - EDGE_R} y={p.y - EDGE_R}
          width={EDGE_R * 2} height={EDGE_R * 2}
          className="fill-white dark:fill-zinc-900 stroke-emerald-600"
          strokeWidth={1.5}
          style={{ cursor: 'copy', pointerEvents: 'auto' }}
        >
          <title>Ziehen fügt hier eine Ecke ein</title>
        </rect>
      ))}
      {screen.map((p, i) => (
        <circle
          key={`v${i}`}
          cx={p.x} cy={p.y} r={VERTEX_R}
          className="fill-emerald-500 stroke-white dark:stroke-zinc-950"
          strokeWidth={2}
          style={{ cursor: 'grab', pointerEvents: 'auto' }}
        >
          <title>Ecke {i + 1} von {screen.length}</title>
        </circle>
      ))}
    </svg>
  );
}

export default PlanRoomShape;
