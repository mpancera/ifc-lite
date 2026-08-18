/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback } from 'react';
import { posthog } from '@/lib/analytics';
import { rotatedBounds } from '@/lib/plan/planRotation';
import { labelVisible, type PlanLabel } from '@/lib/plan/roomLabels';
import type { SymbolLine } from '@/lib/plan/openingSymbols';
import { deviceMarkPaths, DEVICE_MARK_PAPER_MM, type DeviceMark } from '@/lib/plan/deviceSymbols';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import {
  GraphicOverrideEngine,
  renderFrame,
  renderTitleBlock,
  calculateDrawingTransform,
  exportToDXF,
  type DXFPlanText,
  type DXFRoomPolygon,
  type Drawing2D,
  type DrawingSheet,
  type ElementData,
  type TitleBlockExtras,
} from '@ifc-lite/drawing-2d';
import { getFillColorForType } from '@/components/viewer/Drawing2DCanvas';
import { formatDistance } from '@/components/viewer/tools/formatDistance';
import { formatArea, computePolygonCentroid } from '@/components/viewer/tools/computePolygonArea';
import { generateCloudSVGPath } from '@/components/viewer/tools/cloudPathGenerator';
import type { PolygonArea2DResult, TextAnnotation2D, CloudAnnotation2D } from '@/store/slices/drawing2DSlice';
import type { DxfUnderlayRenderData } from '@/hooks/useDxfUnderlay';
import type { GeometryResult } from '@ifc-lite/geometry';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { buildDxfExportTransform, resolveDxfExportGeoreference } from '@/hooks/dxfExportGeoref';
import { DEFAULT_SCAN_SVG_CAP, type ScanBandPoint } from '@/hooks/scanSectionMath';

/** Module-level so the default parameters keep a stable identity across renders. */
const EMPTY_PLAN_LABELS: readonly PlanLabel[] = [];
const EMPTY_OPENING_SYMBOLS: readonly { readonly lines: readonly SymbolLine[] }[] = [];
const EMPTY_DEVICE_MARKS: readonly DeviceMark[] = [];

/** Map a DXF vertical justification onto an SVG dominant-baseline. */
function dxfValignToBaseline(valign: 'baseline' | 'bottom' | 'middle' | 'top'): string {
  switch (valign) {
    case 'bottom': return 'text-after-edge';
    case 'middle': return 'central';
    case 'top': return 'text-before-edge';
    default: return 'alphabetic';
  }
}

/**
 * Render DXF reference underlays as an SVG group (issue #1782). Geometry
 * arrives pre-mapped to drawing space (render-frame shift, flipped-section
 * mirror, and user placement applied by useDxfUnderlaysForDrawing — plan
 * sections only); `mapPoint` converts a drawing-space point into the
 * export's coordinate system (identity for the direct export, paper mm for
 * the sheet export). `strokeWidthForMm` and `fontScale` are in export units.
 */
