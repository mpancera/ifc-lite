/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The Auslösezonen-Umrandung has to be ON the sheet.
 *
 * It is the heaviest line a fire plan carries and the one the plan is read
 * for — a Feuerwehrlageplan without it is a floor plan. It was drawn on screen
 * and nowhere else, so the file that left the building did not carry the thing
 * it exists to show. That gap is invisible on screen, which is why it survived:
 * every check of it was a look at the canvas.
 */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import { useViewerStore } from '@/store';
import useDrawingExport from './useDrawingExport.js';
import type { PlanZoneOutline } from './usePlanZoneOutlines.js';
import {
  COMPARTMENT_LINE_WEIGHT_M, ZONE_LINE_WEIGHT_M,
} from '@/lib/zoneOutline/zoneLayers';

const ZONES: PlanZoneOutline[] = [
  {
    zoneId: 4711,
    name: 'Auslösezone Nord',
    themeId: 'fire-trigger',
    weightM: ZONE_LINE_WEIGHT_M,
    colour: '#1d4ed8',
    segments: [
      { a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { a: { x: 4, y: 0 }, b: { x: 4, y: 3 } },
    ],
    // One room, two triangles — the rectangle the boundary encloses.
    fills: [new Float32Array([0, 0, 4, 0, 4, 3, 0, 0, 4, 3, 0, 3])],
  },
  // No colour of its own: screen and sheet must fall back to the same red.
  { zoneId: 4712, name: 'Ohne Farbe', themeId: 'fire-trigger', weightM: ZONE_LINE_WEIGHT_M,
    colour: null, fills: [],
    segments: [{ a: { x: 0, y: 3 }, b: { x: 0, y: 0 } }] },
  // A Brandabschnitt: its own layer, drawn heavier, with its own fallback
  // colour so two unpainted layers do not merge into one red smear.
  { zoneId: 4713, name: 'Brandabschnitt A', themeId: 'fire-compartment',
    weightM: COMPARTMENT_LINE_WEIGHT_M,
    colour: null, fills: [],
    segments: [{ a: { x: 0, y: 0 }, b: { x: 0, y: 3 } }] },
];

function buildDrawing(): Drawing2D {
  return {
    config: { plane: { axis: 'z', position: 0, flipped: false }, projectionDepth: 10,
      includeHiddenLines: true, creaseAngle: 30, scale: 50 },
    lines: [],
    cutPolygons: [{
      polygon: { outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], holes: [] },
      entityId: 1, ifcType: 'IfcWall', modelIndex: 0, isCut: true,
    }],
    projectionPolygons: [],
    bounds: { min: { x: 0, y: 0 }, max: { x: 4, y: 3 } },
    stats: { cutLineCount: 0, projectionLineCount: 0, hiddenLineCount: 0,
      silhouetteLineCount: 0, polygonCount: 1, totalTriangles: 0, processingTimeMs: 0 },
  };
}

function Harness({ zones, onReady }: {
  zones: readonly PlanZoneOutline[] | undefined;
  onReady: (fn: () => void) => void;
}): null {
  const { handleExportSVG } = useDrawingExport({
    drawing: buildDrawing(),
    displayOptions: { showHiddenLines: true, scale: 50, showScanSection: false,
      scanSectionOpacity: 0, scanSectionIncludeInExport: false },
    sectionPlane: { axis: 'down', position: 0, flipped: false },
    activePresetId: null,
    entityColorMap: new Map(),
    overridesEnabled: false,
    overrideEngine: new GraphicOverrideEngine([]),
    measure2DResults: [],
    polygonArea2DResults: [],
    textAnnotations2D: [],
    cloudAnnotations2D: [],
    zoneOutlines: zones,
    sheetEnabled: false,
    activeSheet: null,
    dxfUnderlays: [],
    ifcDataStore: null,
    coordinateInfo: undefined,
    scanSection: { points: [] },
  });
  onReady(handleExportSVG);
  return null;
}

