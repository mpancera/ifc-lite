/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback } from 'react';
import type React from 'react';
import { posthog } from '@/lib/analytics';
import { toast } from '@/components/ui/toast';
import { rotatedBounds } from '@/lib/plan/planRotation';
import { labelVisible, type PlanLabel } from '@/lib/plan/roomLabels';
import type { SymbolLine } from '@/lib/plan/openingSymbols';
import { deviceMarkPaths, DEVICE_MARK_PAPER_MM, type DeviceMark } from '@/lib/plan/deviceSymbols';
import { symbolDrawingFor, symbolEntryFor } from '@/lib/symbolCatalog/symbolCatalog';
import { symbolFit, symbolGeometryOf } from '@/lib/symbolCatalog/symbolGeometry';
import { useSymbolCatalog } from '@/lib/symbolCatalog/useSymbolCatalog';
import { useActiveSymbolSet } from '@/hooks/useActiveSymbolSet';
import { downloadFile, sanitizeFilename } from '@/lib/export/download';
import { pdfLineStyleFor } from '@/lib/export/pdf-line-style';
import {
  GraphicOverrideEngine,
  renderFrame,
  renderTitleBlock,
  calculateViewportTransform,
  sheetViewports,
  exportToDXF,
  type DXFPlanText,
  type DXFRoomPolygon,
  formatScaleFactorLabel,
  fitRasterPixels,
  type RasterFit,
  type Drawing2D,
  type DrawingSheet,
  type ElementData,
  type TitleBlockExtras,
  type PdfScaleLayout,
} from '@ifc-lite/drawing-2d';
import { computePdfSectionLayout, makeSectionMapPoint } from '@/hooks/pdfSectionLayout';
import { sheetTransformCacheKeyOf, type CachedSheetTransform } from '@/lib/drawing/sheet-geometry-key';
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
import { downloadDxf } from '@/hooks/dxfDownload';
import { DEFAULT_SCAN_SVG_CAP, type ScanBandPoint } from '@/hooks/scanSectionMath';
import { computeSvgExportViewport, svgExportMmToWorld } from '@/hooks/svgExportViewport';
import { makePropertiesGetter } from '@/hooks/drawingElementProperties';
import { titleBlockWithEffectiveScale } from '@/hooks/titleBlockScaleField';

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

/**
 * Dots per inch of paper the sheet raster is built at.
 *
 * Fixed, with no UI control anywhere: `handleExportPDF` is a single toolbar
 * action. That is why the ceiling below CAPS rather than REFUSES — a refusal
 * would have no setting to send the user to, and the sheet's paper size is
 * the deliverable, not a preference.
 */
export const SHEET_PDF_DPI = 300;

/**
 * Pixel budget for one sheet raster, taken from WebKit's own canvas cap
 * rather than picked as a round number: `CanvasBase::maxCanvasArea()`
 * (Source/WebCore/html/CanvasBase.cpp) returns `8192 * 8192` on the iOS
 * family and `16384 * 16384` elsewhere. The lower of the two is the one that
 * has to hold, because a canvas over the cap does not report itself:
 * `CanvasBase::validateArea()` logs a console warning and returns false, the
 * canvas gets no backing store, `getContext('2d')` still returns a live
 * context, the paint calls become no-ops, and `toDataURL()` then returns the
 * literal string `"data:,"` — `encodeDataURL(RefPtr<ImageBuffer>&&)` in
 * Source/WebCore/platform/graphics/ImageUtilities.cpp returns `"data:,"_s`
 * for a null buffer. Nothing throws at any point.
 *
 * At {@link SHEET_PDF_DPI} that cap binds from ANSI D upwards. The papers
 * that need it are the big ones — ARCH E is 14400 x 10800 = 155,520,000 px
 * and A0 is 14043 x 9933 = 139,489,119 px, both far past even the desktop
 * cap's memory cost (155.5 Mpx x 4 bytes = 622 MB for the bitmap alone).
 *
 * NOT verified in any real browser. The value and the failure mode are read
 * off WebKit's source; Chrome's and Firefox's caps differ and are not
 * modelled, and Safari's separate TOTAL canvas-memory limit is a second
 * ceiling this budget cannot rule out — which is why the raster result is
 * validated below as well as sized.
 */
export const MAX_SHEET_RASTER_PIXELS = 8192 * 8192;

