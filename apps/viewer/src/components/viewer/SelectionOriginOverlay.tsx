/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A small XYZ triad on the selected element.
 *
 * # Why a triad and not just a highlight
 * The selection highlight answers "which one", and stops there. In a model
 * where the interesting elements are 15 cm devices on a ceiling, that is not
 * enough: a highlighted detector two rooms away and a highlighted detector
 * behind a wall look the same, and neither tells you which way it is turned.
 * A triad answers where and which way round, in the frame the model is
 * authored in, and it stays legible when the element itself is a few pixels.
 *
 * # Why it sits over the canvas rather than in the scene
 * Same reason as `BasepointOverlay`, whose projection loop this follows: an
 * SVG marker keeps a constant size on screen, so it reads at any zoom, while
 * a triad drawn in the scene would vanish as you pull back — exactly when you
 * most need to know where the thing is. It also needs no renderer change.
 *
 * # Why it polls on an animation frame
 * The WebGPU renderer exposes no camera-change event to subscribe to. The
 * marker's position is recomputed per frame and written straight into the SVG,
 * never through React state — a re-render per frame for one marker would cost
 * more than the projection does.
 */

import { useEffect, useRef, useState } from 'react';
import { useViewerStore } from '@/store';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { useIfc } from '@/hooks/useIfc';
import { getEntityBounds } from '@/utils/viewportUtils';
import { fromGlobalIdFromModels } from '@/store/globalId';
import type { Renderer } from '@ifc-lite/renderer';

/** Arm length in CSS pixels — long enough to read, short enough not to clutter. */
const ARM = 16;

export function SelectionOriginOverlay() {
  const enabled = useViewerStore((s) => s.showSelectionOrigin);
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const models = useViewerStore((s) => s.models);
  const { geometryResult } = useIfc();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  /** The point to mark, in renderer world metres. Null when nothing qualifies. */
  const pointRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const [version, setVersion] = useState(0);

  // The centre of the selected element's own geometry. Recomputed only when the
  // selection or the geometry changes — not per frame, where it would re-scan
  // every mesh in the model sixty times a second.
  useEffect(() => {
    if (!enabled || selectedEntityId === null) {
      pointRef.current = null;
      setVersion((v) => v + 1);
      return;
    }
    const local = fromGlobalIdFromModels(models, selectedEntityId);
    const expressId = local?.expressId ?? selectedEntityId;
    const bounds = getEntityBounds(geometryResult?.meshes ?? null, expressId);
    // No geometry is a normal answer — a selected IfcZone or a property-only
    // entity has none. Drawing nothing says that better than a marker at the
    // origin would.
    pointRef.current = bounds
      ? {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: (bounds.min.z + bounds.max.z) / 2,
      }
      : null;
    setVersion((v) => v + 1);
  }, [enabled, selectedEntityId, models, geometryResult]);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    const renderer = getGlobalRenderer();
    if (!renderer) return;
    const canvas = container.closest('[data-viewport]')?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    rendererRef.current = renderer;
    canvasRef.current = canvas;

    function paint() {
      const r = rendererRef.current;
      const cv = canvasRef.current;
      const svg = svgRef.current;
      const point = pointRef.current;
      if (!r || !cv || !svg) {
        rafRef.current = requestAnimationFrame(paint);
        return;
      }
      if (!point) {
        if (svg.innerHTML !== '') svg.innerHTML = '';
        rafRef.current = requestAnimationFrame(paint);
        return;
      }
      const screen = r.getCamera().projectToScreen(point, cv.clientWidth, cv.clientHeight);
      if (!screen) {
        // Behind the camera. Clearing is the honest answer; leaving the last
        // position up would put a marker on an element that is not there.
        if (svg.innerHTML !== '') svg.innerHTML = '';
        rafRef.current = requestAnimationFrame(paint);
        return;
      }
      const cx = Math.round(screen.x);
      const cy = Math.round(screen.y);
      // The same axis convention BasepointOverlay uses, so two markers on one
      // screen cannot mean different things: X right, Y up (screen up is -y),
      // Z toward the viewer as a 45-degree stub. Every stroke carries a white
      // casing — over a pale wall a thin coloured line is invisible.
      svg.innerHTML = `
        <g transform="translate(${cx} ${cy})" stroke-linecap="round">
          <g stroke="#ffffff" stroke-width="4.5" opacity="0.9">
            <line x1="0" y1="0" x2="${ARM}" y2="0" />
            <line x1="0" y1="0" x2="0" y2="${-ARM}" />
            <line x1="0" y1="0" x2="${-ARM * 0.7}" y2="${ARM * 0.7}" />
          </g>
          <line x1="0" y1="0" x2="${ARM}" y2="0" stroke="#ef4444" stroke-width="2" />
          <line x1="0" y1="0" x2="0" y2="${-ARM}" stroke="#22c55e" stroke-width="2" />
          <line x1="0" y1="0" x2="${-ARM * 0.7}" y2="${ARM * 0.7}" stroke="#3b82f6" stroke-width="2" />
          <circle cx="0" cy="0" r="3" fill="#ffffff" stroke="#18181b" stroke-width="1.5" />
        </g>
      `;
      rafRef.current = requestAnimationFrame(paint);
    }

    rafRef.current = requestAnimationFrame(paint);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  // `version` is here to re-attach after the point changes; the paint loop
  // reads the point from a ref, so nothing else belongs in this list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, version]);

  if (!enabled) return null;
  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-30">
      <svg ref={svgRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
