/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Device marks, drawn over the plan.
 *
 * # The drawn symbol first, the family glyph as a fallback
 * A fire plan is read off its symbols, and which symbol a class gets is
 * decided in the symbol catalogue, not here — a smoke detector and a heat
 * detector are the same "sensor" to this module and two different pictures on
 * the drawing. So the catalogue is asked first, by Fachklasse, and the built-in
 * family glyph (circle, triangle, …) only stands in where no drawing exists
 * yet. That keeps a model with no catalogue readable instead of blank.
 *
 * The drawings arrive as SVG text in a `-5 -5 10 10` viewBox and are placed as
 * `<image>` with a data URI rather than inlined: a plan puts the same symbol
 * down a hundred times, and a hundred inlined copies of one drawing means a
 * hundred sets of colliding element ids. One data URI per distinct symbol,
 * reused.
 *
 * # Fixed on screen, like the labels and unlike the swings
 * A swing arc is real geometry and grows with the zoom, because it describes
 * the space a door needs. A device mark describes nothing about size — it is
 * there to be SEEN, and one that shrank with the zoom would vanish exactly
 * when the plan got busy enough to need it (#50).
 *
 * The mark turns with nothing: a circle has no orientation, and the shapes
 * that do are read more easily upright than laid over. Same rule as the
 * labels.
 */

import React, { useMemo } from 'react';
import {
  deviceMarkPaths, DEVICE_MARK_SCREEN_PX, type DeviceMark,
} from '@/lib/plan/deviceSymbols';
import { symbolDrawingFor } from '@/lib/symbolCatalog/symbolCatalog';
import { useSymbolCatalog } from '@/lib/symbolCatalog/useSymbolCatalog';

export interface PlanDeviceMarksProps {
  marks: readonly DeviceMark[];
  /** The transform the canvas paints with — the same one, or the marks drift. */
  transform: { x: number; y: number; scale: number; rotation: number };
  /**
   * Whether to print each device's name beside its symbol.
   *
   * On by default: the Melderkennzeichen is the whole point of numbering, and
   * a symbol without it cannot be matched to the row on the panel.
   */
  showNames?: boolean;
}

/** The catalogue's drawings are `-5 -5 10 10`; a mark spans twice its px size. */
const SYMBOL_VIEWBOX_SPAN = 10;

export function PlanDeviceMarks({
  marks, transform, showNames = true,
}: PlanDeviceMarksProps): React.ReactElement | null {
  const catalog = useSymbolCatalog();

  /**
   * One data URI per distinct Fachklasse on this storey.
   *
   * Keyed by the class rather than by the mark: fifty detectors of one type
   * share one encoded drawing, and encoding it fifty times per repaint is the
   * kind of cost that only shows up on a real building.
   */
  const drawingFor = useMemo(() => {
    const cache = new Map<string, string | null>();
    return (mark: DeviceMark): string | null => {
      const key = `${mark.ifcType}|${mark.predefinedType ?? ''}|${mark.objectType ?? ''}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const svg = symbolDrawingFor(catalog, mark.ifcType, {
        predefinedType: mark.predefinedType,
        objectType: mark.objectType,
      });
      const uri = svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;
      cache.set(key, uri);
      return uri;
    };
  }, [catalog]);

  if (marks.length === 0) return null;

  const { x: tx, y: ty, scale, rotation } = transform;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const size = DEVICE_MARK_SCREEN_PX;

  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none" data-plan-device-marks>
      {marks.map((mark) => {
        const sx = mark.position.x * scale;
        const sy = mark.position.y * scale;
        const x = sx * cos - sy * sin + tx;
        const y = sx * sin + sy * cos + ty;
        const title = mark.name ? `${mark.name} — ${mark.ifcType}` : `${mark.ifcType} #${mark.expressId}`;
        const drawing = drawingFor(mark);

        let symbol: React.ReactElement;
        if (drawing) {
          symbol = (
            <image
              href={drawing}
              x={x - size}
              y={y - size}
              width={size * 2}
              height={size * 2}
              // The drawing is authored in its own box; scaling it to the same
              // span as the family glyph keeps a plan mixing both legible.
              preserveAspectRatio="xMidYMid meet"
              data-symbol-span={SYMBOL_VIEWBOX_SPAN}
            />
          );
        } else {
          let d = '';
          for (const path of deviceMarkPaths(mark.kind)) {
            path.forEach((p, i) => {
              const px = x + p.x * size;
              const py = y + p.y * size;
              d += `${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)} `;
            });
          }
          symbol = (
            <path
              d={d.trim()}
              // Filled white behind the stroke so a mark on a hatched wall or a
              // shaded room stays a mark rather than becoming part of it.
              className="fill-white dark:fill-zinc-950 stroke-zinc-800 dark:stroke-zinc-200"
              strokeWidth={1.2}
            />
          );
        }

        return (
          <g
            key={mark.key}
            data-plan-device-mark={mark.expressId}
            data-device-kind={mark.kind}
          >
            <title>{title}</title>
            {symbol}
            {showNames && mark.name && (
              <text
                x={x + size + 3}
                y={y}
                dominantBaseline="central"
                fontSize={10}
                // Painted twice: a stroke of the background colour under the
                // fill, so the mark stays readable over a hatched wall without
                // a box that would hide the drawing underneath.
                className="fill-zinc-800 dark:fill-zinc-100 stroke-white dark:stroke-zinc-950"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                {mark.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default PlanDeviceMarks;
