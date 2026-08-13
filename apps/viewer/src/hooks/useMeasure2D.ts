/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hook for 2D measurement tool logic
 * Extracts pan/measure mouse handling, snapping, orthogonal constraints,
 * and keyboard/global-mouseup effects from Section2DPanel.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { Drawing2D } from '@ifc-lite/drawing-2d';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface UseMeasure2DParams {
  drawing: Drawing2D | null;
  /** `rotation` is the plan view's display angle in radians; absent or 0 elsewhere. */
  viewTransform: { x: number; y: number; scale: number; rotation?: number };
  setViewTransform: React.Dispatch<React.SetStateAction<{ x: number; y: number; scale: number }>>;
  sectionAxis: 'down' | 'front' | 'side';
  containerRef: React.RefObject<HTMLDivElement | null>;
  // Store state
  measure2DMode: boolean;
  measure2DStart: { x: number; y: number } | null;
  measure2DCurrent: { x: number; y: number } | null;
  measure2DShiftLocked: boolean;
  measure2DLockedAxis: 'x' | 'y' | null;
  setMeasure2DStart: (pt: { x: number; y: number }) => void;
  setMeasure2DCurrent: (pt: { x: number; y: number }) => void;
  setMeasure2DShiftLocked: (locked: boolean, axis?: 'x' | 'y') => void;
  setMeasure2DSnapPoint: (pt: { x: number; y: number } | null) => void;
  cancelMeasure2D: () => void;
  completeMeasure2D: () => void;
}

export interface UseMeasure2DResult {
  /**
   * Screen pixels to drawing coordinates, with the axis flips of the current
   * section applied.
   *
   * Exposed rather than copied: the alignment picker needs exactly this
   * mapping, and a second implementation of it would agree with this one only
   * until somebody changed one of them.
   */
  screenToDrawing: (screenX: number, screenY: number) => { x: number; y: number };
  /** Nearest model feature within the snap radius, or `null`. Exposed for
   *  the alignment picker, whose reference line snaps to the same geometry. */
  findSnapPoint: (drawingCoord: { x: number; y: number }) => { x: number; y: number } | null;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleMouseLeave: () => void;
  handleMouseEnter: (e: React.MouseEvent) => void;
}

// ─── Hook implementation ────────────────────────────────────────────────────