function buildDxfUnderlaySvg(
  underlays: readonly DxfUnderlayRenderData[],
  mapPoint: (x: number, y: number) => { x: number; y: number },
  strokeWidthForMm: (mm: number) => number,
  fontScale: number,
  escapeXml: (s: string) => string,
  /** Plan rotation in degrees, so underlay labels stay upright inside it. */
  uprightDeg = 0,
): string {
  const visibleUnderlays = underlays.filter((u) => u.opacity > 0);
  if (visibleUnderlays.length === 0) return '';

  let svg = '  <g id="dxf-underlays">\n';
  for (const data of visibleUnderlays) {
    svg += `    <g data-dxf-underlay="${escapeXml(data.id)}" opacity="${data.opacity.toFixed(2)}">\n`;

    for (const fill of data.fills) {
      let d = '';
      for (const ring of fill.loops) {
        if (ring.length < 3) continue;
        const first = mapPoint(ring[0].x, ring[0].y);
        d += `${d ? ' ' : ''}M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
        for (let i = 1; i < ring.length; i++) {
          const p = mapPoint(ring[i].x, ring[i].y);
          d += ` L ${p.x.toFixed(4)} ${p.y.toFixed(4)}`;
        }
        d += ' Z';
      }
      if (!d) continue;
      svg += `      <path d="${d}" fill="${fill.color}" fill-opacity="${fill.pattern ? 0.25 : 1}" fill-rule="evenodd" stroke="none"/>\n`;
    }

    for (const line of data.lines) {
      if (line.points.length < 2) continue;
      const pts = line.points.map((p) => mapPoint(p.x, p.y));
      const pointsAttr = pts.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ');
      const tag = line.closed ? 'polygon' : 'polyline';
      const strokeWidth = strokeWidthForMm(line.widthMm ?? 0.18);
      const dash = line.dashed ? ` stroke-dasharray="${(strokeWidth * 6).toFixed(4)} ${(strokeWidth * 4).toFixed(4)}"` : '';
      svg += `      <${tag} points="${pointsAttr}" fill="none" stroke="${line.color}" stroke-width="${strokeWidth.toFixed(4)}" stroke-linecap="round"${dash}/>\n`;
    }

    for (const text of data.texts) {
      const anchor = mapPoint(text.x, text.y);
      const tip = mapPoint(text.x + text.dirX, text.y + text.dirY);
      const angle = (Math.atan2(tip.y - anchor.y, tip.x - anchor.x) * 180) / Math.PI;
      const fontSize = text.height * fontScale;
      if (fontSize <= 0) continue;
      const anchorAttr = text.align === 'center' ? 'middle' : text.align === 'right' ? 'end' : 'start';
      // Multiline MTEXT stacks with tspans, matching the canvas layout.
      const content = text.text
        .split('\n')
        .map((line, i) => `<tspan x="${anchor.x.toFixed(4)}" dy="${i === 0 ? 0 : (fontSize * 1.3).toFixed(4)}">${escapeXml(line)}</tspan>`)
        .join('');
      svg += `      <text x="${anchor.x.toFixed(4)}" y="${anchor.y.toFixed(4)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(4)}" fill="${text.color}" text-anchor="${anchorAttr}" dominant-baseline="${dxfValignToBaseline(text.valign)}" transform="rotate(${angle.toFixed(2)} ${anchor.x.toFixed(4)} ${anchor.y.toFixed(4)})">${content}</text>\n`;
    }

    svg += '    </g>\n';
  }
  svg += '  </g>\n';
  return svg;
}

/**
 * Render the point-cloud scan overlay as SVG circles (issue #1805), capped
 * hard at `DEFAULT_SCAN_SVG_CAP` (independent of, and typically tighter
 * than, the on-screen render cap) so an exported file stays a sane size —
 * a deterministic stride, same technique `selectScanBand` uses for the
 * render cap, keeps the exported subset reproducible.
 */
function buildScanSectionSvg(
  points: readonly ScanBandPoint[],
  mapPoint: (x: number, y: number) => { x: number; y: number },
  radiusModelUnits: number,
  opacity: number,
  cap: number = DEFAULT_SCAN_SVG_CAP,
): string {
  if (points.length === 0 || opacity <= 0) return '';
  const stride = points.length > cap ? Math.ceil(points.length / cap) : 1;
  let svg = `  <g id="scan-section" opacity="${opacity.toFixed(2)}">\n`;
  for (let i = 0; i < points.length; i += stride) {
    const p = mapPoint(points[i].point.x, points[i].point.y);
    const color = points[i].color;
    const fill = color
      ? `#${color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
      : '#8a8a8a';
    svg += `    <circle cx="${p.x.toFixed(4)}" cy="${p.y.toFixed(4)}" r="${radiusModelUnits.toFixed(4)}" fill="${fill}" stroke="none"/>\n`;
  }
  svg += '  </g>\n';
  return svg;
}

interface UseDrawingExportParams {
  drawing: Drawing2D | null;
  displayOptions: {
    showHiddenLines: boolean;
    scale: number;
    showScanSection: boolean;
    scanSectionOpacity: number;
    scanSectionIncludeInExport: boolean;
  };
  sectionPlane: { axis: 'down' | 'front' | 'side'; position: number; flipped: boolean; custom?: unknown };
  activePresetId: string | null;
  entityColorMap: Map<number, [number, number, number, number]>;
  overridesEnabled: boolean;
  overrideEngine: GraphicOverrideEngine;
  measure2DResults: Array<{ id: string; start: { x: number; y: number }; end: { x: number; y: number }; distance: number }>;
  polygonArea2DResults: PolygonArea2DResult[];
  textAnnotations2D: TextAnnotation2D[];
  cloudAnnotations2D: CloudAnnotation2D[];
  /**
   * Room names + areas, already in drawing space (#50). Plan mode supplies
   * them; the 2D Section panel passes none, because a section has no floor to
   * name rooms on.
   */
  planLabels?: readonly PlanLabel[];
  /**
   * Derived door swings and window sashes, already in drawing space (#50).
   * Plan mode only, for the same reason as the room labels: a swing arc is a
   * plan convention that means nothing on a vertical section.
   */
  openingSymbols?: readonly { readonly lines: readonly SymbolLine[] }[];
  /**
   * Small devices as marks (#50). Plan mode only — a section has no storey to
   * take them from, and they are not in the cut to begin with.
   */
  deviceMarks?: readonly DeviceMark[];
  sheetEnabled: boolean;
  activeSheet: DrawingSheet | null;
  /** DXF underlays pre-mapped to drawing space, rendered beneath the drawing (issue #1782) */
  dxfUnderlays: readonly DxfUnderlayRenderData[];
  /** Legacy single-model data store — the anchor-selection fallback for the DXF georeference lookup (issue #1861); federated models come from the store's `models` map. */
  ifcDataStore: IfcDataStore | null;
  /** Geometry coordinate info (RTC offset + origin shift), for the DXF world-coordinate re-derivation (issue #1861). */
  coordinateInfo: GeometryResult['coordinateInfo'] | undefined;
  /** Point-cloud scan overlay, already in drawing space (issue #1805) */
  scanSection: { points: readonly ScanBandPoint[] };
  /**
   * Plan view rotation in radians, so SVG and PDF export the plan as it is
   * shown. The DXF export deliberately ignores it and keeps world
   * coordinates, so the file opens square for whoever receives it.
   */
  viewRotation?: number;
}

interface UseDrawingExportResult {
  formatDistance: (distance: number) => string;
  handleExportSVG: () => void;
  handleExportDXF: () => void;
  handlePrint: () => void;
}

function useDrawingExport({
  drawing,
  displayOptions,
  sectionPlane,
  activePresetId,
  entityColorMap,
  overridesEnabled,
  overrideEngine,
  measure2DResults,
  polygonArea2DResults,
  textAnnotations2D,
  cloudAnnotations2D,
  planLabels = EMPTY_PLAN_LABELS,
  openingSymbols = EMPTY_OPENING_SYMBOLS,
  deviceMarks = EMPTY_DEVICE_MARKS,
  sheetEnabled,
  activeSheet,
  dxfUnderlays,
  ifcDataStore,
  coordinateInfo,
  scanSection,
  viewRotation = 0,
}: UseDrawingExportParams): UseDrawingExportResult {
  // Georef inputs for the DXF export (PR #1871 review, P1): placement edits
  // applied in CesiumPlacementEditor live in `georefMutations` (per model
  // id), not in `ifcDataStore`, and in a federation the georef frame is the
  // ANCHOR model's, not necessarily the legacy store's. Subscribe to the
  // same store fields ViewportContainer's Cesium georef memo reads so
  // `resolveDxfExportGeoreference` sees the identical inputs.
  const storeModels = useViewerStore((s) => s.models);
  const anchorModelIdOverride = useViewerStore((s) => s.anchorModelIdOverride);
  const georefMutations = useViewerStore((s) => s.georefMutations);
  // Georef edits replace the map, but subscribe to mutationVersion too so the
  // dependency is explicit (matches ViewportContainer / useAnchorGeoreference).
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  // Generate SVG that matches the canvas rendering exactly
  const generateExportSVG = useCallback((): string | null => {
    if (!drawing) return null;

    // The paper follows the screen: a plan turned for orthogonal work exports
    // turned, so what you approved is what gets printed. The DXF export does
    // NOT do this — it writes world coordinates, so the file opens square for
    // whoever receives it.
    const planRotation = sectionPlane.axis === 'down' ? (viewRotation ?? 0) : 0;
    const rotDeg = planRotation * (180 / Math.PI);
    // Measure the TURNED extent, or a turned plan is framed with its corners
    // cut off — same reason the on-screen fit does it.
    const bounds = rotatedBounds(drawing.bounds, planRotation);
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;

    // Add padding around the drawing
    const padding = Math.max(width, height) * 0.1;
    const viewMinX = bounds.min.x - padding;
    const viewMinY = bounds.min.y - padding;
    const viewWidth = width + padding * 2;
    const viewHeight = height + padding * 2;

    // SVG dimensions in mm (assuming model is in meters, scale 1:100)
    const scale = displayOptions.scale || 100;
    const svgWidthMm = (viewWidth * 1000) / scale;
    const svgHeightMm = (viewHeight * 1000) / scale;

    // Convert mm on paper to model units (meters)
    // At 1:100 scale, 1mm on paper = 0.1m in model space
    // Formula: modelUnits = paperMm * scale / 1000
    const mmToModel = (mm: number) => mm * scale / 1000;

    /**
     * Keeps a label upright inside the rotated group.
     *
     * The whole drawing sits in one `rotate(...)` group, which would tilt the
     * text with it. Counter-rotating each label about its OWN anchor undoes
     * exactly that and nothing else — positions turn, glyphs do not, matching
     * what the canvas does on screen.
     */
    const uprightText = (x: number, y: number): string =>
      rotDeg === 0 ? '' : ` transform="rotate(${(-rotDeg).toFixed(6)} ${x.toFixed(4)} ${y.toFixed(4)})"`;

    // Helper to escape XML
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // Axis-specific flipping (matching canvas rendering)
    // - 'down' (plan view): DON'T flip Y so north (Z+) is up
    // - 'front' and 'side': flip Y so height (Y+) is up
    // - 'side': also flip X to look from conventional direction
    const currentAxis = sectionPlane.axis;
    const flipY = currentAxis !== 'down';
    const flipX = currentAxis === 'side';

    // Helper to get polygon path with axis-specific coordinate transformation
    const polygonToPath = (polygon: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }): string => {
      const transformPt = (x: number, y: number) => ({
        x: flipX ? -x : x,
        y: flipY ? -y : y,
      });

      let path = '';
      if (polygon.outer.length > 0) {
        const first = transformPt(polygon.outer[0].x, polygon.outer[0].y);
        path += `M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
        for (let i = 1; i < polygon.outer.length; i++) {
          const pt = transformPt(polygon.outer[i].x, polygon.outer[i].y);
          path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
        }
        path += ' Z';
      }
      for (const hole of polygon.holes) {
        if (hole.length > 0) {
          const holeFirst = transformPt(hole[0].x, hole[0].y);
          path += ` M ${holeFirst.x.toFixed(4)} ${holeFirst.y.toFixed(4)}`;
          for (let i = 1; i < hole.length; i++) {
            const pt = transformPt(hole[i].x, hole[i].y);
            path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
          }
          path += ' Z';
        }
      }
      return path;
    };

    // Calculate viewBox with axis-specific flipping
    const viewBoxMinX = flipX ? -viewMinX - viewWidth : viewMinX;
    const viewBoxMinY = flipY ? -viewMinY - viewHeight : viewMinY;

    // Start building SVG
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${svgWidthMm.toFixed(2)}mm"
     height="${svgHeightMm.toFixed(2)}mm"
     viewBox="${viewBoxMinX.toFixed(4)} ${viewBoxMinY.toFixed(4)} ${viewWidth.toFixed(4)} ${viewHeight.toFixed(4)}">
  <rect x="${viewBoxMinX.toFixed(4)}" y="${viewBoxMinY.toFixed(4)}" width="${viewWidth.toFixed(4)}" height="${viewHeight.toFixed(4)}" fill="#FFFFFF"/>
${rotDeg !== 0 ? `  <g id="plan-rotation" transform="rotate(${rotDeg.toFixed(6)} 0 0)">
` : ''}`;

    // 0. DXF REFERENCE UNDERLAYS (issue #1782) - beneath everything. Data
    // exists only for plan ('down') sections, where the direct export has
    // no axis flips, so the identity mapping matches the canvas.
    svg += buildDxfUnderlaySvg(
      dxfUnderlays,
      (x, y) => ({ x, y }),
      mmToModel,
      1, // text height is already in model units (metres)
      escapeXml,
      rotDeg,
    );

    // 1. FILL CUT POLYGONS (with color from IFC materials or override engine)
    svg += '  <g id="polygon-fills">\n';
    for (const polygon of drawing.cutPolygons) {
      let fillColor = getFillColorForType(polygon.ifcType);
      let opacity = 1;

      // Use actual IFC material colors from the mesh data
      if (activePresetId === 'preset-3d-colors') {
        const materialColor = entityColorMap.get(polygon.entityId);
        if (materialColor) {
          const r = Math.round(materialColor[0] * 255);
          const g = Math.round(materialColor[1] * 255);
          const b = Math.round(materialColor[2] * 255);
          fillColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          opacity = materialColor[3];
        }
      } else if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        fillColor = result.style.fillColor;
        opacity = result.style.opacity;
      }

      const pathData = polygonToPath(polygon.polygon);
      svg += `    <path d="${pathData}" fill="${fillColor}" fill-opacity="${opacity.toFixed(2)}" fill-rule="evenodd" data-entity-id="${polygon.entityId}" data-ifc-type="${escapeXml(polygon.ifcType)}"/>\n`;
    }
    svg += '  </g>\n';

    // 2. STROKE CUT POLYGON OUTLINES (with color from override engine)
    svg += '  <g id="polygon-outlines">\n';
    for (const polygon of drawing.cutPolygons) {
      let strokeColor = '#000000';
      let lineWeight = 0.5;

      if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        strokeColor = result.style.strokeColor;
        lineWeight = result.style.lineWeight;
      }

      const pathData = polygonToPath(polygon.polygon);
      // Convert line weight (mm on paper) to model units
      const svgLineWeight = mmToModel(lineWeight);
      svg += `    <path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="${svgLineWeight.toFixed(4)}" data-entity-id="${polygon.entityId}"/>\n`;
    }
    svg += '  </g>\n';

    // 3. DRAW PROJECTION/SILHOUETTE LINES
    // Pre-compute bounds for line validation
    const lineBounds = drawing.bounds;
    const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
    const lineMinX = lineBounds.min.x - lineMargin;
    const lineMaxX = lineBounds.max.x + lineMargin;
    const lineMinY = lineBounds.min.y - lineMargin;
    const lineMaxY = lineBounds.max.y + lineMargin;

    svg += '  <g id="drawing-lines">\n';
    for (const line of drawing.lines) {
      // Skip 'cut' lines - they're triangulation edges, already handled by polygons
      if (line.category === 'cut') continue;

      // Skip hidden lines if not showing
      if (!displayOptions.showHiddenLines && line.visibility === 'hidden') continue;

      // Skip lines with invalid coordinates
      const { start, end } = line.line;
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) {
        continue;
      }
      if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
        end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) {
        continue;
      }

      // Set line style based on category
      let strokeColor = '#000000';
      let lineWidth = 0.25;
      let dashArray = '';

      switch (line.category) {
        case 'projection':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'hidden':
          lineWidth = 0.18;
          strokeColor = '#666666';
          dashArray = '2 1';
          break;
        case 'silhouette':
          lineWidth = 0.35;
          strokeColor = '#000000';
          break;
        case 'crease':
          lineWidth = 0.18;
          strokeColor = '#000000';
          break;
        case 'boundary':
          lineWidth = 0.25;
          strokeColor = '#000000';
          break;
        case 'annotation':
          lineWidth = 0.13;
          strokeColor = '#000000';
          break;
      }

      // Hidden visibility overrides
      if (line.visibility === 'hidden') {
        strokeColor = '#888888';
        dashArray = '2 1';
        lineWidth *= 0.7;
      }

      // Convert line width from mm on paper to model units
      const svgLineWidth = mmToModel(lineWidth);
      const dashAttr = dashArray ? ` stroke-dasharray="${dashArray.split(' ').map(d => mmToModel(parseFloat(d)).toFixed(4)).join(' ')}"` : '';

      // Transform line endpoints with axis-specific flipping
      const startT = { x: flipX ? -start.x : start.x, y: flipY ? -start.y : start.y };
      const endT = { x: flipX ? -end.x : end.x, y: flipY ? -end.y : end.y };
      svg += `    <line x1="${startT.x.toFixed(4)}" y1="${startT.y.toFixed(4)}" x2="${endT.x.toFixed(4)}" y2="${endT.y.toFixed(4)}" stroke="${strokeColor}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
    }
    svg += '  </g>\n';

    // 3a. DOOR SWINGS AND WINDOW SASHES (#50)
    //
    // Real geometry in drawing space, so unlike the room labels there is no
    // paper-versus-screen question — the arc is the size the door is. Only the
    // line weight is a paper decision, and 0.25 mm is the thin drafting weight
    // a symbol is drawn at.
    if (openingSymbols.length > 0) {
      const symbolWeight = mmToModel(0.25);
      svg += '  <g id="opening-symbols">\n';
      for (const symbol of openingSymbols) {
        let d = '';
        for (const line of symbol.lines) {
          const ax = flipX ? -line.start.x : line.start.x;
          const ay = flipY ? -line.start.y : line.start.y;
          const bx = flipX ? -line.end.x : line.end.x;
          const by = flipY ? -line.end.y : line.end.y;
          d += `M ${ax.toFixed(4)} ${ay.toFixed(4)} L ${bx.toFixed(4)} ${by.toFixed(4)} `;
        }
        if (!d) continue;
        svg += `    <path d="${d.trim()}" fill="none" stroke="#000000" stroke-width="${symbolWeight.toFixed(4)}"/>\n`;
      }
      svg += '  </g>\n';
    }

    // 3a2. DEVICE MARKS (#50)
    //
    // Sized in millimetres ON PAPER, which is the whole point: a detector is
    // 100 mm across, so at 1:100 its own outline is a millimetre and at 1:200
    // it is nothing. The mark is 3 mm at every scale, because it exists to be
    // seen rather than to be measured.
    if (deviceMarks.length > 0) {
      const half = mmToModel(DEVICE_MARK_PAPER_MM) / 2;
      const weight = mmToModel(0.25);
      svg += '  <g id="device-marks">\n';
      for (const mark of deviceMarks) {
        const cx = flipX ? -mark.position.x : mark.position.x;
        const cy = flipY ? -mark.position.y : mark.position.y;
        let d = '';
        for (const path of deviceMarkPaths(mark.kind)) {
          path.forEach((p, i) => {
            // The unit shape's y grows downward like a screen's; on paper the
            // plan axis does too ('down' takes no flip), so it carries over.
            const px = cx + p.x * half * 2;
            const py = cy + p.y * half * 2;
            d += `${i === 0 ? 'M' : 'L'} ${px.toFixed(4)} ${py.toFixed(4)} `;
          });
        }
        if (!d.trim()) continue;
        svg += `    <path d="${d.trim()}" fill="#ffffff" stroke="#000000" stroke-width="${weight.toFixed(4)}"/>\n`;
      }
      svg += '  </g>\n';
    }

    // 3b. ROOM NAMES AND AREAS (#50)
    //
    // Model content, so it goes UNDER the user's marks: a measurement drawn
    // across a room should sit on top of that room's name, not disappear
    // behind it.
    //
    // Sized in millimetres ON PAPER rather than in screen pixels, which is the
    // one place this export differs from what the canvas draws: on screen a
    // label stays the same size as you zoom, on paper it is 3 mm at whatever
    // scale the sheet is at. Both are what their medium wants. The same fit
    // test runs against the paper sizes, so a room too small to hold its label
    // at 1:200 is left blank instead of overprinted.
    if (planLabels.length > 0) {
      const nameSize = mmToModel(3);
      const detailSize = mmToModel(2.5);
      const lineHeight = mmToModel(3.6);
      svg += '  <g id="plan-labels">\n';
      for (const label of planLabels) {
        const { lines } = label;
        if (!labelVisible(label, 1, nameSize, lineHeight)) continue;

        const px = flipX ? -label.anchor.x : label.anchor.x;
        const py = flipY ? -label.anchor.y : label.anchor.y;
        const top = py - ((lines.length - 1) * lineHeight) / 2;

        for (let i = 0; i < lines.length; i++) {
          const y = top + i * lineHeight;
          const size = i === 0 ? nameSize : detailSize;
          svg += `    <text${uprightText(px, y)} x="${px.toFixed(4)}" y="${y.toFixed(4)}" font-family="Arial, sans-serif" font-size="${size.toFixed(4)}" fill="#000000" text-anchor="middle" dominant-baseline="middle"${i === 0 ? ' font-weight="600"' : ''}>${escapeXml(lines[i])}</text>\n`;
        }
      }
      svg += '  </g>\n';
    }

    // 4. DRAW COMPLETED MEASUREMENTS
    if (measure2DResults.length > 0) {
      svg += '  <g id="measurements">\n';
      for (const result of measure2DResults) {
        const { start, end, distance } = result;
        // Transform measurement points with axis-specific flipping
        const startT = { x: flipX ? -start.x : start.x, y: flipY ? -start.y : start.y };
        const endT = { x: flipX ? -end.x : end.x, y: flipY ? -end.y : end.y };
        const midX = (startT.x + endT.x) / 2;
        const midY = (startT.y + endT.y) / 2;
        const labelText = formatDistance(distance);

        // Measurement styling (all in mm on paper, converted to model units)
        const measureColor = '#2196F3';
        const measureLineWidth = mmToModel(0.4);  // 0.4mm line on paper
        const endpointRadius = mmToModel(1.5);    // 1.5mm radius on paper

        // Draw line
        svg += `    <line x1="${startT.x.toFixed(4)}" y1="${startT.y.toFixed(4)}" x2="${endT.x.toFixed(4)}" y2="${endT.y.toFixed(4)}" stroke="${measureColor}" stroke-width="${measureLineWidth.toFixed(4)}"/>\n`;

        // Draw endpoints
        svg += `    <circle cx="${startT.x.toFixed(4)}" cy="${startT.y.toFixed(4)}" r="${endpointRadius.toFixed(4)}" fill="${measureColor}"/>\n`;
        svg += `    <circle cx="${endT.x.toFixed(4)}" cy="${endT.y.toFixed(4)}" r="${endpointRadius.toFixed(4)}" fill="${measureColor}"/>\n`;

        // Draw label background and text
        // Use 3mm text height on paper for readable labels
        const fontSize = mmToModel(3);
        const labelWidth = labelText.length * fontSize * 0.6;  // Approximate text width
        const labelHeight = fontSize * 1.4;
        const labelStroke = mmToModel(0.2);

        svg += `    <rect x="${(midX - labelWidth / 2).toFixed(4)}" y="${(midY - labelHeight / 2).toFixed(4)}" width="${labelWidth.toFixed(4)}" height="${labelHeight.toFixed(4)}" fill="rgba(255,255,255,0.95)" stroke="${measureColor}" stroke-width="${labelStroke.toFixed(4)}"/>\n`;
        svg += `    <text${uprightText(midX, midY)} x="${midX.toFixed(4)}" y="${midY.toFixed(4)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(4)}" fill="#000000" text-anchor="middle" dominant-baseline="middle" font-weight="500">${escapeXml(labelText)}</text>\n`;
      }
      svg += '  </g>\n';
    }

    // 5. DRAW POLYGON AREA MEASUREMENTS
    if (polygonArea2DResults.length > 0) {
      svg += '  <g id="polygon-area-measurements">\n';
      for (const result of polygonArea2DResults) {
        if (result.points.length < 3) continue;
        const pointsStr = result.points.map(p => {
          const pt = { x: flipX ? -p.x : p.x, y: flipY ? -p.y : p.y };
          return `${pt.x.toFixed(4)},${pt.y.toFixed(4)}`;
        }).join(' ');

        const measureColor = '#2196F3';
        const lineWidth = mmToModel(0.3);

        svg += `    <polygon points="${pointsStr}" fill="rgba(33,150,243,0.1)" stroke="${measureColor}" stroke-width="${lineWidth.toFixed(4)}" stroke-dasharray="${mmToModel(1).toFixed(4)} ${mmToModel(0.5).toFixed(4)}"/>\n`;

        // Label at centroid
        const centroid = computePolygonCentroid(result.points);
        const ct = { x: flipX ? -centroid.x : centroid.x, y: flipY ? -centroid.y : centroid.y };
        const areaText = formatArea(result.area);
        const fontSize = mmToModel(3);

        svg += `    <text${uprightText(ct.x, ct.y)} x="${ct.x.toFixed(4)}" y="${ct.y.toFixed(4)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(4)}" fill="#000000" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${escapeXml(areaText)}</text>\n`;
      }
      svg += '  </g>\n';
    }

    // 6. DRAW TEXT ANNOTATIONS
    if (textAnnotations2D.length > 0) {
      svg += '  <g id="text-annotations">\n';
      for (const annotation of textAnnotations2D) {
        if (!annotation.text.trim()) continue;
        const pt = { x: flipX ? -annotation.position.x : annotation.position.x, y: flipY ? -annotation.position.y : annotation.position.y };
        const fontSize = mmToModel(2.5);
        const padding = mmToModel(1);
        const lines = annotation.text.split('\n');
        const lineHeight = fontSize * 1.3;
        const approxWidth = Math.max(...lines.map(l => l.length * fontSize * 0.6)) + padding * 2;
        const height = lines.length * lineHeight + padding * 2;

        svg += `    <rect x="${pt.x.toFixed(4)}" y="${pt.y.toFixed(4)}" width="${approxWidth.toFixed(4)}" height="${height.toFixed(4)}" fill="${annotation.backgroundColor}" stroke="${annotation.borderColor}" stroke-width="${mmToModel(0.15).toFixed(4)}"/>\n`;
        for (let i = 0; i < lines.length; i++) {
          svg += `    <text${uprightText(pt.x + padding, pt.y + padding + fontSize * 0.8 + i * lineHeight)} x="${(pt.x + padding).toFixed(4)}" y="${(pt.y + padding + fontSize * 0.8 + i * lineHeight).toFixed(4)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(4)}" fill="${annotation.color}">${escapeXml(lines[i])}</text>\n`;
        }
      }
      svg += '  </g>\n';
    }

    // 7. DRAW CLOUD ANNOTATIONS
    if (cloudAnnotations2D.length > 0) {
      svg += '  <g id="cloud-annotations">\n';
      for (const cloud of cloudAnnotations2D) {
        if (cloud.points.length < 2) continue;
        const rectW = Math.abs(cloud.points[1].x - cloud.points[0].x);
        const rectH = Math.abs(cloud.points[1].y - cloud.points[0].y);
        const arcRadius = Math.min(rectW, rectH) * 0.15 || 0.2;

        const transformX = (x: number) => flipX ? -x : x;
        const transformY = (y: number) => flipY ? -y : y;
        const pathData = generateCloudSVGPath(cloud.points[0], cloud.points[1], arcRadius, transformX, transformY);
        const lineWidth = mmToModel(0.4);

        svg += `    <path d="${pathData}" fill="rgba(229,57,53,0.05)" stroke="${cloud.color}" stroke-width="${lineWidth.toFixed(4)}"/>\n`;

        if (cloud.label) {
          const cx = transformX((cloud.points[0].x + cloud.points[1].x) / 2);
          const cy = transformY((cloud.points[0].y + cloud.points[1].y) / 2);
          const fontSize = mmToModel(3);
          svg += `    <text${uprightText(cx, cy)} x="${cx.toFixed(4)}" y="${cy.toFixed(4)}" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(4)}" fill="${cloud.color}" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${escapeXml(cloud.label)}</text>\n`;
        }
      }
      svg += '  </g>\n';
    }

    // POINT-CLOUD SCAN OVERLAY (issue #1805) — on top, same drawing-space
    // content as cutPolygons/lines, so it needs the same flipX/flipY the
    // rest of this direct export applies via `transformPt`.
    if (displayOptions.showScanSection && displayOptions.scanSectionIncludeInExport) {
      svg += buildScanSectionSvg(
        scanSection.points,
        (x, y) => ({ x: flipX ? -x : x, y: flipY ? -y : y }),
        mmToModel(0.3),
        displayOptions.scanSectionOpacity,
      );
    }

    if (rotDeg !== 0) svg += '  </g>\n';
    svg += '</svg>';
    return svg;
  }, [drawing, displayOptions, activePresetId, entityColorMap, overridesEnabled, overrideEngine, measure2DResults, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D, planLabels, openingSymbols, deviceMarks, sectionPlane.axis, dxfUnderlays, scanSection, viewRotation]);

  // Generate SVG with drawing sheet (frame, title block, scale bar)
  // This generates coordinates directly in paper mm space (like the canvas rendering)
  const generateSheetSVG = useCallback((): string | null => {
    if (!drawing || !activeSheet) return null;

    const { bounds } = drawing;

    // Sheet dimensions in mm
    const paperWidth = activeSheet.paper.widthMm;
    const paperHeight = activeSheet.paper.heightMm;
    const viewport = activeSheet.viewportBounds;

    // Calculate transform to fit drawing into viewport
    const drawingTransform = calculateDrawingTransform(
      { minX: bounds.min.x, minY: bounds.min.y, maxX: bounds.max.x, maxY: bounds.max.y },
      viewport,
      activeSheet.scale
    );

    const { translateX, translateY, scaleFactor } = drawingTransform;

    // Axis-specific flipping (matching canvas rendering)
    // - 'down' (plan view): DON'T flip Y so north (Z+) is up
    // - 'front' and 'side': flip Y so height (Y+) is up
    // - 'side': also flip X to look from conventional direction
    const currentAxis = sectionPlane.axis;
    const flipY = currentAxis !== 'down';
    const flipX = currentAxis === 'side';

    // Helper: convert model coordinates to paper mm (matching canvas rendering exactly)
    const modelToPaper = (x: number, y: number): { x: number; y: number } => {
      const adjustedX = flipX ? -x : x;
      const adjustedY = flipY ? -y : y;
      return {
        x: adjustedX * scaleFactor + translateX,
        y: adjustedY * scaleFactor + translateY,
      };
    };

    // Start building SVG (paper coordinates in mm)
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${paperWidth}mm"
     height="${paperHeight}mm"
     viewBox="0 0 ${paperWidth} ${paperHeight}">
  <!-- Background -->
  <rect x="0" y="0" width="${paperWidth}" height="${paperHeight}" fill="#FFFFFF"/>

`;

    // Create clipping path for viewport FIRST (so it can be used by drawing content)
    svg += `  <defs>
    <clipPath id="viewport-clip">
      <rect x="${viewport.x.toFixed(2)}" y="${viewport.y.toFixed(2)}" width="${viewport.width.toFixed(2)}" height="${viewport.height.toFixed(2)}"/>
    </clipPath>
  </defs>

`;

    // Drawing content FIRST (so frame/title block render on top)
    svg += `  <g id="drawing-content" clip-path="url(#viewport-clip)">
`;

    // Helper to escape XML
    const escapeXml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    // Helper to get polygon path in paper coordinates
    const polygonToPath = (polygon: { outer: { x: number; y: number }[]; holes: { x: number; y: number }[][] }): string => {
      let path = '';
      if (polygon.outer.length > 0) {
        const first = modelToPaper(polygon.outer[0].x, polygon.outer[0].y);
        path += `M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
        for (let i = 1; i < polygon.outer.length; i++) {
          const pt = modelToPaper(polygon.outer[i].x, polygon.outer[i].y);
          path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
        }
        path += ' Z';
      }
      for (const hole of polygon.holes) {
        if (hole.length > 0) {
          const holeFirst = modelToPaper(hole[0].x, hole[0].y);
          path += ` M ${holeFirst.x.toFixed(4)} ${holeFirst.y.toFixed(4)}`;
          for (let i = 1; i < hole.length; i++) {
            const pt = modelToPaper(hole[i].x, hole[i].y);
            path += ` L ${pt.x.toFixed(4)} ${pt.y.toFixed(4)}`;
          }
          path += ' Z';
        }
      }
      return path;
    };

    // DXF reference underlays (issue #1782) - beneath everything. Data
    // exists only for plan ('down') sections, where the sheet mapping has
    // no axis flips, so the plain drawing→paper transform matches the canvas.
    svg += buildDxfUnderlaySvg(
      dxfUnderlays,
      (x, y) => ({ x: x * scaleFactor + translateX, y: y * scaleFactor + translateY }),
      (mm) => mm * 0.3, // mm on paper, matching the model outline convention
      scaleFactor, // metres -> mm on paper
      escapeXml,
    );

    // Render polygon fills
    svg += '    <g id="polygon-fills">\n';
    for (const polygon of drawing.cutPolygons) {
      let fillColor = getFillColorForType(polygon.ifcType);
      let opacity = 1;

      if (activePresetId === 'preset-3d-colors') {
        const materialColor = entityColorMap.get(polygon.entityId);
        if (materialColor) {
          const r = Math.round(materialColor[0] * 255);
          const g = Math.round(materialColor[1] * 255);
          const b = Math.round(materialColor[2] * 255);
          fillColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
          opacity = materialColor[3];
        }
      } else if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        fillColor = result.style.fillColor;
        opacity = result.style.opacity;
      }

      const pathData = polygonToPath(polygon.polygon);
      if (pathData) {
        svg += `      <path d="${pathData}" fill="${fillColor}" fill-opacity="${opacity.toFixed(2)}" fill-rule="evenodd" data-entity-id="${polygon.entityId}" data-ifc-type="${escapeXml(polygon.ifcType)}"/>\n`;
      }
    }
    svg += '    </g>\n';

    // Render polygon outlines
    svg += '    <g id="polygon-outlines">\n';
    for (const polygon of drawing.cutPolygons) {
      let strokeColor = '#000000';
      let lineWeight = 0.5;

      if (overridesEnabled) {
        const elementData: ElementData = {
          expressId: polygon.entityId,
          ifcType: polygon.ifcType,
        };
        const result = overrideEngine.applyOverrides(elementData);
        strokeColor = result.style.strokeColor;
        lineWeight = result.style.lineWeight;
      }

      const pathData = polygonToPath(polygon.polygon);
      if (pathData) {
        // lineWeight is in mm on paper
        const svgLineWeight = lineWeight * 0.3; // Scale down for better appearance
        svg += `      <path d="${pathData}" fill="none" stroke="${strokeColor}" stroke-width="${svgLineWeight.toFixed(4)}" data-entity-id="${polygon.entityId}"/>\n`;
      }
    }
    svg += '    </g>\n';

    // Render drawing lines
    const lineBounds = drawing.bounds;
    const lineMargin = Math.max(lineBounds.max.x - lineBounds.min.x, lineBounds.max.y - lineBounds.min.y) * 0.5;
    const lineMinX = lineBounds.min.x - lineMargin;
    const lineMaxX = lineBounds.max.x + lineMargin;
    const lineMinY = lineBounds.min.y - lineMargin;
    const lineMaxY = lineBounds.max.y + lineMargin;

    svg += '    <g id="drawing-lines">\n';
    for (const line of drawing.lines) {
      if (line.category === 'cut') continue;
      if (!displayOptions.showHiddenLines && line.visibility === 'hidden') continue;

      const { start, end } = line.line;
      if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) continue;
      if (start.x < lineMinX || start.x > lineMaxX || start.y < lineMinY || start.y > lineMaxY ||
        end.x < lineMinX || end.x > lineMaxX || end.y < lineMinY || end.y > lineMaxY) continue;

      let strokeColor = '#000000';
      let lineWidth = 0.25;
      let dashArray = '';

      switch (line.category) {
        case 'projection': lineWidth = 0.25; break;
        case 'hidden': lineWidth = 0.18; strokeColor = '#666666'; dashArray = '1 0.5'; break;
        case 'silhouette': lineWidth = 0.35; break;
        case 'crease': lineWidth = 0.18; break;
        case 'boundary': lineWidth = 0.25; break;
        case 'annotation': lineWidth = 0.13; break;
      }

      if (line.visibility === 'hidden') {
        strokeColor = '#888888';
        dashArray = '1 0.5';
        lineWidth *= 0.7;
      }

      const paperStart = modelToPaper(start.x, start.y);
      const paperEnd = modelToPaper(end.x, end.y);

      // lineWidth is in mm on paper
      const svgLineWidth = lineWidth * 0.3;
      const dashAttr = dashArray ? ` stroke-dasharray="${dashArray}"` : '';
      svg += `      <line x1="${paperStart.x.toFixed(4)}" y1="${paperStart.y.toFixed(4)}" x2="${paperEnd.x.toFixed(4)}" y2="${paperEnd.y.toFixed(4)}" stroke="${strokeColor}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
    }
    svg += '    </g>\n';

    // POINT-CLOUD SCAN OVERLAY (issue #1805) — on top, inside the clipped
    // drawing-content group like everything else. `modelToPaper` already
    // applies the same flip + scale/translate the rest of the sheet uses.
    if (displayOptions.showScanSection && displayOptions.scanSectionIncludeInExport) {
      svg += buildScanSectionSvg(
        scanSection.points,
        modelToPaper,
        0.3, // mm on paper
        displayOptions.scanSectionOpacity,
      );
    }

    svg += '  </g>\n\n';

    // Render frame (on top of drawing content)
    const frameResult = renderFrame(activeSheet.paper, activeSheet.frame);
    svg += frameResult.svgElements;
    svg += '\n';

    // Render title block with scale bar and north arrow inside
    // Pass effectiveScaleFactor from the actual transform (not just configured scale)
    // This ensures scale bar shows correct values when dynamically scaled
    const titleBlockExtras: TitleBlockExtras = {
      scaleBar: activeSheet.scaleBar,
      northArrow: activeSheet.northArrow,
      scale: activeSheet.scale,
      effectiveScaleFactor: scaleFactor,
    };
    const titleBlockResult = renderTitleBlock(
      activeSheet.titleBlock,
      frameResult.innerBounds,
      activeSheet.revisions,
      titleBlockExtras
    );
    svg += titleBlockResult.svgElements;
    svg += '\n';

    svg += '</svg>';
    return svg;
  }, [drawing, activeSheet, displayOptions, activePresetId, entityColorMap, overridesEnabled, overrideEngine, dxfUnderlays, scanSection]);

  // Export SVG
  const handleExportSVG = useCallback(() => {
    // Use sheet export if enabled, otherwise raw drawing export
    const svg = (sheetEnabled && activeSheet) ? generateSheetSVG() : generateExportSVG();
    if (!svg) return;
    const stem = (sheetEnabled && activeSheet)
      ? `${sanitizeFilename(activeSheet.name, { fallback: 'sheet' })}-${sectionPlane.axis}-${sectionPlane.position}`
      : `section-${sectionPlane.axis}-${sectionPlane.position}`;
    downloadFile(svg, `${stem}.svg`, 'image/svg+xml');
    posthog.capture('drawing_exported', { format: 'svg', axis: sectionPlane.axis, sheet_enabled: sheetEnabled });
  }, [generateExportSVG, generateSheetSVG, sheetEnabled, activeSheet, sectionPlane]);

  // Export DXF (issue #1861). Unlike SVG, DXF has no paper space, so this
  // always exports the raw model-space drawing (sheet frame/title block are
  // not represented) — real-world metres, with a plan ('down') section
  // re-georeferenced to true IFC world coordinates (and further to
  // map/CRS coordinates when the model has an IfcMapConversion). DXF
  // reference underlays are not embedded in this export; see PR notes.
  // The point-cloud scan overlay (issue #1805) is likewise deliberately
  // excluded: it is a raster-like screen aid (up to tens of thousands of
  // circles), not vector drawing content, and would bloat a CAD exchange
  // file — SVG export carries it (opt-in) instead.
  const handleExportDXF = useCallback(() => {
    if (!drawing) return;
    const isCustomPlane = sectionPlane.custom !== undefined;
    // Anchor-model effective georef, INCLUDING user placement edits
    // (georefMutations) — see resolveDxfExportGeoreference's docs. The
    // drawing-frame `coordinateInfo` below is unrelated: it undoes the
    // render-frame shift and stays the merged drawing's regardless of which
    // model anchors the georef.
    const georeference = resolveDxfExportGeoreference({
      models: storeModels,
      legacyDataStore: ifcDataStore,
      legacyCoordinateInfo: coordinateInfo,
      anchorModelIdOverride,
      georefMutations,
    });
    const coordinateTransform = buildDxfExportTransform({
      coordinateInfo,
      sectionAxis: sectionPlane.axis,
      isCustomPlane,
      flipped: sectionPlane.flipped,
      georeference,
    });
    const isGeoreferenced = georeference !== null && sectionPlane.axis === 'down' && !isCustomPlane;
    // R12 has no $INSUNITS (see dxf/writer.ts); state the unit — and the
    // target CRS when the export is actually map-projected — in the 999
    // comment every DXF reader shows a human but none need to parse.
    const metadataComment = isGeoreferenced
      ? `ifc-lite section export - units: metres, CRS: ${georeference!.projectedCRS.name || 'unknown'}`
      : undefined;
    // The plan overlays, which DXF did not carry until now: a plan handed on
    // as DXF arrived with walls and nothing written on them.
    //
    // Text is sized in PAPER millimetres like the SVG export, converted to
    // model units through the plan scale — the same 3 mm / 2.5 mm the SVG
    // uses, so the two exports of one drawing letter the same.
    const dxfScale = displayOptions.scale || 100;
    const paperToModel = (mm: number) => (mm * dxfScale) / 1000;
    const nameSize = paperToModel(3);
    const detailSize = paperToModel(2.5);
    const lineStep = paperToModel(3.6);

    const dxfLabels: DXFPlanText[] = [];
    for (const label of planLabels) {
      const lines = label.lines.filter((line) => line.trim().length > 0);
      if (lines.length === 0) continue;
      if (!labelVisible(label, 1, nameSize, lineStep)) continue;
      // Stacked around the anchor, matching the overlay and the SVG.
      const top = label.anchor.y - ((lines.length - 1) * lineStep) / 2;
      lines.forEach((text, index) => {
        dxfLabels.push({
          position: { x: label.anchor.x, y: top + index * lineStep },
          text,
          height: index === 0 ? nameSize : detailSize,
        });
      });
    }

    // Opening symbols are already segments in drawing units. Device marks are
    // NOT: a mark is a unit shape placed at a point and sized in paper
    // millimetres, so it is expanded here exactly as the SVG export expands
    // it — 3 mm at every scale, because it exists to be seen and not measured.
    const dxfSymbolLines: { start: { x: number; y: number }; end: { x: number; y: number } }[] = [];
    for (const symbol of openingSymbols) dxfSymbolLines.push(...symbol.lines);
    const markHalf = paperToModel(DEVICE_MARK_PAPER_MM) / 2;
    for (const mark of deviceMarks) {
      for (const path of deviceMarkPaths(mark.kind)) {
        for (let i = 1; i < path.length; i += 1) {
          dxfSymbolLines.push({
            start: {
              x: mark.position.x + path[i - 1].x * markHalf * 2,
              y: mark.position.y + path[i - 1].y * markHalf * 2,
            },
            end: {
              x: mark.position.x + path[i].x * markHalf * 2,
              y: mark.position.y + path[i].y * markHalf * 2,
            },
          });
        }
      }
    }

    // Room outlines come from the DRAWING, which is the only place a real
    // footprint exists — `RoomLabel` carries an extent and an anchor, not an
    // outline, and deriving one would mean the polygon union the label module
    // deliberately avoids. Number and designation are joined on by express id.
    const roomFacts = new Map(planLabels
      .filter((label) => label.kind === 'room')
      .map((label) => [label.expressId, label.lines]));
    const dxfRooms: DXFRoomPolygon[] = [];
    for (const polygon of drawing.cutPolygons) {
      if (!polygon.isCut || polygon.ifcType !== 'IfcSpace') continue;
      const facts = roomFacts.get(polygon.entityId);
      dxfRooms.push({
        outline: polygon.polygon.outer,
        number: facts?.[0],
        name: facts?.[1],
      });
    }

    const dxf = exportToDXF(drawing, {
      showHiddenLines: displayOptions.showHiddenLines,
      coordinateTransform,
      metadataComment,
      plan: { labels: dxfLabels, symbolLines: dxfSymbolLines, rooms: dxfRooms },
    });
    const stem = `section-${sectionPlane.axis}-${sectionPlane.position}`;
    downloadFile(dxf, `${stem}.dxf`, 'application/dxf');
    posthog.capture('drawing_exported', {
      format: 'dxf',
      axis: sectionPlane.axis,
      georeferenced: isGeoreferenced,
    });
  }, [
    drawing, displayOptions.showHiddenLines, displayOptions.scale, sectionPlane,
    ifcDataStore, coordinateInfo, planLabels, openingSymbols, deviceMarks,
    storeModels, anchorModelIdOverride, georefMutations, mutationVersion,
  ]);

  // Print handler
  const handlePrint = useCallback(() => {
    // Use sheet export if enabled, otherwise raw drawing export
    const svg = (sheetEnabled && activeSheet) ? generateSheetSVG() : generateExportSVG();
    if (!svg) return;

    // The paper size, read back off the SVG we just wrote.
    //
    // `generateExportSVG` sizes its root in MILLIMETRES from the plan scale —
    // that is what makes 1:100 mean 1:100 on paper. Handing the print window a
    // page of some other size makes the browser fit one to the other, and the
    // scale is gone. So the page is told to be the drawing.
    //
    // Read out of the string rather than plumbed through: the generator returns
    // an SVG, its root is written by us two hundred lines up, and a second
    // return value would have to be threaded through the sheet path as well.
    const mm = /width="([0-9.]+)mm"\s+height="([0-9.]+)mm"/.exec(svg);
    const pageSize = mm ? `${mm[1]}mm ${mm[2]}mm` : 'auto';

    // A correct page box still does not force the browser's own scale control,
    // which defaults to fitting. Nothing in CSS can, so the window says so
    // rather than quietly printing at 94%.
    const scaleHint = mm
      ? `<p class="scale-hint">Massstabsgetreu drucken: im Druckdialog <b>Skalierung 100%</b> (bzw. „Tatsächliche Grösse“) wählen und die Ränder auf <b>Keine</b> setzen. Blattgrösse ${mm[1]} × ${mm[2]} mm.</p>`
      : '';
    // Create a new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      alert('Please allow popups to print');
      return;
    }

    const rawTitle = (sheetEnabled && activeSheet)
      ? `${activeSheet.name} - ${sectionPlane.axis} at ${sectionPlane.position}%`
      : `Section Drawing - ${sectionPlane.axis} at ${sectionPlane.position}%`;
    // The sheet name is user-controlled and interpolated into the <title> of a
    // same-origin window. Without escaping, a sheet named `</title><script>…`
    // would break out of the title and execute script. Escape it (the SVG body
    // is already escaped via escapeXml; the title was the one unescaped sink).
    const title = rawTitle
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Write print-friendly HTML with the SVG
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            @media print {
              /* The page follows the DRAWING, not the other way round. Fixed
                 to a paper size, the browser fits the content to it — which is
                 exactly what destroys the scale. */
              @page { size: ${pageSize}; margin: 0; }
              body { margin: 0; padding: 0; display: block; }
              .scale-hint { display: none; }
            }
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              margin: 0;
              padding: ${(sheetEnabled && activeSheet) ? "0" : "20px"};
              box-sizing: border-box;
            }
            /* NOT max-width / height:auto. Those override the millimetres on
               the <svg> root and shrink the drawing to the window, so it would
               print at whatever scale happened to fit. */
            svg { display: block; }
            .scale-hint {
              font: 13px system-ui, sans-serif;
              margin-bottom: 12px; padding: 8px 12px;
              border: 1px solid #d4a72c; background: #fdf6e3; color: #6b5200;
              max-width: 40em;
            }
          </style>
        </head>
        <body>
          ${scaleHint}
          ${svg}
          <script>
            window.onload = function() {
              window.print();
              window.onafterprint = function() { window.close(); };
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }, [generateExportSVG, generateSheetSVG, sheetEnabled, activeSheet, sectionPlane]);

  return {
    formatDistance,
    handleExportSVG,
    handleExportDXF,
    handlePrint,
  };
}

export { useDrawingExport };
export default useDrawingExport;
