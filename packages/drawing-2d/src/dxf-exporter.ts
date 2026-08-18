/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DXF Exporter - Export 2D drawings to ASCII DXF (issue #1861)
 *
 * Mirrors `svg-exporter.ts`'s input contract (a `Drawing2D` plus reference
 * underlays) so the two exporters read the same generated-drawing model and
 * cannot drift: same polylines/edges, same hatch-boundary polygons, same
 * per-style layer/colour derivation.
 *
 * Unlike SVG, DXF has no "paper" concept — coordinates are written verbatim
 * in the drawing's own unit (metres) with no scale/padding transform. A
 * `Drawing2D` generated without a render-frame shift (the package-level
 * contract; see `svg-exporter.ts`'s underlay caveat) therefore round-trips
 * through this exporter unchanged. Callers that need real-world or
 * map-projected output (the viewer's georeferenced plan-section export)
 * supply `coordinateTransform`, applied to every point — drawing and
 * underlay alike — right before it reaches the writer.
 *
 * Output targets DXF R12 (AC1009) — see `dxf/writer.ts`'s module docs for
 * why (handles/subclass markers are mandatory from R13 on; R12 needs
 * neither and is the universal interop baseline). There is accordingly no
 * `$INSUNITS` header variable; the unit (always metres) is stated in a
 * `999` comment at the top of the file instead, optionally naming the
 * `IfcProjectedCRS` via `metadataComment`.
 */

import type { Drawing2D, DrawingLine, DrawingPolygon, LineCategory, Point2D } from './types.js';
import { getLineStyle, getHatchPattern } from './styles.js';
import { applyDxfPlacement } from './dxf/convert.js';
import { DEFAULT_DXF_PLACEMENT, type DxfPlacement, type DxfUnderlay } from './dxf/types.js';
import { DxfWriter, type DxfLinetype } from './dxf/writer.js';

export interface DXFExportOptions {
  /** Include lines whose `visibility === 'hidden'` (default true, matching SVG). */
  showHiddenLines?: boolean;
  /** Include cut-polygon boundaries (hatch regions, represented as closed POLYLINE boundaries — see module docs). Default true. */
  showHatching?: boolean;
  /** DXF reference underlays composited alongside the drawing (issue #1782 parity). */
  underlays?: DXFUnderlayOptions[];
  /**
   * Applied to every emitted point (drawing geometry and underlays alike)
   * as the very last step before it reaches the writer. Identity by
   * default. The viewer uses this to re-derive true world/map coordinates
   * for a plan-view export — see `apps/viewer/src/hooks/dxfExportGeoref.ts`.
   */
  coordinateTransform?: (p: Point2D) => Point2D;
  /**
   * `999` comment written at the top of the file (R12 has no `$INSUNITS`
   * to state the unit instead — see `dxf/writer.ts`). Defaults to a
   * generic "units: metres" note; pass one naming the `IfcProjectedCRS`
   * for a georeferenced export.
   */
  metadataComment?: string;
  /**
   * The plan overlays: room and door text, opening symbols, device marks,
   * room outlines.
   *
   * The SVG export has carried these since #50; DXF did not, so a plan handed
   * on as DXF arrived with walls and no writing on them. They are an option
   * rather than read off the drawing because they are DERIVED — the viewer
   * computes them per storey, and the drawing itself knows nothing about them.
   */
  plan?: DXFPlanOverlays;
}

/** A room outline, with the two facts a plan reader wants about it. */
export interface DXFRoomPolygon {
  readonly outline: readonly Point2D[];
  /** Room number — `Name` on the IfcSpace. */
  readonly number?: string;
  /** Room designation — `LongName` on the IfcSpace. */
  readonly name?: string;
}

/** One line of plan text, already positioned in drawing coordinates. */
export interface DXFPlanText {
  readonly position: Point2D;
  readonly text: string;
  /** Cap height in drawing units. */
  readonly height: number;
}

export interface DXFPlanOverlays {
  /** Room and door labels, one entry per LINE of text. */
  readonly labels?: readonly DXFPlanText[];
  /** Opening symbols and device marks, as loose segments. */
  readonly symbolLines?: readonly { readonly start: Point2D; readonly end: Point2D }[];
  /** Room outlines, carrying number and name as XDATA. */
  readonly rooms?: readonly DXFRoomPolygon[];
}

/** One DXF reference underlay to embed (mirrors `SVGUnderlayOptions`). */
export interface DXFUnderlayOptions {
  underlay: DxfUnderlay;
  /** Placement in drawing space; identity when omitted. */
  placement?: DxfPlacement;
  /** Per-layer visibility override; falls back to the DXF layer's own state. */
  layerVisibility?: Record<string, boolean>;
}

const CATEGORY_LAYER: Record<LineCategory, string> = {
  cut: 'IFC-CUT',
  projection: 'IFC-PROJECTION',
  hidden: 'IFC-HIDDEN',
  silhouette: 'IFC-SILHOUETTE',
  crease: 'IFC-CREASE',
  boundary: 'IFC-BOUNDARY',
  annotation: 'IFC-ANNOTATION',
};
const FILL_LAYER = 'IFC-FILL';

/** Builds a DXF document from a `Drawing2D`, mirroring `SVGExporter`. */
/** Layer + APPID names for the plan overlays. */
const ROOM_LAYER = 'IFCLITE-RAUM';
const ROOM_COLOR = '#00A0A0';
const SYMBOL_LAYER = 'IFCLITE-SYMBOL';
const SYMBOL_COLOR = '#404040';
const LABEL_LAYER = 'IFCLITE-TEXT';
const LABEL_COLOR = '#000000';
/**
 * The application name the room XDATA hangs under.
 *
 * One name for the tool rather than one per field: a reader looking for
 * "who wrote this" wants the producer, and the two strings are positional
 * (number, then designation) under it.
 */
const ROOM_APPID = 'IFCLITE';

export class DXFExporter {
  export(drawing: Drawing2D, options: DXFExportOptions = {}): string {
    const {
      showHiddenLines = true,
      showHatching = true,
      underlays = [],
      coordinateTransform = (p: Point2D) => p,
      metadataComment,
      plan,
    } = options;

    const writer = new DxfWriter({ headerComment: metadataComment });
    const map = (p: Point2D): Point2D => coordinateTransform(p);

    // Layer per line category, DASHED linetype for the hidden layer only —
    // matches how SVGExporter groups its <g> layers. Lines whose
    // `visibility` is 'hidden' are routed onto the hidden layer regardless
    // of category — see writeLine.
    const categoryLayers = new Map<LineCategory, string>();
    for (const [category, name] of Object.entries(CATEGORY_LAYER) as [LineCategory, string][]) {
      const linetype: DxfLinetype = category === 'hidden' ? 'DASHED' : 'CONTINUOUS';
      categoryLayers.set(category, writer.layer(name, getLineStyle(category).color, linetype));
    }
    const fillLayer = writer.layer(FILL_LAYER, '#666666');

    // Hatching first (bottom-most, like SVGExporter's hatching layer).
    if (showHatching) {
      for (const polygon of drawing.cutPolygons) {
        this.writePolygonBoundary(writer, polygon, fillLayer, map);
      }
    }

    // Underlays beneath the drawing lines (SVGExporter renders them first too).
    for (const underlayOptions of underlays) {
      this.writeUnderlay(writer, underlayOptions, map);
    }

    for (const line of drawing.lines) {
      if (!showHiddenLines && line.visibility === 'hidden') continue;
      this.writeLine(writer, line, categoryLayers, map);
    }

    if (plan) this.writePlanOverlays(writer, plan, map);

    return writer.toString();
  }

  /**
   * The plan overlays, each on its own layer.
   *
   * Separate layers because that is the one thing every CAD user does with a
   * received drawing: turn parts of it off. Room outlines, writing and
   * symbols are three different decisions.
   */
  private writePlanOverlays(
    writer: DxfWriter,
    plan: DXFPlanOverlays,
    map: (p: Point2D) => Point2D,
  ): void {
    const rooms = plan.rooms ?? [];
    if (rooms.length > 0) {
      const layer = writer.layer(ROOM_LAYER, ROOM_COLOR);
      for (const room of rooms) {
        if (room.outline.length < 3) continue;
        const number = (room.number ?? '').trim();
        const name = (room.name ?? '').trim();
        // XDATA only where there is something to say. An APPID declared for
        // a file whose rooms are all nameless would be a table entry that
        // points at nothing.
        const xdata = number || name
          ? { appId: ROOM_APPID, strings: [number, name] }
          : undefined;
        writer.addPolyline(room.outline.map(map), layer, true, undefined, xdata);
      }
    }

    const symbolLines = plan.symbolLines ?? [];
    if (symbolLines.length > 0) {
      const layer = writer.layer(SYMBOL_LAYER, SYMBOL_COLOR);
      for (const line of symbolLines) {
        writer.addLine(map(line.start), map(line.end), layer);
      }
    }

    const labels = plan.labels ?? [];
    if (labels.length > 0) {
      const layer = writer.layer(LABEL_LAYER, LABEL_COLOR);
      for (const label of labels) {
        // Centred, matching where the viewer anchors a room stamp.
        writer.addText(map(label.position), label.text, label.height, layer, {
          hAlign: 'center', vAlign: 'middle',
        });
      }
    }
  }

  private writeLine(
    writer: DxfWriter,
    line: DrawingLine,
    categoryLayers: Map<LineCategory, string>,
    map: (p: Point2D) => Point2D,
  ): void {
    // Visibility wins over category (PR #1871 review, P2): hidden-line
    // removal / construction projection can mark e.g. a `projection` line
    // `visibility: 'hidden'`. Mapping by category alone would land it on the
    // CONTINUOUS `IFC-PROJECTION` layer and occluded/overhead edges would
    // read as solid in CAD. Mirror `exportToSVG`'s hidden-lines grouping
    // (and the viewer canvas's dashed override): every `visibility ===
    // 'hidden'` line joins the DASHED `IFC-HIDDEN` layer with the hidden
    // line style. No new layer/LTYPE names — `IFC-HIDDEN` and `DASHED` are
    // already declared in TABLES, so the output stays R12-legal.
    const styleCategory: LineCategory = line.visibility === 'hidden' ? 'hidden' : line.category;
    const layer = categoryLayers.get(styleCategory);
    if (!layer) return;
    const style = getLineStyle(styleCategory, line.ifcType);
    const start = map(line.line.start);
    const end = map(line.line.end);
    writer.addLine(start, end, layer, style.color);
  }

  private writePolygonBoundary(
    writer: DxfWriter,
    polygon: DrawingPolygon,
    layer: string,
    map: (p: Point2D) => Point2D,
  ): void {
    const pattern = getHatchPattern(polygon.ifcType);
    if (pattern.type === 'none') return;
    const outer = polygon.polygon.outer.map(map);
    writer.addPolyline(outer, layer, true, pattern.strokeColor);
    for (const hole of polygon.polygon.holes) {
      writer.addPolyline(hole.map(map), layer, true, pattern.strokeColor);
    }
  }

  private writeUnderlay(
    writer: DxfWriter,
    options: DXFUnderlayOptions,
    map: (p: Point2D) => Point2D,
  ): void {
    const { underlay, placement = DEFAULT_DXF_PLACEMENT, layerVisibility = {} } = options;
    // Underlay points are already in world plan coordinates (metres, +Y
    // north) — the same convention DXF itself uses, so (unlike SVG, which
    // is +Y down) no sign flip is needed before the placement transform.
    const mapPoint = (p: Point2D): Point2D => map(applyDxfPlacement(p, placement));
    const underlayPrefix = `DXF_${underlay.name}`;

    for (const dxfLayer of underlay.layers) {
      const visible = layerVisibility[dxfLayer.name] ?? dxfLayer.visible;
      if (!visible) continue;
      const layer = writer.layer(`${underlayPrefix}_${dxfLayer.name}`, dxfLayer.color);

      for (const fill of dxfLayer.fills) {
        const outer = fill.polygon.outer.map(mapPoint);
        writer.addPolyline(outer, layer, true, fill.color);
        for (const hole of fill.polygon.holes) {
          writer.addPolyline(hole.map(mapPoint), layer, true, fill.color);
        }
      }

      for (const path of dxfLayer.paths) {
        if (path.points.length < 2) continue;
        writer.addPolyline(path.points.map(mapPoint), layer, path.closed, path.color);
      }

      for (const text of dxfLayer.texts) {
        if (!text.text.trim()) continue;
        const anchor = mapPoint(text.position);
        const tip = mapPoint({ x: text.position.x + text.dirX, y: text.position.y + text.dirY });
        const angle = (Math.atan2(tip.y - anchor.y, tip.x - anchor.x) * 180) / Math.PI;
        // Placement scales the geometry through mapPoint; the glyph height
        // must follow or labels detach from their linework (same rule as
        // SVGExporter's underlay text).
        const height = text.height * placement.scale;
        const lines = text.text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          // Stack subsequent lines by offsetting in LOCAL space, then map:
          // the stacking direction must rotate with the text when
          // placement.rotationDeg is non-zero or coordinateTransform itself
          // rotates (georeferenced rotated grid) — exactly like
          // SVGExporter's rotate() wrapper around its tspan stack. An
          // output-space `anchor.y - offset` would shift lines straight
          // down regardless of the text's actual direction (PR #1871
          // review).
          const lineAnchor = i === 0
            ? anchor
            : mapPoint({ x: text.position.x, y: text.position.y - i * text.height * 1.3 });
          writer.addText(
            lineAnchor,
            lines[i],
            height,
            layer,
            { rotationDeg: angle, hAlign: text.align, vAlign: text.valign, colorOverride: text.color },
          );
        }
      }
    }
  }
}

/** Export a `Drawing2D` to an ASCII DXF string. */
export function exportToDXF(drawing: Drawing2D, options?: DXFExportOptions): string {
  return new DXFExporter().export(drawing, options);
}
