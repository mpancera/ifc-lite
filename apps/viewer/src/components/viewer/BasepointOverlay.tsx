/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BasepointOverlay — renders a small XYZ triad + label at the viewer-space
 * position of each loaded model's IFC (0,0,0) point.
 *
 * Helps users diagnose federation alignment problems by showing where each
 * model THINKS its origin is in the displayed scene. For a correctly
 * federated set with shared CRS, the origins land at distinct points spaced
 * by their (eastings, northings, orthogonalHeight) differences. When the
 * pipeline collapses everything onto one point, you'll see all the markers
 * stacked.
 *
 * Origins are derived from each model's IfcMapConversion + the anchor's
 * MapConversion via `computeIfcOriginViewerPosition` — independent of any
 * vertex-baked alignment, so it stays correct after re-aligns and across
 * cross-CRS reprojections.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewerStore } from '@/store';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { useModelOrigins, type ModelOrigin } from '@/hooks/useModelOrigins';
import type { FederatedModel } from '@/store/types';
import type { Renderer } from '@ifc-lite/renderer';


const STATUS_COLOURS: Record<NonNullable<FederatedModel['federationAlignmentStatus']> | 'none', { stroke: string; fill: string }> = {
  anchor:      { stroke: '#f59e0b', fill: '#fef3c7' }, // amber
  'same-crs':  { stroke: '#10b981', fill: '#d1fae5' }, // emerald
  reprojected: { stroke: '#10b981', fill: '#d1fae5' }, // emerald
  identity:    { stroke: '#10b981', fill: '#d1fae5' }, // emerald
  failed:      { stroke: '#ef4444', fill: '#fee2e2' }, // red
  none:        { stroke: '#a1a1aa', fill: '#f4f4f5' }, // zinc
};

export function BasepointOverlay() {
  const showModelBasepoints = useViewerStore((s) => s.showModelBasepoints);
  const models = useViewerStore((s) => s.models);
  const anchorModelIdOverride = useViewerStore((s) => s.anchorModelIdOverride);
  const georefMutations = useViewerStore((s) => s.georefMutations);
  // Re-derive origins when any georef edit lands.
  useViewerStore((s) => s.mutationVersion);

  // Cached origin world positions in viewer Y-up space; rebuilt only when the
  // upstream georef data changes, NOT every camera frame.
  const dotsRef = useRef<ModelOrigin[]>([]);
  const [version, setVersion] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Where each model thinks its origin is. Shared with the plan's origin
  // marker so the two views cannot disagree about the very thing this is for.
  const origins = useModelOrigins(showModelBasepoints);
  useEffect(() => {
    dotsRef.current = origins;
    setVersion((v) => v + 1);
  }, [origins]);

  // Lazy renderer/canvas lookup + per-frame projection. We poll on RAF
  // (matching BCFOverlay) since the WebGPU renderer doesn't expose a
  // camera-change event we can subscribe to from React.
  useEffect(() => {
    if (!showModelBasepoints) return;
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
      if (!r || !cv || !svg) {
        rafRef.current = requestAnimationFrame(paint);
        return;
      }
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      const camera = r.getCamera();
      // Build the SVG content procedurally to avoid React re-renders on every
      // frame. Each dot is a triad + label + circle.
      const fragments: string[] = [];
      for (const dot of dotsRef.current) {
        const screen = camera.projectToScreen(dot.viewer, w, h);
        if (!screen) continue;
        const colours = STATUS_COLOURS[dot.status ?? 'none'];
        const cx = Math.round(screen.x);
        const cy = Math.round(screen.y);
        // Axes: 12px arms in viewer-Y-up screen space. X right, Y up (screen
        // up = -y), Z toward viewer (approximated as 45° offset on screen for
        // a clear distinction from X/Y).
        fragments.push(`
          <g transform="translate(${cx} ${cy})">
            <line x1="0" y1="0" x2="12" y2="0" stroke="#ef4444" stroke-width="2" />
            <line x1="0" y1="0" x2="0" y2="-12" stroke="#22c55e" stroke-width="2" />
            <line x1="0" y1="0" x2="-8" y2="8" stroke="#3b82f6" stroke-width="2" />
            <circle cx="0" cy="0" r="3.5" fill="${colours.fill}" stroke="${colours.stroke}" stroke-width="1.5" />
            <text x="14" y="-6" font-family="ui-monospace, monospace" font-size="10" fill="${colours.stroke}" stroke="white" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${escapeXml(dot.modelName)}</text>
          </g>
        `);
      }
      svg.innerHTML = fragments.join('');
      rafRef.current = requestAnimationFrame(paint);
    }

    rafRef.current = requestAnimationFrame(paint);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModelBasepoints, version]);

  if (!showModelBasepoints) return null;
  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none z-30">
      <svg ref={svgRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
