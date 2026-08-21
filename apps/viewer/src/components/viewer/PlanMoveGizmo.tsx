/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Moving the whole selected object, in the plan.
 *
 * Two arrows and a centre square at the object's plan centre: red along IFC X,
 * green along IFC Y (drawn pointing north, which is up), and the square for a
 * free drag. What it does not have is a third axis — height is not a thing a
 * floor plan can express, and offering it here would let somebody move an
 * element off its storey without seeing it happen.
 *
 * # Why there was no gizmo in 2D at all
 * Plan mode covers the 3D viewport rather than replacing it, so the 3D gizmo
 * went on rendering over the plan, placed by a camera nobody could see. It has
 * been shut out of plan mode; this is what stands in its place, and unlike its
 * predecessor it is positioned by the PLAN's own transform.
 *
 * # Fixed on screen, like every other handle
 * The arrows keep their length in pixels while the drawing scales with the
 * zoom — the same rule the room-shape handles, the labels and the device marks
 * follow, and for the same reason: they are things to hit with a mouse.
 *
 * # One drag, one undo step
 * Each pointer-move frame commits a mutation, and they share a batch id so a
 * single Ctrl+Z puts the object back where it started. A REFUSED write leaves
 * the accumulator where it was, so the next frame re-offers the whole
 * outstanding move instead of dropping it silently.
 */

import React, { useCallback, useRef } from 'react';
import type { Point2D } from '@ifc-lite/drawing-2d';
import { planScreenToDrawing } from '@/lib/plan/planPick';
import {
  axisScreenDirection, constrainToAxis, isWorthWriting, pendingStep, planDrawingToScreen,
  type GizmoAxis, type PlanTransform,
} from '@/lib/plan/moveGizmo';

export interface PlanMoveGizmoProps {
  /** The object's centre in drawing space (metres). */
  anchor: Point2D;
  /** The transform the canvas paints with — the same one, or the gizmo drifts. */
  transform: PlanTransform;
  /**
   * Commit a step, in drawing-space metres. Return `false` when the model
   * refused it; the drag then re-offers the same move on the next frame rather
   * than losing it.
   */
  onMove: (step: Point2D) => boolean;
  /** Called when a drag begins, so the caller can open one undo batch. */
  onDragStart?: () => void;
  /** Called when it ends, however it ends. */
  onDragEnd?: () => void;
}

/** Arrow length and the centre square's half-width, in screen pixels. */
const ARM_PX = 54;
const HUB_PX = 7;
/** The clickable width of an arrow, in screen pixels — wider than it looks. */
const GRAB_PX = 14;

const AXIS_COLOUR: Record<'x' | 'y', string> = {
  x: '#ef4444', // red — IFC X, matching the 3D gizmo and the axis cube
  y: '#10b981', // green — IFC Y
};

export function PlanMoveGizmo({
  anchor, transform, onMove, onDragStart, onDragEnd,
}: PlanMoveGizmoProps): React.ReactElement | null {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ axis: GizmoAxis; start: Point2D; applied: Point2D } | null>(null);

  /** Cursor in drawing space, with the plan's rotation undone. */
  const toDrawing = useCallback((event: React.PointerEvent): Point2D => {
    const rect = svgRef.current?.getBoundingClientRect();
    return planScreenToDrawing(
      event.clientX - (rect?.left ?? 0),
      event.clientY - (rect?.top ?? 0),
      transform,
    );
  }, [transform]);

  const beginDrag = (axis: GizmoAxis) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // The plan pans on drag; without this the object and the view move at once.
    event.stopPropagation();
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { axis, start: toDrawing(event), applied: { x: 0, y: 0 } };
    onDragStart?.();
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const at = toDrawing(event);
    const total = constrainToAxis(
      { x: at.x - state.start.x, y: at.y - state.start.y },
      state.axis,
    );
    const step = pendingStep(total, state.applied);
    if (!isWorthWriting(step)) return;
    // Only bank the move once the model has taken it — see the header.
    if (onMove(step)) state.applied = total;
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag.current) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    drag.current = null;
    onDragEnd?.();
  };

  const hub = planDrawingToScreen(anchor, transform);

  const arm = (axis: 'x' | 'y') => {
    const dir = axisScreenDirection(axis, transform);
    return { x: hub.x + dir.x * ARM_PX, y: hub.y + dir.y * ARM_PX };
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {(['x', 'y'] as const).map((axis) => {
        const tip = arm(axis);
        const dir = axisScreenDirection(axis, transform);
        // The head, as a triangle across the arrow's own direction.
        const across = { x: -dir.y, y: dir.x };
        const base = { x: tip.x - dir.x * 10, y: tip.y - dir.y * 10 };
        const head = [
          `${tip.x},${tip.y}`,
          `${base.x + across.x * 4},${base.y + across.y * 4}`,
          `${base.x - across.x * 4},${base.y - across.y * 4}`,
        ].join(' ');
        return (
          <g key={axis} data-plan-gizmo-handle={axis} style={{ pointerEvents: 'auto', cursor: 'grab' }}>
            <title>{axis === 'x' ? 'Nach Osten/Westen verschieben' : 'Nach Norden/Süden verschieben'}</title>
            {/* An invisible fat line under the thin one: the arrow is aimed at
                with a mouse, and 2 px is not a target. */}
            <line
              x1={hub.x} y1={hub.y} x2={tip.x} y2={tip.y}
              stroke="transparent" strokeWidth={GRAB_PX}
              onPointerDown={beginDrag(axis)}
            />
            <line
              x1={hub.x} y1={hub.y} x2={tip.x} y2={tip.y}
              stroke={AXIS_COLOUR[axis]} strokeWidth={2} style={{ pointerEvents: 'none' }}
            />
            <polygon points={head} fill={AXIS_COLOUR[axis]} style={{ pointerEvents: 'none' }} />
          </g>
        );
      })}

      <g data-plan-gizmo-handle="free" style={{ pointerEvents: 'auto', cursor: 'move' }}>
        <title>Frei in der Ebene verschieben</title>
        <rect
          x={hub.x - HUB_PX} y={hub.y - HUB_PX} width={HUB_PX * 2} height={HUB_PX * 2}
          fill="#ffffff" fillOpacity={0.85} stroke="#334155" strokeWidth={1.5}
          onPointerDown={beginDrag('free')}
        />
      </g>
    </svg>
  );
}
