/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The cable being drawn, over the 3D view.
 *
 * # Projected per frame, derived per pick
 * The world points come from the picked devices' bounds and change only when
 * the sequence does; the screen positions change whenever the camera moves.
 * Splitting the two is what keeps an orbit at frame rate with a forty-device
 * run on screen — the same split `SectionVisualization` makes for its preview
 * quad, and for the same reason.
 *
 * # The number is on the device, not on the segment
 * A cable's segments are between things; the position on the run belongs to
 * the device. Labelling segments would number the gaps, which is one off from
 * what anybody reading a detector list expects.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewerStore } from '@/store';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { getEntityCenter } from '@/utils/viewportUtils';
import { toGlobalIdFromModels } from '@/store/globalId';
import { wiringPath, type ScreenPoint } from './wiringPath';

/** Colour of the drawn run. Amber: a draft, not a committed edge. */
const CABLE = '#f59e0b';

export function WiringOverlay() {
  const sequence = useViewerStore((s) => s.wiringSequence);
  const ring = useViewerStore((s) => s.wiringRing);
  const hover = useViewerStore((s) => s.wiringHover);
  const models = useViewerStore((s) => s.models);
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const geometryResult = useViewerStore((s) => s.geometryResult);

  const [screen, setScreen] = useState<ScreenPoint[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const rafRef = useRef(0);

  /**
   * A world point per picked device, in the order they were clicked.
   *
   * A device with no mesh is skipped rather than drawn at the origin — a
   * cable that dives to (0,0,0) and back is worse than a cable with a gap in
   * it, and the gap is honest about what could not be found.
   */
  const worldPoints = useMemo(() => {
    if (!activeModelId) return [];
    const meshes = models.get(activeModelId)?.geometryResult?.meshes ?? geometryResult?.meshes ?? null;
    const ordered = [...sequence, ...(hover !== null && !sequence.includes(hover) ? [hover] : [])];
    const points: Array<{ id: number; p: { x: number; y: number; z: number } }> = [];
    for (const id of ordered) {
      const centre = getEntityCenter(meshes, toGlobalIdFromModels(models, activeModelId, id));
      if (centre) points.push({ id, p: centre });
    }
    // The return leg of a ring closes on the first device, so its point is
    // repeated. Repeating the POINT rather than the id keeps the numbering
    // (which walks the sequence) untouched.
    if (ring && points.length > 1) points.push({ id: points[0].id, p: points[0].p });
    return points;
  }, [sequence, hover, ring, models, activeModelId, geometryResult]);

  useEffect(() => {
    if (worldPoints.length === 0) {
      setScreen([]);
      return;
    }
    const project = () => {
      const renderer = getGlobalRenderer();
      const camera = renderer?.getCamera();
      const canvas = renderer?.getCanvas();
      if (camera && canvas) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const next: ScreenPoint[] = [];
        for (const { p } of worldPoints) {
          const s = camera.projectToScreen({ x: p.x, y: p.y, z: p.z }, w, h);
          // A point behind the camera projects to nothing. Ending the run
          // there is right — the rest of it is not on screen either.
          if (!s) break;
          next.push({ x: s.x, y: s.y });
        }
        setScreen(next);
        setSize({ w, h });
      }
      rafRef.current = requestAnimationFrame(project);
    };
    rafRef.current = requestAnimationFrame(project);
    return () => cancelAnimationFrame(rafRef.current);
  }, [worldPoints]);

  if (screen.length === 0 || size.w === 0) return null;

  // The hover point is a preview, not a pick: it is drawn dashed so the run so
  // far and the step being considered never read as the same commitment.
  const committed = ring ? screen : screen.slice(0, sequence.length);
  const previewFrom = committed[committed.length - 1];
  const previewTo = !ring && screen.length > sequence.length ? screen[screen.length - 1] : null;

  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={size.w}
      height={size.h}
      aria-hidden
    >
      <path
        d={wiringPath(committed)}
        fill="none"
        stroke={CABLE}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {previewFrom && previewTo && (
        <path
          d={wiringPath([previewFrom, previewTo])}
          fill="none"
          stroke={CABLE}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          opacity={0.7}
        />
      )}
      {screen.slice(0, sequence.length).map((point, at) => (
        <g key={sequence[at]}>
          <circle cx={point.x} cy={point.y} r={9} fill="white" stroke={CABLE} strokeWidth={1.5} />
          <text
            x={point.x}
            y={point.y + 3.5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill={CABLE}
          >
            {/* The head of the run is the controller and carries no position:
                it is where the cable starts, not the first thing on it. */}
            {at === 0 ? '⌂' : at}
          </text>
        </g>
      ))}
    </svg>
  );
}
