/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A wall's two ends, with handles you can drag — the plan's Edit shape for
 * walls.
 *
 * The 3D viewport has had endpoint handles for a while; this is the same edit
 * on the floor plan, and deliberately a SMALLER one. In 3D an end can be taken
 * anywhere in space; here it moves in the plan's own plane, which is what a
 * floor plan can express and, on a plan, what somebody actually wants: walls
 * meet other walls, and the two coordinates that decide whether they do are the
 * two this shows. The height stays exactly as it was.
 *
 * # The same rules as the room outline
 * Handles keep their size in pixels while the drawing scales; a dragged end
 * snaps to the cut lines and to the wall's own other end, with Alt to suppress
 * it; nothing is written until the mode is finished with Enter or the tick. A
 * wall and a room are edited with the same hand.
 *
 * # Why the ends and nothing else
 * Length and angle both follow from where the ends are, so a handle per end is
 * the whole edit. A midpoint handle would be a second way to say "move the
 * wall", which the gizmo already says.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { planScreenToDrawing } from '@/lib/plan/planPick';
import { snapPoint, type SnapResult, type SnapSegment } from '@/lib/roomShape/snap';

export interface PlanWallEndsProps {
  /** The wall's ends in drawing space (metres). */
  start: Point2D;
  end: Point2D;
  /** The transform the canvas paints with — the same one, or the handles drift. */
  transform: { x: number; y: number; scale: number; rotation: number };
  /** Called once, when the mode is finished, with the ends as they stand. */
  onCommit: (start: Point2D, end: Point2D) => void;
  /** Called when the mode is left without writing. */
  onCancel?: () => void;
  /** Wall lines to snap onto, in drawing space. */
  snapSegments?: readonly SnapSegment[];
  /** Whether snapping is on at all — the same toggle the measure tool uses. */
  snapEnabled?: boolean;
  /** Rises when the panel's "Fertig" asks for the draft to be written. */
  commitSignal?: number;
}

/** Screen pixels: the handle's radius, and how close the cursor must be. */
const HANDLE_R = 6;
const GRAB_PX = 12;
/** How far a dragged end reaches for a line to land on, in screen pixels. */
const SNAP_PX = 12;

function project(p: Point2D, t: PlanWallEndsProps['transform']): Point2D {
  const sx = p.x * t.scale;
  const sy = p.y * t.scale;
  const c = Math.cos(t.rotation);
  const s = Math.sin(t.rotation);
  return { x: sx * c - sy * s + t.x, y: sx * s + sy * c + t.y };
}

export function PlanWallEnds({
  start, end, transform, onCommit, onCancel,
  snapSegments = [], snapEnabled = true, commitSignal = 0,
}: PlanWallEndsProps): React.ReactElement | null {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [draft, setDraft] = useState<[Point2D, Point2D] | null>(null);
  const [snapped, setSnapped] = useState<SnapResult | null>(null);
  const dragging = useRef<{ index: 0 | 1 } | null>(null);

  const ends: [Point2D, Point2D] = draft ?? [start, end];

  const toDrawing = useCallback((event: React.PointerEvent): Point2D => {
    const rect = svgRef.current?.getBoundingClientRect();
    return planScreenToDrawing(
      event.clientX - (rect?.left ?? 0),
      event.clientY - (rect?.top ?? 0),
      transform,
    );
  }, [transform]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const at = toDrawing(event);
    // A screen distance: at the zoom somebody is working at, a fixed distance
    // in metres would be unusable at one end of the range or the other.
    const reach = GRAB_PX / transform.scale;
    const d0 = Math.hypot(ends[0].x - at.x, ends[0].y - at.y);
    const d1 = Math.hypot(ends[1].x - at.x, ends[1].y - at.y);
    const index: 0 | 1 | null = d0 <= reach && d0 <= d1 ? 0 : d1 <= reach ? 1 : null;
    if (index === null) return;

    event.stopPropagation();
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragging.current = { index };
    setDraft([ends[0], ends[1]]);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragging.current;
    if (!drag || !draft) return;
    event.stopPropagation();

    const free = toDrawing(event);
    // The other end is a snap target: a wall closed exactly onto its own start
    // is a thing somebody means to do, and hitting it by hand is luck.
    const hit = snapEnabled && !event.altKey
      ? snapPoint(free, {
        segments: snapSegments,
        points: [draft[drag.index === 0 ? 1 : 0]],
        tolerance: SNAP_PX / transform.scale,
      })
      : null;
    setSnapped(hit);
    const next: [Point2D, Point2D] = [draft[0], draft[1]];
    next[drag.index] = hit?.at ?? free;
    setDraft(next);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (!dragging.current) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    dragging.current = null;
    // The draft STAYS: the next drag continues on it, and the model hears once.
    setSnapped(null);
  };

  // The panel's button, arriving as a signal. Skipped on the first render — a
  // mode that committed the moment it opened would write the wall unchanged.
  const seenCommitSignal = useRef(commitSignal);
  useEffect(() => {
    if (commitSignal === seenCommitSignal.current) return;
    seenCommitSignal.current = commitSignal;
    onCommit(ends[0], ends[1]);
  }, [commitSignal, ends, onCommit]);

  // Enter finishes, Escape leaves it alone. On the window, because the handles
  // are not focusable and the pointer is over the plan.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        onCommit(ends[0], ends[1]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDraft(null);
        onCancel?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ends, onCommit, onCancel]);

  const a = project(ends[0], transform);
  const b = project(ends[1], transform);
  const length = Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      data-plan-wall-ends
      // Clicks pass through except on the handles, like the room outline: a
      // full-pane overlay that swallowed every click would make the plan
      // unusable while the mode is open.
      style={{ pointerEvents: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <line
        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="#10b981" strokeWidth={1.5} strokeDasharray="6 3"
      />
      {snapped && (
        <circle
          cx={project(snapped.at, transform).x}
          cy={project(snapped.at, transform).y}
          r={HANDLE_R + 3}
          fill="none" stroke="#f59e0b" strokeWidth={1.5}
        />
      )}
      {[a, b].map((p, i) => (
        <circle
          key={i}
          cx={p.x} cy={p.y} r={HANDLE_R}
          fill="#ffffff" fillOpacity={0.9} stroke="#10b981" strokeWidth={2}
          style={{ pointerEvents: 'auto', cursor: 'grab' }}
        />
      ))}
      {/* The length, where it is being changed. A wall is drawn to a dimension
          far more often than to a picture. */}
      <text
        x={(a.x + b.x) / 2}
        y={(a.y + b.y) / 2 - 10}
        textAnchor="middle"
        className="fill-emerald-700 dark:fill-emerald-300"
        style={{ fontSize: 11, paintOrder: 'stroke', stroke: 'rgba(255,255,255,0.8)', strokeWidth: 3 }}
      >
        {length.toFixed(2)} m
      </text>
    </svg>
  );
}