/**
 * Per-side cap: the side length WebKit's non-iOS area cap is expressed as,
 * and the same number `@ifc-lite/drawing-2d` already uses for the 3D-view
 * PDF's shaded underlay (`MAX_SHADING_DIMENSION_PX`). No registry paper
 * reaches it at {@link SHEET_PDF_DPI} (ARCH E's long side is 14400 px); it
 * exists for a custom paper size, which `DrawingSheet.paper` permits.
 */
export const MAX_SHEET_RASTER_DIMENSION_PX = 16_384;

/** A raster, plus what it cost to fit it inside the budget. */
interface SheetRaster {
  dataUrl: string;
  fit: RasterFit;
}

/**
 * Rasterize an SVG string to a PNG data URL, sized to exactly `widthMm` x
 * `heightMm` on paper (issues #2941/#2942). The sheet frame, title block and
 * scale bar only exist inside `generateSheetSVG` — SVG, Print and the
 * DXF-underlay path all render that exact string and the reporter confirmed
 * those are correct. Rather than re-deriving a second, independent sheet
 * layout for jsPDF's vector primitives (the "v1" PDF path below did exactly
 * that and dropped the frame/scale bar entirely, and used
 * `displayOptions.scale` instead of the sheet's own scale), rasterize the
 * SAME svg the working exporters use so the PDF cannot drift from them.
 *
 * The pixel grid comes from `fitRasterPixels`, the same helper the 3D-view
 * PDF's shaded underlay uses, so the two raster paths cannot drift into two
 * different cap policies. It scales BOTH sides by one factor, so a capped
 * sheet is blurrier and never mis-scaled: the caller still places the image
 * across the full paper rectangle in millimetres, never at `px / dpi`.
 *
 * `fit.capped` is returned rather than swallowed. A user who asked for a
 * 300 dpi sheet and silently got 104 is the same defect as a blank page, one
 * step quieter.
 */
