/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Write `demo-plan.dxf` — the drawing strand 1 traces over.
 *
 * A stand-in for what an architect sends when there is no model. It is
 * generated rather than drawn so the geometry the clip traces and the geometry
 * under it are the same numbers, stated once: `WALL_AXES` below is also what
 * the clip's `addWall` beats use. A real project plan can replace the file
 * without touching code; the clip's coordinates then move to match it.
 *
 * # Why the drawing carries far more than walls
 * The point of the strand is that tracing is a CHOICE: a plan is full of
 * things that must not become building elements — furniture, dimension lines,
 * room stamps, a grid. A drawing containing only wall axes would make the
 * tracing look like an import, and the clip would lose the one thing it has to
 * show. So the file ships five layers and the clip only ever touches one.
 *
 * Run:  node tools/screenflow/make-demo-plan.mjs
 *
 * DXF R12 with a HEADER that declares metres ($INSUNITS 6). Without it the
 * importer assumes millimetres and the plan lands a thousand times too big.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The only layer the clip traces. Door openings are the gaps. */
const WALL_AXES = [
  // Outer shell, 12 x 8 m.
  [[0, 0], [12, 0]],
  [[12, 0], [12, 8]],
  [[12, 8], [0, 8]],
  [[0, 8], [0, 0]],
  // Two dividers make three rooms; each is broken by a door opening.
  [[4.5, 0], [4.5, 3.5]],
  [[4.5, 4.5], [4.5, 8]],
  [[8.5, 0], [8.5, 3.5]],
  [[8.5, 4.5], [8.5, 8]],
];

/** Furniture — drawn, never traced. */
const FURNITURE = [
  // Desks in room 1.
  ...box(0.6, 5.6, 1.6, 6.8),
  ...box(0.6, 3.9, 1.6, 5.1),
  // Meeting table in room 2.
  ...box(5.4, 3.0, 7.6, 5.0),
  // Shelving in room 3.
  ...box(11.2, 1.0, 11.8, 6.6),
];

/** Dimension lines with their witness ticks — drawn, never traced. */
const DIMENSIONS = [
  [[0, -1.2], [12, -1.2]],
  [[0, -1.4], [0, -1.0]],
  [[4.5, -1.4], [4.5, -1.0]],
  [[8.5, -1.4], [8.5, -1.0]],
  [[12, -1.4], [12, -1.0]],
  [[-1.2, 0], [-1.2, 8]],
  [[-1.4, 0], [-1.0, 0]],
  [[-1.4, 8], [-1.0, 8]],
];

/** Structural grid — drawn, never traced. */
const GRID = [
  [[-1.8, 0], [13.8, 0]],
  [[-1.8, 8], [13.8, 8]],
  [[0, -1.8], [0, 9.8]],
  [[12, -1.8], [12, 9.8]],
];

/** Room stamps and dimension figures. */
const LABELS = [
  { at: [1.6, 2.4], text: 'BUERO', height: 0.34 },
  { at: [1.6, 2.0], text: '36.0 m2', height: 0.24 },
  { at: [5.8, 6.2], text: 'SITZUNG', height: 0.34 },
  { at: [5.8, 5.8], text: '32.0 m2', height: 0.24 },
  { at: [9.4, 2.4], text: 'LAGER', height: 0.34 },
  { at: [9.4, 2.0], text: '28.0 m2', height: 0.24 },
  { at: [5.6, -1.6], text: '12.00', height: 0.28 },
  { at: [-2.4, 3.9], text: '8.00', height: 0.28 },
];

/** Axis-aligned rectangle as four line segments. */
function box(x1, y1, x2, y2) {
  return [
    [[x1, y1], [x2, y1]],
    [[x2, y1], [x2, y2]],
    [[x2, y2], [x1, y2]],
    [[x1, y2], [x1, y1]],
  ];
}

function line(layer, [[x1, y1], [x2, y2]]) {
  return ['0', 'LINE', '8', layer, '10', x1, '20', y1, '30', 0, '11', x2, '21', y2, '31', 0];
}

function text(layer, { at: [x, y], text: value, height }) {
  return ['0', 'TEXT', '8', layer, '10', x, '20', y, '30', 0, '40', height, '1', value];
}

const codes = [
  '0', 'SECTION', '2', 'HEADER',
  // 6 = metres. The importer warns and assumes millimetres without it.
  '9', '$INSUNITS', '70', 6,
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  ...WALL_AXES.flatMap((a) => line('WAENDE', a)),
  ...FURNITURE.flatMap((a) => line('MOEBEL', a)),
  ...DIMENSIONS.flatMap((a) => line('BEMASSUNG', a)),
  ...GRID.flatMap((a) => line('RASTER', a)),
  ...LABELS.flatMap((l) => text('BESCHRIFTUNG', l)),
  '0', 'ENDSEC',
  '0', 'EOF',
];

const out = fileURLToPath(new URL('../../apps/viewer/public/demo-local/demo-plan.dxf', import.meta.url));
writeFileSync(out, `${codes.join('\r\n')}\r\n`, 'utf8');
console.log(
  `wrote ${out}: ${WALL_AXES.length} wall axes on WAENDE, plus `
  + `${FURNITURE.length + DIMENSIONS.length + GRID.length} lines and ${LABELS.length} labels the clip never traces`,
);