export function useMeasure2D({
  drawing,
  viewTransform,
  setViewTransform,
  sectionAxis,
  containerRef,
  measure2DMode,
  measure2DStart,
  measure2DCurrent,
  measure2DShiftLocked,
  measure2DLockedAxis,
  setMeasure2DStart,
  setMeasure2DCurrent,
  setMeasure2DShiftLocked,
  setMeasure2DSnapPoint,
  cancelMeasure2D,
  completeMeasure2D,
}: UseMeasure2DParams): UseMeasure2DResult {
  // ── Internal refs ───────────────────────────────────────────────────────
  const isPanning = useRef(false);
  const lastPanPoint = useRef({ x: 0, y: 0 });
  const isMouseButtonDown = useRef(false);
  const isMouseInsidePanel = useRef(true);

  // ═══════════════════════════════════════════════════════════════════════
  // 2D MEASURE TOOL HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  // Convert screen coordinates to drawing coordinates
  const screenToDrawing = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    // Screen coord → drawing coord
    // Apply axis-specific inverse transforms (matching canvas rendering)
    const currentAxis = sectionAxis;
    const flipY = currentAxis !== 'down'; // Only flip Y for front/side views
    const flipX = currentAxis === 'side'; // Flip X for side view

    // Inverse of: screenX = drawingX * scaleX + transform.x
    // where scaleX = flipX ? -scale : scale
    const scaleX = flipX ? -viewTransform.scale : viewTransform.scale;
    const scaleY = flipY ? -viewTransform.scale : viewTransform.scale;

    // A plan may be turned for display. Undo the angle before the scale, so a
    // measurement taken on a turned plan is stored in TRUE drawing coordinates
    // — the same rule the plan's own picking follows.
    const rotation = currentAxis === 'down' ? (viewTransform.rotation ?? 0) : 0;
    let dx = screenX - viewTransform.x;
    let dy = screenY - viewTransform.y;
    if (rotation !== 0) {
      const c = Math.cos(-rotation);
      const sn = Math.sin(-rotation);
      const rx = dx * c - dy * sn;
      const ry = dx * sn + dy * c;
      dx = rx;
      dy = ry;
    }
    return { x: dx / scaleX, y: dy / scaleY };
  }, [viewTransform, sectionAxis]);

  // Find nearest point on a line segment
  const nearestPointOnSegment = useCallback((
    p: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): { point: { x: number; y: number }; dist: number } => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 0.0001) {
      // Degenerate segment
      const d = Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
      return { point: a, dist: d };
    }

    // Parameter t along segment [0,1]
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const nearest = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.sqrt((p.x - nearest.x) ** 2 + (p.y - nearest.y) ** 2);

    return { point: nearest, dist };
  }, []);

  // Find snap point near cursor (check polygon vertices, edges, and line endpoints)
  const findSnapPoint = useCallback((drawingCoord: { x: number; y: number }): { x: number; y: number } | null => {
    if (!drawing) return null;

    const snapThreshold = 10 / viewTransform.scale; // 10 screen pixels
    let bestSnap: { x: number; y: number } | null = null;
    let bestDist = snapThreshold;

    // Priority 1: Check polygon vertices (endpoints are highest priority)
    for (const polygon of drawing.cutPolygons) {
      for (const pt of polygon.polygon.outer) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) { // Vertices get priority (70% threshold)
          return { x: pt.x, y: pt.y }; // Return immediately for vertex snaps
        }
      }
      for (const hole of polygon.polygon.holes) {
        for (const pt of hole) {
          const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
          if (dist < bestDist * 0.7) {
            return { x: pt.x, y: pt.y };
          }
        }
      }
    }

    // Priority 2: Check line endpoints
    for (const line of drawing.lines) {
      const { start, end } = line.line;
      for (const pt of [start, end]) {
        const dist = Math.sqrt((pt.x - drawingCoord.x) ** 2 + (pt.y - drawingCoord.y) ** 2);
        if (dist < bestDist * 0.7) {
          return { x: pt.x, y: pt.y };
        }
      }
    }

    // Priority 3: Check polygon edges
    for (const polygon of drawing.cutPolygons) {
      const outer = polygon.polygon.outer;
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i];
        const b = outer[(i + 1) % outer.length];
        const { point, dist } = nearestPointOnSegment(drawingCoord, a, b);
        if (dist < bestDist) {
          bestDist = dist;
          bestSnap = point;
        }
      }
      for (const hole of polygon.polygon.holes) {
        for (let i = 0; i < hole.length; i++) {
          const a = hole[i];
          const b = hole[(i + 1) % hole.length];
          const { point, dist } = nearestPointOnSegment(drawingCoord, a, b);
          if (dist < bestDist) {
            bestDist = dist;
            bestSnap = point;
          }
        }
      }
    }

    // Priority 4: Check drawing lines
    for (const line of drawing.lines) {
      const { start, end } = line.line;
      const { point, dist } = nearestPointOnSegment(drawingCoord, start, end);
      if (dist < bestDist) {
        bestDist = dist;
        bestSnap = point;
      }
    }

    return bestSnap;
  }, [drawing, viewTransform.scale, nearestPointOnSegment]);

  // Apply orthogonal constraint if shift is held
  const applyOrthogonalConstraint = useCallback((start: { x: number; y: number }, current: { x: number; y: number }, lockedAxis: 'x' | 'y' | null): { x: number; y: number } => {
    if (!lockedAxis) return current;

    if (lockedAxis === 'x') {
      return { x: current.x, y: start.y };
    } else {
      return { x: start.x, y: current.y };
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════════

  // Keyboard handlers for shift key (orthogonal constraint)
  useEffect(() => {
    if (!measure2DMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && measure2DStart && measure2DCurrent && !measure2DShiftLocked) {
        // Determine axis based on dominant direction
        const dx = Math.abs(measure2DCurrent.x - measure2DStart.x);
        const dy = Math.abs(measure2DCurrent.y - measure2DStart.y);
        const axis = dx > dy ? 'x' : 'y';
        setMeasure2DShiftLocked(true, axis);
      }
      if (e.key === 'Escape') {
        cancelMeasure2D();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        setMeasure2DShiftLocked(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [measure2DMode, measure2DStart, measure2DCurrent, measure2DShiftLocked, setMeasure2DShiftLocked, cancelMeasure2D]);

  // Global mouseup handler to cancel measurement if released outside panel
  useEffect(() => {
    if (!measure2DMode) return;

    const handleGlobalMouseUp = () => {
      // Only bookkeeping. Cancelling here would end a half-drawn measurement
      // every time the button came up outside the plan — which with a
      // click-to-click gesture is most of the time, since the first click is
      // released before the cursor has gone anywhere.
      isMouseButtonDown.current = false;
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [measure2DMode]);

  // ═══════════════════════════════════════════════════════════════════════
  // PAN / MEASURE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Right button pans, whatever tool is active. Left stays free for the
    // tool, so a plan can be picked at precisely without first putting a tool
    // down — which is what "the cursor is a pointer, not a hand" means in
    // practice.
    if (e.button === 2) {
      isPanning.current = true;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;

    isMouseButtonDown.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (measure2DMode) {
      // Click, preview, click — not press-drag-release.
      //
      // The same rhythm the underlay alignment and the plan rotation already
      // use, and for the same reason: you see the snapped point BEFORE
      // committing it, so you know what you caught. Dragging hides that, and
      // on a long wall the two ends are far enough apart that holding the
      // button across them is a nuisance in its own right.
      const drawingCoord = screenToDrawing(screenX, screenY);
      const snapPoint = findSnapPoint(drawingCoord);
      const clicked = snapPoint || drawingCoord;

      if (!measure2DStart) {
        setMeasure2DStart(clicked);
        setMeasure2DCurrent(clicked);
        return;
      }

      // Second click closes the measurement. The end point goes in first:
      // `completeMeasure2D` reads it back out of the store, and the store
      // sets synchronously, so this is the value it sees.
      setMeasure2DCurrent(
        measure2DShiftLocked && measure2DLockedAxis
          ? applyOrthogonalConstraint(measure2DStart, clicked, measure2DLockedAxis)
          : clicked,
      );
      completeMeasure2D();
    }
    // No left-button panning: it would fight every pick, and the right button
    // does the job without a mode.
  }, [measure2DMode, measure2DStart, measure2DShiftLocked, measure2DLockedAxis,
      screenToDrawing, findSnapPoint, setMeasure2DStart, setMeasure2DCurrent,
      applyOrthogonalConstraint, completeMeasure2D]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (measure2DMode) {
      const drawingCoord = screenToDrawing(screenX, screenY);

      // Find snap point and update
      const snapPoint = findSnapPoint(drawingCoord);
      setMeasure2DSnapPoint(snapPoint);

      if (measure2DStart) {
        // If measuring, update current point
        let currentPoint = snapPoint || drawingCoord;

        // Apply orthogonal constraint if shift is held
        if (measure2DShiftLocked && measure2DLockedAxis) {
          currentPoint = applyOrthogonalConstraint(measure2DStart, currentPoint, measure2DLockedAxis);
        }

        setMeasure2DCurrent(currentPoint);
      }
    } else if (isPanning.current) {
      // Pan mode
      const dx = e.clientX - lastPanPoint.current.x;
      const dy = e.clientY - lastPanPoint.current.y;
      lastPanPoint.current = { x: e.clientX, y: e.clientY };
      setViewTransform((prev) => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy,
      }));
    }
  }, [measure2DMode, measure2DStart, measure2DShiftLocked, measure2DLockedAxis, screenToDrawing, findSnapPoint, setMeasure2DSnapPoint, setMeasure2DCurrent, applyOrthogonalConstraint]);

  // Releasing the button ends nothing: the measurement is closed by the SECOND
  // CLICK, so a release between the two is just the first click finishing.
  const handleMouseUp = useCallback(() => {
    isMouseButtonDown.current = false;
    isPanning.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isMouseInsidePanel.current = false;
    // Don't cancel if button is still down - user might re-enter
    // Cancel will happen on global mouseup if released outside
    isPanning.current = false;
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    isMouseInsidePanel.current = true;
    // If re-entering with button down and measurement started, resume tracking
    if (measure2DMode && measure2DStart) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const drawingCoord = screenToDrawing(screenX, screenY);
        const snapPoint = findSnapPoint(drawingCoord);
        const currentPoint = snapPoint || drawingCoord;
        setMeasure2DCurrent(currentPoint);
      }
    }
  }, [measure2DMode, measure2DStart, screenToDrawing, findSnapPoint, setMeasure2DCurrent]);

  return {
    screenToDrawing,
    findSnapPoint,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleMouseEnter,
  };
}

export default useMeasure2D;