async function exportSvg(zones: readonly PlanZoneOutline[] | undefined): Promise<string> {
  useViewerStore.setState({ models: new Map() });
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | null = null;
  let exportFn: (() => void) | null = null;

  const originalCreate = URL.createObjectURL;
  let resolveSvg!: (blob: Blob) => void;
  const svgBlob = new Promise<Blob>((resolve) => { resolveSvg = resolve; });
  URL.createObjectURL = function (obj: Blob | MediaSource): string {
    if (obj instanceof Blob && obj.type === 'image/svg+xml') resolveSvg(obj);
    return originalCreate.call(URL, obj);
  };

  try {
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness zones={zones} onReady={(fn) => { exportFn = fn; }} />);
    });
    let blob: Blob | null = null;
    await act(async () => { exportFn!(); blob = await svgBlob; });
    return await (blob as unknown as Blob).text();
  } finally {
    URL.createObjectURL = originalCreate;
    if (root) await act(async () => { (root as Root).unmount(); });
    container.remove();
  }
}

describe('useDrawingExport — Auslösezonen on the exported sheet', () => {
  it('writes one path per zone, in the zone\'s own colour', async () => {
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(doc.querySelector('parsererror'), null, svg);

    const paths = [...doc.querySelectorAll('[data-zone-outline]')];
    assert.deepEqual(paths.map((p) => p.getAttribute('data-zone-outline')), ['4711', '4712', '4713']);
    assert.equal(paths[0].getAttribute('stroke'), '#1d4ed8');
  });

  it('falls back to the same red the screen uses for an unpainted zone', async () => {
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const second = doc.querySelector('[data-zone-outline="4712"]');
    assert.equal(second?.getAttribute('stroke'), '#dc2626');
  });

  it('draws the line at its real width — a boundary in the building, not on paper', async () => {
    // Metres, not paper millimetres: the line says how far the zone reaches,
    // so it grows with the building like a wall does.
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const first = doc.querySelector('[data-zone-outline="4711"]');
    assert.equal(Number(first?.getAttribute('stroke-width')), ZONE_LINE_WEIGHT_M);
  });

  it('carries every segment, so a boundary cut at a door stays cut', async () => {
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const d = doc.querySelector('[data-zone-outline="4711"]')?.getAttribute('d') ?? '';
    // Two moves: two separate runs of line, which is what an interruption is.
    assert.equal((d.match(/M /g) ?? []).length, 2);
  });

  it('tints the zone inside its own line, faintly enough to read through', async () => {
    // The colour answers "which zone" from across a room; the plan underneath
    // answers everything else, so the tint must not win that argument.
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const fill = doc.querySelector('[data-zone-fill="4711"]');
    assert.ok(fill, 'the zone with rooms is filled');
    assert.equal(fill?.getAttribute('fill'), '#1d4ed8');
    assert.ok(Number(fill?.getAttribute('fill-opacity')) <= 0.25);
    assert.equal(fill?.getAttribute('stroke'), 'none');
  });

  it('gives each layer its own weight and its own fallback colour', async () => {
    // A Brandabschnitt and a Meldezone are different statements and both
    // belong on the sheet. Drawn identically they read as one boundary drawn
    // twice — the reason the plan used to show only one of them.
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const compartment = doc.querySelector('[data-zone-outline="4713"]');

    assert.equal(compartment?.getAttribute('data-zone-theme'), 'fire-compartment');
    assert.equal(Number(compartment?.getAttribute('stroke-width')), COMPARTMENT_LINE_WEIGHT_M);
    // Not the detection zone's red: two unpainted layers must not merge.
    assert.equal(compartment?.getAttribute('stroke'), '#1d4ed8');
  });

  it('paints the rooms as ONE path, or every shared edge shows as a seam', async () => {
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(doc.querySelectorAll('[data-zone-fill="4711"]').length, 1);
    const d = doc.querySelector('[data-zone-fill="4711"]')?.getAttribute('d') ?? '';
    assert.equal((d.match(/Z/g) ?? []).length, 2, 'both triangles, one element');
    assert.equal(doc.querySelector('[data-zone-fill="4711"]')?.getAttribute('fill-rule'), 'nonzero');
  });

  it('writes no fill for a zone whose rooms are on another storey', async () => {
    const svg = await exportSvg(ZONES);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assert.equal(doc.querySelector('[data-zone-fill="4712"]'), null);
    assert.ok(doc.querySelector('[data-zone-outline="4712"]'), 'the line still stands');
  });

  it('writes no group at all when the zones are switched off', async () => {
    const svg = await exportSvg(undefined);
    assert.ok(!svg.includes('zone-outlines'));
    assert.ok(!svg.includes('data-zone-outline'));
  });
});