function rasterizeSvgToPngDataUrl(
  svgString: string,
  widthMm: number,
  heightMm: number,
  dpi = SHEET_PDF_DPI,
): Promise<SheetRaster> {
  return new Promise((resolve, reject) => {
    const fit = fitRasterPixels(
      widthMm,
      heightMm,
      dpi,
      MAX_SHEET_RASTER_PIXELS,
      MAX_SHEET_RASTER_DIMENSION_PX,
    );
    const { widthPx, heightPx } = fit;

    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        // The sheet SVG already paints its own white background rect, but a
        // canvas starts transparent — belt-and-braces against a transparent
        // PDF page if that rect is ever clipped away.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, widthPx, heightPx);
        ctx.drawImage(img, 0, 0, widthPx, heightPx);

        const dataUrl = canvas.toDataURL('image/png');
        // The pixel budget above is necessary, not sufficient. Safari
        // enforces a separate TOTAL canvas-memory limit, and any browser can
        // fail a 100+ MB allocation on a low-memory device; in both cases the
        // buffer is simply absent and this comes back as `"data:,"` with no
        // exception raised. Handing that to `jsPDF.addImage` produces a
        // decoder complaint about a PNG signature, which tells the user
        // nothing they can act on — and if a browser ever returned a valid
        // all-white PNG instead, the export would "succeed" with a blank
        // page. Refuse the result here, naming the way out.
        if (!dataUrl.startsWith('data:image/png')) {
          throw new Error(
            `the browser returned an empty ${widthPx}x${heightPx} px canvas for this ` +
            `${Math.round(widthMm)}x${Math.round(heightMm)} mm sheet. Try a smaller paper ` +
            `size, or use the SVG export, which is vector and has no pixel limit.`,
          );
        }
        resolve({ dataUrl, fit });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to rasterize sheet SVG'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load sheet SVG for PDF export'));
    };
    img.src = url;
  });
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
  /** Pin View state, shared with the preview canvas. While pinned the sheet
   *  placement is HELD across a regenerate; print/export must honour the same
   *  held placement or it silently prints a different layout from the one on
   *  screen. */
  isPinned?: boolean;
  /** The preview's pinned-transform cache. Read-only here — the preview owns
   *  the write, so exporting never perturbs what is on screen. */
  cachedSheetTransformRef?: React.MutableRefObject<CachedSheetTransform | null>;
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
  /**
   * Export the section as a true-vector PDF at an exact scale (issue #2042).
   * `scaleFactor` is the "N" in "1:N" (e.g. 100 for 1:100); omit to use the
   * drawing's current on-screen scale ("as displayed").
   */
  handleExportPDF: (scaleFactor?: number) => void;
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
  isPinned = false,
  cachedSheetTransformRef,
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
  // The plan symbols. Read here rather than passed in: the export must draw
  // the SAME symbols the screen does, and threading the catalogue through the
  // caller is one more place for the two to drift apart.
  const symbolCatalog = useSymbolCatalog();
  const symbolSet = useActiveSymbolSet();

  // Generate SVG that matches the canvas rendering exactly
  const generateExportSVG = useCallback((): string | null => {
    if (!drawing) return null;
    const getElementProperties = makePropertiesGetter(storeModels, ifcDataStore);

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

    // World-metres -> paper-mm arithmetic for the direct SVG export,
    // extracted to svgExportViewport.ts (see that file's docstring for why
    // this transform doesn't map points at all — the SVG's own
    // width/height-vs-viewBox ratio does the scaling).
    const viewport = computeSvgExportViewport(bounds, displayOptions.scale, sectionPlane.axis);
    const { widthMm: svgWidthMm, heightMm: svgHeightMm, viewBoxMinX, viewBoxMinY, viewBoxWidth: viewWidth, viewBoxHeight: viewHeight, flipX, flipY, effectiveScale } = viewport;

    // Convert mm on paper to model units (meters)
    // At 1:100 scale, 1mm on paper = 0.1m in model space
    // Formula: modelUnits = paperMm * scale / 1000
    const mmToModel = (mm: number) => svgExportMmToWorld(mm, effectiveScale);

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

    // flipX/flipY (axis-specific, matching canvas rendering) come from
    // `viewport` above — computeSvgExportViewport resolves the same
    // 'down'/'front'/'side' rule this hook used to compute inline.

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
          ifcType: polygon.ifcType, properties: getElementProperties(polygon.entityId),
        };
        const result = overrideEngine.applyOverrides(elementData);
        fillColor = result.style.fillColor;
        opacity = result.style.opacity;
      }

      const pathData = polygonToPath(polygon.polygon);
      svg += `    <path d="${pathData}" fill="${escapeXml(fillColor)}" fill-opacity="${opacity.toFixed(2)}" fill-rule="evenodd" data-entity-id="${polygon.entityId}" data-ifc-type="${escapeXml(polygon.ifcType)}"/>\n`;
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
          ifcType: polygon.ifcType, properties: getElementProperties(polygon.entityId),
        };
        const result = overrideEngine.applyOverrides(elementData);
        strokeColor = result.style.strokeColor;
        lineWeight = result.style.lineWeight;
      }

      const pathData = polygonToPath(polygon.polygon);
      // Convert line weight (mm on paper) to model units
      const svgLineWeight = mmToModel(lineWeight);
      svg += `    <path d="${pathData}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${svgLineWeight.toFixed(4)}" data-entity-id="${polygon.entityId}"/>\n`;
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
      svg += `    <line x1="${startT.x.toFixed(4)}" y1="${startT.y.toFixed(4)}" x2="${endT.x.toFixed(4)}" y2="${endT.y.toFixed(4)}" stroke="${escapeXml(strokeColor)}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
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
    // Set while the marks are drawn, read once the sheet is finished: a sheet
    // that carries symbols used by permission has to name their source, and
    // THIS is the sheet that leaves the building. Collected rather than
    // assumed, so the line appears only when such a symbol is really on it.
    let symbolAttribution: string | null = null;

    if (deviceMarks.length > 0) {
      const half = mmToModel(DEVICE_MARK_PAPER_MM) / 2;
      const weight = mmToModel(0.25);
      svg += '  <g id="device-marks">\n';
      for (const mark of deviceMarks) {
        const cx = flipX ? -mark.position.x : mark.position.x;
        const cy = flipY ? -mark.position.y : mark.position.y;

        // The catalogue's own drawing first — the normative symbol, the one
        // the screen shows. Until now this export drew the family glyph in
        // every case, so a plan looked one way on screen and another way in
        // the file that was handed over. That is the whole reason a symbol
        // catalogue exists: it is FOR the drawing that leaves the building.
        //
        // Re-emitted as geometry rather than embedded as an image, because
        // this SVG becomes a PDF and a print: a vector symbol stays sharp and
        // keeps the same colours the plan already uses for everything else.
        const drawing = symbolDrawingFor(symbolCatalog, mark.ifcType, {
          predefinedType: mark.predefinedType,
          objectType: mark.objectType,
          // The exported sheet must carry the same symbols the screen showed,
          // which means the same product decides both.
          productId: symbolSet,
        });
        const entry = symbolEntryFor(symbolCatalog, mark.ifcType, {
          predefinedType: mark.predefinedType,
          objectType: mark.objectType,
          productId: symbolSet,
        });
        if (drawing && entry?.attributionRequired) {
          symbolAttribution = symbolCatalog?.attribution ?? null;
        }
        const geometry = drawing ? symbolGeometryOf(drawing) : null;
        if (geometry) {
          const fit = symbolFit(geometry.viewBox, half * 2);
          // The drawing's y grows downward, and so does the paper axis here —
          // the same carry-over the family glyph relies on below.
          const px = (x: number) => cx + fit.offsetX + x * fit.scale;
          const py = (y: number) => cy + fit.offsetY + y * fit.scale;
          // The drawing's OWN colours, not this exporter's idea of them.
          // Two sources now reach here: the authority's symbols are red plates
          // with white strokes, the association's are black line art. Painting
          // both in the first palette would put out a symbol that is not the
          // one the source published - and the association's are used by
          // permission, unchanged.
          const paint = (shape: { fill: string | null; stroke: string | null }) =>
            `fill="${shape.fill ?? 'none'}" stroke="${shape.stroke ?? 'none'}" `
            + `stroke-width="${weight.toFixed(4)}"`;

          svg += '    <g>\n';
          for (const line of geometry.polylines) {
            let d = '';
            line.points.forEach((point, i) => {
              d += `${i === 0 ? 'M' : 'L'} ${px(point.x).toFixed(4)} ${py(point.y).toFixed(4)} `;
            });
            if (line.closed) d += 'Z';
            svg += `      <path d="${d.trim()}" ${paint(line)}/>\n`;
          }
          for (const circle of geometry.circles) {
            svg += `      <circle cx="${px(circle.cx).toFixed(4)}" cy="${py(circle.cy).toFixed(4)}"`
              + ` r="${(circle.r * fit.scale).toFixed(4)}" ${paint(circle)}/>\n`;
          }
          for (const ellipse of geometry.ellipses) {
            svg += `      <ellipse cx="${px(ellipse.cx).toFixed(4)}" cy="${py(ellipse.cy).toFixed(4)}"`
              + ` rx="${(ellipse.rx * fit.scale).toFixed(4)}" ry="${(ellipse.ry * fit.scale).toFixed(4)}"`
              + ` ${paint(ellipse)}/>\n`;
          }
          svg += '    </g>\n';
          continue;
        }

        // No catalogue entry, or a drawing the rules do not allow: the family
        // glyph, exactly as before. A generic circle is honest about being
        // generic; half a symbol would not be.
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

    // OUTSIDE the rotation group on purpose. A credit line belongs to the
    // sheet, not to the drawing on it: turned with the plan it would end up
    // sideways or off the paper on any product with its own angle.
    if (symbolAttribution) {
      const size = mmToModel(2);
      const margin = mmToModel(4);
      const x = viewBoxMinX + margin;
      const y = viewBoxMinY + viewHeight - margin;
      svg += `  <text id="symbol-attribution" x="${x.toFixed(4)}" y="${y.toFixed(4)}"`
        + ` font-family="Arial, sans-serif" font-size="${size.toFixed(4)}" fill="#000000">`
        + `${escapeXml(`Symbole: ${symbolAttribution}`)}</text>\n`;
    }

    svg += '</svg>';
    return svg;
  }, [drawing, displayOptions, activePresetId, entityColorMap, overridesEnabled, overrideEngine, measure2DResults, polygonArea2DResults, textAnnotations2D, cloudAnnotations2D, planLabels, openingSymbols, deviceMarks, symbolCatalog, symbolSet, sectionPlane.axis, dxfUnderlays, scanSection, viewRotation, ifcDataStore, storeModels]);

  // Generate SVG with drawing sheet (frame, title block, scale bar)
  // This generates coordinates directly in paper mm space (like the canvas rendering)
  const generateSheetSVG = useCallback((): string | null => {
    if (!drawing || !activeSheet) return null;
    const getElementProperties = makePropertiesGetter(storeModels, ifcDataStore);

    const { bounds } = drawing;

    // Sheet dimensions in mm
    const paperWidth = activeSheet.paper.widthMm;
    const paperHeight = activeSheet.paper.heightMm;
    // One pass per view on the sheet. A single-view sheet loops once, over
    // exactly the bounds and scale it always exported at, so an existing
    // sheet exports byte-for-byte what it did before.
    const sheetViews = sheetViewports(activeSheet);
    // The title block states the PRINCIPAL view's scale — a sheet names one.
    let principalScaleFactor: number | null = null;

    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${paperWidth}mm"
     height="${paperHeight}mm"
     viewBox="0 0 ${paperWidth} ${paperHeight}">
  <!-- Background -->
  <rect x="0" y="0" width="${paperWidth}" height="${paperHeight}" fill="#FFFFFF"/>

`;

    for (const sheetView of sheetViews) {
      const viewport = sheetView.bounds;

      // Calculate transform to fit drawing into viewport, at THIS view's
      // scale — which is the sheet's for an ordinary single-view sheet, and
      // its own on a sheet carrying an overview beside a floor plan.
      // Axis-specific flipping (matching canvas rendering)
      // - 'down' (plan view): DON'T flip Y so north (Z+) is up
      // - 'front' and 'side': flip Y so height (Y+) is up
      // - 'side': also flip X to look from conventional direction
      const currentAxis = sectionPlane.axis;
      const flipY = currentAxis !== 'down';
      const flipX = currentAxis === 'side';

      // While pinned, print/export honours the placement the preview HOLDS
      // (#2940): the canvas caches its transform under the sheet's geometry
      // key plus the axis, and this path reads it — never writes it — while
      // the key still matches. Single-view sheets only, as on the canvas.
      const cached = cachedSheetTransformRef?.current;
      const cacheKey = sheetTransformCacheKeyOf(activeSheet, currentAxis);
      const useCached = isPinned && sheetViews.length === 1 && !!cached && cached.key === cacheKey;
      const base = calculateViewportTransform(
        { minX: bounds.min.x, minY: bounds.min.y, maxX: bounds.max.x, maxY: bounds.max.y },
        sheetView,
        activeSheet
      );
      // The same axis corrections the canvas applies (#2940): the base
      // transform assumes a Y flip and no X flip, so a plan section landed
      // off-centre on paper and a side section off its edge.
      const drawingTransform = useCached && cached ? cached : {
        ...base,
        translateY: flipY ? base.translateY : base.translateY - (bounds.max.y + bounds.min.y) * base.scaleFactor,
        translateX: flipX ? base.translateX + (bounds.min.x + bounds.max.x) * base.scaleFactor : base.translateX,
      };

      const { translateX, translateY, scaleFactor } = drawingTransform;

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

      // Create clipping path for viewport FIRST (so it can be used by drawing content)
      svg += `  <defs>
      <clipPath id="viewport-clip-${sheetView.id}">
        <rect x="${viewport.x.toFixed(2)}" y="${viewport.y.toFixed(2)}" width="${viewport.width.toFixed(2)}" height="${viewport.height.toFixed(2)}"/>
      </clipPath>
    </defs>

  `;

      // Drawing content FIRST (so frame/title block render on top)
      svg += `  <g id="drawing-content" clip-path="url(#viewport-clip-${sheetView.id})">
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
            ifcType: polygon.ifcType, properties: getElementProperties(polygon.entityId),
          };
          const result = overrideEngine.applyOverrides(elementData);
          fillColor = result.style.fillColor;
          opacity = result.style.opacity;
        }

        const pathData = polygonToPath(polygon.polygon);
        if (pathData) {
          svg += `      <path d="${pathData}" fill="${escapeXml(fillColor)}" fill-opacity="${opacity.toFixed(2)}" fill-rule="evenodd" data-entity-id="${polygon.entityId}" data-ifc-type="${escapeXml(polygon.ifcType)}"/>\n`;
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
            ifcType: polygon.ifcType, properties: getElementProperties(polygon.entityId),
          };
          const result = overrideEngine.applyOverrides(elementData);
          strokeColor = result.style.strokeColor;
          lineWeight = result.style.lineWeight;
        }

        const pathData = polygonToPath(polygon.polygon);
        if (pathData) {
          // lineWeight is in mm on paper
          const svgLineWeight = lineWeight * 0.3; // Scale down for better appearance
          svg += `      <path d="${pathData}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${svgLineWeight.toFixed(4)}" data-entity-id="${polygon.entityId}"/>\n`;
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
        svg += `      <line x1="${paperStart.x.toFixed(4)}" y1="${paperStart.y.toFixed(4)}" x2="${paperEnd.x.toFixed(4)}" y2="${paperEnd.y.toFixed(4)}" stroke="${escapeXml(strokeColor)}" stroke-width="${svgLineWidth.toFixed(4)}"${dashAttr}/>\n`;
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
      if (principalScaleFactor === null) principalScaleFactor = scaleFactor;
    }

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
      effectiveScaleFactor: principalScaleFactor ?? 1,
    };
    // Correct the "Scale" field for a viewport-fit-clamped sheet (#2131's
    // defect class; see titleBlockScaleField.ts).
    const titleBlockResult = renderTitleBlock(
      titleBlockWithEffectiveScale(activeSheet.titleBlock, activeSheet.scale.factor, principalScaleFactor ?? 1),
      frameResult.innerBounds,
      activeSheet.revisions,
      titleBlockExtras
    );
    svg += titleBlockResult.svgElements;
    svg += '\n';

    svg += '</svg>';
    return svg;
  }, [drawing, activeSheet, displayOptions, activePresetId, entityColorMap, overridesEnabled, overrideEngine, dxfUnderlays, scanSection, sectionPlane.axis, isPinned, ifcDataStore, storeModels]);

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

    // Devices go over as SYMBOLS, not as the segments they used to be flattened
    // into. A CAD user receiving this can count the smoke detectors, group a
    // schedule by class and read the number the rule assigned — none of which a
    // pile of loose lines allows, however right it looks on paper. Openings
    // stay segments on purpose: an opening belongs to its wall and is not a
    // countable thing, so a block would claim more than is true.
    const markHalf = paperToModel(DEVICE_MARK_PAPER_MM) / 2;
    const dxfDevices = deviceMarks.map((mark) => ({
      position: mark.position,
      // The family is what one block stands for. `kind` is exactly that: the
      // symbol family the mark was drawn from, several IFC classes deep.
      family: mark.kind,
      paths: deviceMarkPaths(mark.kind),
      half: markHalf,
      tag: mark.tag,
      assetIdentifier: mark.assetIdentifier,
      ifcType: mark.ifcType,
      name: mark.name,
    }));

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
      plan: {
        labels: dxfLabels, symbolLines: dxfSymbolLines, rooms: dxfRooms, devices: dxfDevices,
      },
    });
    const stem = `section-${sectionPlane.axis}-${sectionPlane.position}`;
    downloadDxf(dxf, `${stem}.dxf`);
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

  // Export scaled PDF (issue #2042): a true-vector PDF sized so the
  // requested scale ("1:N") is EXACT — the page itself is sized to the
  // drawing extent + margin (via computePdfScaleLayout) rather than fit
  // into a fixed named paper size, so the scale can never be silently
  // shrunk to make the drawing fit (see pdf-scale.ts for why that matters).
  //
  // v1 scope, deliberately smaller than the SVG export: cut-polygon
  // OUTLINES and drawing LINES only (matching what an engineer actually
  // measures off a printed section). Not yet included: area fills /
  // hatching, DXF underlays, the drawing-sheet title block/frame/scale
  // bar, text/cloud annotations, and the point-cloud scan overlay. Those
  // are straightforward follow-ups once this scale plumbing is reviewed;
  // see the PR description.
  const handleExportPDF = useCallback((scaleFactor?: number) => {
    if (!drawing) return;

    // Drawing Sheet mode (#2941: frame/title block/scale bar missing from
    // the PDF; #2942: nothing in the PDF is to scale). Root cause for both:
    // this handler never checked `sheetEnabled`/`activeSheet` at all — it
    // always ran the raw-drawing "v1" path below, which lays the cut
    // geometry onto a page sized by `computePdfSectionLayout` (fit-to-page)
    // at `displayOptions.scale` (the on-screen "as displayed" scale), never
    // the sheet's own paper size (activeSheet.paper, see
    // generateSheetSVG at line ~567) or its own scale
    // (activeSheet.scale.factor, generateSheetSVG line ~576). SVG/DXF/Print
    // all branch on `sheetEnabled && activeSheet` (e.g. handleExportSVG
    // above); PDF alone didn't. Reuse the already-correct sheet SVG instead
    // of re-deriving a second sheet layout for jsPDF's vector primitives.
    //
    // THE TRADE-OFF THIS BRANCH MAKES, stated so the next reader does not
    // have to rediscover it by zooming into an exported sheet:
    //
    //   A sheet-mode PDF is a RASTER, not vector. It carries one PNG per
    //   page ({@link SHEET_PDF_DPI}, capped by MAX_SHEET_RASTER_PIXELS),
    //   so its text and lines are resolution-dependent and will pixelate
    //   under zoom or on a plotter finer than the effective dpi.
    //
    // Before this branch existed, sheet mode fell through to the v1 path
    // below and produced true-vector output — but of the wrong drawing:
    // no frame, no title block, no scale bar (#2941) and at
    // `displayOptions.scale` rather than the sheet's own (#2942). So the
    // choice was not "vector vs raster", it was "a resolution-independent
    // PDF that is not the sheet and is not to scale" vs "the correct sheet
    // at the correct scale, rasterized". Correctness won.
    //
    // Vector would require re-deriving the whole sheet — frame, title
    // block, scale bar, north arrow, and the drawing transform — against
    // jsPDF's own primitives, because no SVG-import plugin is installed
    // (apps/viewer depends on `jspdf` and `jspdf-autotable`; there is no
    // `svg2pdf.js`). That is a second, independent implementation of
    // `generateSheetSVG` that would then have to be kept in step with it —
    // exactly the drift the v1 path already demonstrated. It is a real
    // follow-up, not a hidden cost.
    //
    // The route for a user who needs vector today is the SVG export, which
    // is not an approximation of this: `handleExportSVG` above emits the
    // SAME `generateSheetSVG()` string, with no raster step at all. The
    // over-cap toast below already points there; this note records that
    // the recommendation applies to EVERY sheet PDF, not only capped ones.
    //
    // The non-sheet path below is untouched by any of this and stays true
    // vector — see `useDrawingExport.pdfVectorPaths.test.tsx`, which pins
    // both halves of that split.
    if (sheetEnabled && activeSheet) {
      const svg = generateSheetSVG();
      if (!svg) return;
      const { widthMm, heightMm } = activeSheet.paper;
      void (async () => {
        try {
          const { jsPDF } = await import('jspdf');
          const { dataUrl, fit } = await rasterizeSvgToPngDataUrl(svg, widthMm, heightMm);
          const doc = new jsPDF({
            unit: 'mm',
            format: [widthMm, heightMm],
            orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
          });
          // Full paper rectangle, deliberately NOT `fit.widthPx / dpi`: the
          // image must span the sheet whatever the raster cost, or a capped
          // export would print a smaller sheet at the same nominal scale.
          doc.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);

          if (fit.capped) {
            // FLOOR, not round: 299.53 dpi renders as "reduced from 300 to
            // 300" under rounding, which reads as a no-op notice, and
            // overstating the resolution delivered is the direction that
            // misleads.
            toast.info(
              `Sheet rasterized at ${Math.floor(fit.effectiveDpi)} dpi instead of ` +
              `${SHEET_PDF_DPI} — a ${Math.round(widthMm)}x${Math.round(heightMm)} mm sheet ` +
              `exceeds the browser's canvas limit at full resolution. Use the SVG export ` +
              `for a vector sheet at any size.`,
            );
          }

          const stem = `${sanitizeFilename(activeSheet.name, { fallback: 'sheet' })}-${sectionPlane.axis}-${sectionPlane.position}`;
          downloadFile(doc.output('blob'), `${stem}.pdf`, 'application/pdf');
          posthog.capture('drawing_exported', {
            format: 'pdf',
            axis: sectionPlane.axis,
            scale_factor: activeSheet.scale.factor,
            sheet_enabled: true,
            // What the SHEET got, not what was asked for — the same
            // distinction `PdfViewExportDialog` records as `shading_dpi`.
            raster_dpi: Math.floor(fit.effectiveDpi),
            raster_capped: fit.capped,
          });
        } catch (err) {
          // eslint-disable-next-line no-alert -- matches the raw-drawing PDF path's alert() below; a blocking alert is the existing convention for an export that FAILED, and toast.info here is only used for an export that succeeded in a degraded form.
          alert(err instanceof Error ? `Could not export PDF: ${err.message}` : 'Could not export PDF.');
        }
      })();
      return;
    }

    const effectiveScale = scaleFactor ?? displayOptions.scale ?? 100;

    // Axis-specific flipping, matching the SVG "as displayed" export above.
    // The layout (page size + offsets) MUST be derived from the bounds as
    // they are actually drawn (i.e. flipped), not the raw drawing bounds —
    // see pdfSectionLayout.ts module doc: deriving it from un-flipped bounds
    // only lands the drawing on the page when bounds happen to be symmetric
    // about zero, which is not the case for a model at ordinary world
    // coordinates (showstopper found on PR #2119).
    const currentAxis = sectionPlane.axis;
    let layout: PdfScaleLayout;
    try {
      layout = computePdfSectionLayout(drawing.bounds, currentAxis, effectiveScale, 10);
    } catch (err) {
      // eslint-disable-next-line no-alert -- matches handlePrint's popup-blocked alert below; this hook has no toast wiring.
      alert(err instanceof Error ? err.message : 'Could not export PDF: invalid scale.');
      return;
    }
    const mapPoint = makeSectionMapPoint(currentAxis, layout);

    void (async () => {
      try {
        const { jsPDF } = await import('jspdf');
        const { widthMm, heightMm } = layout.page;
        const doc = new jsPDF({
          unit: 'mm',
          format: [widthMm, heightMm],
          orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
        });

        doc.setDrawColor(0, 0, 0);
        doc.setLineCap('round');

        // Cut polygon outlines (outer ring + holes), stroke only.
        doc.setLineWidth(0.5);
        for (const polygon of drawing.cutPolygons) {
          const rings = [polygon.polygon.outer, ...polygon.polygon.holes];
          for (const ring of rings) {
            if (ring.length < 2) continue;
            const points = ring.map((p) => mapPoint(p.x, p.y));
            const deltas = points.slice(1).map((p, i) => [p.x - points[i].x, p.y - points[i].y]);
            doc.lines(deltas, points[0].x, points[0].y, [1, 1], 'S', true);
          }
        }

        // Entities actually covered by a cut-polygon outline above. Loop
        // reconstruction (`PolygonBuilder.buildLoops`) can fail for short,
        // degenerate, or ambiguous cross-sections and drop an entity's
        // `cutPolygons` entirely while `drawing.lines` still carries valid
        // `category: 'cut'` edges for that same entity (same source
        // `cutSegments`, but polygon-building is a separate, fallible
        // reconstruction, not a lockstep derivation — see #2119 review). Skip
        // cut-category lines ONLY for entities that a polygon outline
        // already covers; otherwise they are the sole remaining record of
        // that cut and must still be drawn, or the geometry silently
        // vanishes from the PDF.
        const entitiesWithCutPolygon = new Set(
          drawing.cutPolygons.map((p) => `${p.modelIndex}:${p.entityId}`)
        );

        // Drawing lines (projection/hidden/silhouette/crease/boundary).
        for (const line of drawing.lines) {
          if (
            line.category === 'cut' &&
            entitiesWithCutPolygon.has(`${line.modelIndex}:${line.entityId}`)
          ) {
            continue;
          }
          if (!displayOptions.showHiddenLines && line.visibility === 'hidden') continue;

          const { start, end } = line.line;
          if (!isFinite(start.x) || !isFinite(start.y) || !isFinite(end.x) || !isFinite(end.y)) continue;

          // Shared with the to-scale 3D-view PDF (#2042) so the two writers
          // cannot drift into two different line hierarchies.
          const { lineWidthMm, dash } = pdfLineStyleFor(line.category, line.visibility);

          const p0 = mapPoint(start.x, start.y);
          const p1 = mapPoint(end.x, end.y);
          doc.setLineWidth(lineWidthMm);
          doc.setLineDashPattern(dash, 0);
          doc.line(p0.x, p0.y, p1.x, p1.y);
        }
        doc.setLineDashPattern([], 0);

        // v1 has no title block, so this filename is the SOLE record of the
        // sheet's scale — round-tripping through Math.round() here would
        // file a 1:99.5 export as "…-1-100", silently misreporting it (same
        // defect class as PR #2131's title-block scale label). Reuse that
        // formatting (round to 2dp, strip trailing zeros) instead of
        // re-deriving it.
        const stem = `section-${sectionPlane.axis}-${sectionPlane.position}-1-${formatScaleFactorLabel(effectiveScale)}`;
        downloadFile(doc.output('blob'), `${stem}.pdf`, 'application/pdf');
        posthog.capture('drawing_exported', {
          format: 'pdf',
          axis: sectionPlane.axis,
          scale_factor: effectiveScale,
        });
      } catch (err) {
        // The dynamic `jspdf` import, PDF construction and download all run
        // in this async IIFE, outside the synchronous try/catch above (which
        // only guards the scale/layout arithmetic). A failed chunk load —
        // the most likely failure here — used to surface as an unhandled
        // promise rejection with no user feedback at all. Match the
        // synchronous path's alert() rather than fail silently.
        // eslint-disable-next-line no-alert -- matches the synchronous scale-validation alert above.
        alert(err instanceof Error ? `Could not export PDF: ${err.message}` : 'Could not export PDF.');
      }
    })();
  }, [drawing, displayOptions.scale, displayOptions.showHiddenLines, sectionPlane, sheetEnabled, activeSheet, generateSheetSVG]);

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
    handleExportPDF,
    handlePrint,
  };
}

export { useDrawingExport };
export default useDrawingExport;
