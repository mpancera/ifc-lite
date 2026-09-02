/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Stage picture for units: a ruler. A length on paper (or in drawing units)
 * on top, the length it stands for in the building underneath, and where the
 * tool got that from. A wrong scale is the mistake that makes every later
 * number wrong by a factor, so this is the picture to look at twice.
 */

import type { UnitResolution } from '../types.js';
import type { StageVisual } from './stage-visual.js';
import { INK, LINE, MUTED, ROUTE_COLORS, badge, el, fmt, root, text } from './svg.js';

const SOURCE_TEXT: Record<UnitResolution['source'], string> = {
  insunits: 'declared in the DXF header ($INSUNITS)',
  calibration: 'measured by the user (two points and a known distance)',
  manual: 'set by the user',
  titleblock: 'read from the sheet',
  filename: 'read from the file name',
  estimated: 'estimated from the drawing extent',
  unknown: 'not found: the plan needs calibration',
};

const POINT_M = 0.0254 / 72;

export function renderScaleVisual(units: UnitResolution, fileName = ''): StageVisual {
  const width = 560;
  const height = 150;
  let body = text(16, 26, `Scale${fileName ? ` of ${fileName}` : ''}`, { size: 13, weight: 'bold' });
  const known = units.metresPerUnit > 0;
  const color = known ? (units.source === 'estimated' ? ROUTE_COLORS.raster : ROUTE_COLORS.vector) : ROUTE_COLORS.unavailable;

  const isPaper = units.source !== 'insunits' && units.source !== 'estimated';
  const denominator = units.scaleDenominator ?? (isPaper && known ? units.metresPerUnit / POINT_M : undefined);
  const headline = !known
    ? 'No scale'
    : isPaper
      ? `1:${fmt(denominator ?? 0, denominator && Number.isInteger(denominator) ? 0 : 1)}`
      : units.metresPerUnit >= 1
        ? `1 drawing unit = ${fmt(units.metresPerUnit, units.metresPerUnit === Math.floor(units.metresPerUnit) ? 0 : 3)} m`
        : `1 drawing unit = ${fmt(units.metresPerUnit * 1000, units.metresPerUnit >= 0.001 ? 0 : 3)} mm`;
  const b = badge(16, 40, headline, color, 12);
  body += b.svg;
  body += text(16 + b.width + 10, 55, SOURCE_TEXT[units.source], { size: 12, fill: MUTED });

  // Ruler: 100 mm on paper (or 1000 drawing units) as a 240 px bar with ticks.
  const rx = 16;
  const ry = 92;
  const rw = 240;
  body += el('rect', { x: rx, y: ry, width: rw, height: 10, fill: known ? color : LINE, 'fill-opacity': known ? 0.9 : 1 });
  for (let i = 0; i <= 10; i++) {
    body += el('line', { x1: rx + (rw * i) / 10, y1: ry - 4, x2: rx + (rw * i) / 10, y2: ry + 10, stroke: INK, 'stroke-width': i % 5 === 0 ? 1.5 : 0.8 });
  }
  if (isPaper) {
    body += text(rx, ry - 10, '100 mm on paper', { size: 11, fill: MUTED });
    const metres = known ? (units.metresPerUnit * 100) / (25.4 / 72) : 0;
    body += text(rx, ry + 28, known ? `= ${fmt(metres, metres >= 10 ? 1 : 2)} m in the building` : '= ? m in the building', { size: 12, weight: 'bold', fill: known ? INK : ROUTE_COLORS.unavailable });
  } else {
    // The ruler is always 10 m in the building; the drawing-unit count follows.
    const unitsForTenMetres = 10 / units.metresPerUnit;
    body += text(rx, ry - 10, `${fmt(unitsForTenMetres, Number.isInteger(unitsForTenMetres) ? 0 : 2)} drawing units`, { size: 11, fill: MUTED });
    body += text(rx, ry + 28, '= 10 m in the building', { size: 12, weight: 'bold' });
  }
  if (!known) body += text(rx + rw + 20, ry + 8, 'Calibrate with two points and a known distance.', { size: 12, fill: ROUTE_COLORS.unavailable });

  return {
    stage: 'units',
    title: known ? `Scale: ${headline}` : 'Scale: unknown',
    caption: known
      ? 'The ruler shows what a length on the sheet stands for in the building. If the plan is a 1:50 and the ruler says 1:100, every room will come out twice as large.'
      : 'No scale could be read. Until the plan is calibrated, no length from it can be trusted.',
    svg: root(width, height, body, `Scale: ${headline}`),
    width,
    height,
    facts: [
      { label: 'Scale', value: headline },
      { label: 'Source', value: SOURCE_TEXT[units.source] },
      { label: 'Metres per unit', value: known ? fmt(units.metresPerUnit, 6) : '—' },
    ],
  };
}
