/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ASCII DXF writer (issue #1861): the counterpart to `parser.ts` (DXF
 * import, #1782). Produces DXF R12 (AC1009) text — HEADER, TABLES (LTYPE,
 * STYLE, LAYER), ENTITIES — from generic entities (POLYLINE/VERTEX/SEQEND,
 * LINE, TEXT) with a layer name and colour, so any CAD/BIM tool that reads
 * plain ASCII DXF can open the result.
 *
 * R12 is deliberate, not a placeholder: entity handles (group 5) and
 * subclass markers (group 100, e.g. `AcDbEntity`/`AcDbPolyline`) are
 * MANDATORY from R13 onward, and a genuinely valid R2000+ file additionally
 * needs a BLOCK_RECORD table, `*Model_Space`/`*Paper_Space` BLOCKS, and an
 * OBJECTS section with the root dictionary — none of which this writer
 * produces. Declaring a later `$ACADVER` while omitting all of that would
 * make the file reject or force-repair in strict readers (AutoCAD,
 * ODA/Teigha-based BIM tools). R12 requires none of it and is the universal
 * interop baseline every DXF-capable tool still reads; a full R2000+
 * skeleton (handles, subclass markers, BLOCK_RECORD, paper space, OBJECTS)
 * is a possible follow-up, not this writer's job.
 *
 * Consequences of the R12 target:
 *  - No `$INSUNITS` header variable (introduced in R14) — the exported
 *    unit (always metres) is instead stated in a `999` comment at the very
 *    top of the file (valid in every DXF version, ignored by every reader).
 *  - `LWPOLYLINE` doesn't exist until R14 either; polylines are written as
 *    classic `POLYLINE` + `VERTEX`* + `SEQEND`.
 *  - No group 5 (handle) or group 100 (subclass marker) anywhere in this
 *    file — `writer.test.ts` asserts that invariant so a future edit can't
 *    reintroduce a half-upgraded, invalid hybrid. The same goes for LTYPE
 *    group 74 (complex-linetype element type, R13+): R12 linetype patterns
 *    are plain `49` dash lengths only.
 *  - Symbol (layer) names follow the R12 rules: at most 31 characters from
 *    `A-Z a-z 0-9 $ - _` — see {@link sanitizeDxfLayerName}. Distinct
 *    source names that collide after sanitizing get a numeric suffix so
 *    they never silently merge into one layer.
 *  - TABLES carries LTYPE, STYLE (the `STANDARD` text style every TEXT
 *    entity implicitly references), and LAYER. VPORT/VIEW/UCS/APPID/
 *    DIMSTYLE are optional in R12 (readers create defaults) and are
 *    omitted.
 *
 * Coordinates are written verbatim in the caller's unit (drawing metres);
 * see `dxf-exporter.ts` for how the viewer maps its render-frame
 * coordinates into true world/map metres before they reach this writer.
 */

import { cssToAci } from './aci-colors.js';
import type { Point2D } from '../types.js';

/** Line style resolved to a DXF linetype. `dashed` maps to the `DASHED` LTYPE. */
export type DxfLinetype = 'CONTINUOUS' | 'DASHED';

/** Horizontal text justification (subset of DXF group 72). */
export type DxfTextHAlign = 'left' | 'center' | 'right';
/** Vertical text justification (subset of DXF group 73). */
export type DxfTextVAlign = 'baseline' | 'bottom' | 'middle' | 'top';

interface DxfLayerRecord {
  /** Sanitized, DXF-safe layer name (used as the table key and entity group 8). */
  name: string;
  aci: number;
  linetype: DxfLinetype;
}

const H_ALIGN_CODE: Record<DxfTextHAlign, number> = { left: 0, center: 1, right: 2 };
const V_ALIGN_CODE: Record<DxfTextVAlign, number> = { baseline: 0, bottom: 1, middle: 2, top: 3 };

/** Default `999` comment prepended to the file (states units — R12 has no `$INSUNITS`). */
const DEFAULT_HEADER_COMMENT = 'ifc-lite section export - units: metres';

/**
 * R12 symbol (table-entry) names allow only letters, digits, `$`, `-` and
 * `_` — anything else (unicode, spaces, punctuation) must be replaced.
 * Later DXF versions relax this, but this writer targets R12 (see module
 * docs), so it enforces the strict R12 set.
 */
const INVALID_LAYER_CHARS = /[^A-Za-z0-9$_-]/g;

/** R12 symbol names are limited to 31 characters (255 is an R2000+ limit). */
const MAX_LAYER_NAME_LENGTH = 31;

/**
 * True for an ASCII control character (C0 range or DEL) — these are never
 * legal inside a DXF layer name or TEXT string. Written as a codepoint
 * comparison rather than a control-character regex literal (`\x00`-`\x1f`)
 * so the disallowed bytes never appear as raw source text.
 */
function isControlCharCode(code: number): boolean {
  return code <= 31 || code === 127;
}

function stripControlChars(text: string, replacement: string): string {
  let out = '';
  for (const ch of text) {
    out += isControlCharCode(ch.codePointAt(0) ?? 0) ? replacement : ch;
  }
  return out;
}

/**
 * Sanitize a free-text label into a valid DXF R12 LAYER name: every
 * character outside the R12 symbol-name set (`A-Z a-z 0-9 $ - _` — spaces,
 * unicode and punctuation included) becomes `_`, runs of `_` produced by
 * adjacent replacements are collapsed, the result is made non-empty, and
 * truncated to the R12 31-character symbol-name limit.
 *
 * Distinct inputs can collide after this mapping (`Wände`/`Wønde` →
 * `W_nde`); {@link DxfWriter.layer} disambiguates with a numeric suffix so
 * two source layers never silently merge.
 */
export function sanitizeDxfLayerName(name: string): string {
  const stripped = name.replace(INVALID_LAYER_CHARS, '_').replace(/_{2,}/g, '_');
  const trimmed = stripped.replace(/^_+|_+$/g, '') || stripped;
  const safe = trimmed.length > 0 ? trimmed : 'LAYER';
  return safe.slice(0, MAX_LAYER_NAME_LENGTH);
}

/** Sanitize a single line of DXF TEXT content: strip control characters (no raw newlines). */
function sanitizeDxfText(text: string): string {
  return stripControlChars(text, ' ');
}

/** Sanitize a `999` comment line: no raw newlines/control characters. */
function sanitizeDxfComment(text: string): string {
  return stripControlChars(text, ' ');
}

function fmt(n: number): string {
  // Non-finite input stays deterministic ('0.0'); the condition is surfaced
  // to the caller via DxfWriter.extend()'s once-per-document console.warn.
  if (!Number.isFinite(n)) return '0.0';
  // Fixed precision keeps output deterministic (stable for golden/round-trip
  // tests) while giving sub-micrometre resolution at metre scale.
  return n.toFixed(6);
}

/**
 * Extended entity data — the DXF way to hang facts on a piece of geometry.
 *
 * A room polygon that is only a closed outline tells a reader where the room
 * is and nothing about which room it is. XDATA is what every serious DXF
 * reader (AutoCAD, BricsCAD, ODA) preserves and round-trips, so the room
 * number and name survive being opened and saved again — unlike a layer name,
 * which is the only other place people try to smuggle this and which collapses
 * as soon as two rooms share a layer.
 *
 * Strings are written as group 1000 in the order given. DXF caps a 1000 at 255
 * bytes; longer values are truncated rather than producing a file that some
 * readers reject and others silently mangle.
 */
export interface DxfXdata {
  /** Registered application name. Also declared in the APPID table. */
  readonly appId: string;
  readonly strings: readonly string[];
}

interface EntityWrite {
  (): string;
}

/** One field a block placement fills in — what a CAD schedule groups by. */
export interface DxfBlockAttribute {
  /** The tag a schedule groups by. Uppercase by convention; never translated. */
  readonly tag: string;
  /** Where the value sits, relative to the block's origin. */
  readonly offset: Point2D;
  /** Cap height in drawing units. */
  readonly height: number;
  /** Carried for machines rather than for the eye. */
  readonly invisible?: boolean;
}

/** A symbol defined once and placed many times. */
export interface DxfBlockDefinition {
  /** Straight segments in the block's own coordinates, around its origin. */
  readonly lines: readonly { readonly start: Point2D; readonly end: Point2D }[];
  /** Closed polylines in the same coordinates — a detector's circle, sampled. */
  readonly polylines?: readonly (readonly Point2D[])[];
  readonly attributes?: readonly DxfBlockAttribute[];
}

export interface DxfWriterOptions {
  /**
   * `999` comment written at the very top of the file, before the HEADER
   * section (valid DXF in every version; the conventional place to state
   * metadata a reader should show a human but never needs to parse — here,
   * the unit R12 can't declare via `$INSUNITS`). Defaults to a generic
   * "units: metres" note; pass a longer string (e.g. including the
   * `IfcProjectedCRS` name) for a georeferenced export.
   */
  headerComment?: string;
}

/**
 * Accumulates DXF entities and layer definitions, then assembles the full
 * ASCII DXF R12 (AC1009) document text. One writer instance == one DXF
 * file; layers are registered on first use (`addPolyline`/`addLine`/
 * `addText`) via a CSS colour, resolved to the nearest ACI with
 * {@link cssToAci}.
 */
export class DxfWriter {
  private readonly layers = new Map<string, DxfLayerRecord>();
  /** Raw (pre-sanitization) name → assigned safe name, for stable reuse + collision disambiguation. */
  private readonly layerNameBySource = new Map<string, string>();
  private readonly entities: EntityWrite[] = [];
  /** APPIDs referenced by XDATA, declared in TABLES so strict readers accept it. */
  private readonly appIds = new Set<string>();
  /** Block name to its geometry and attribute definitions, written to BLOCKS. */
  private readonly blocks = new Map<string, DxfBlockDefinition>();
  private readonly headerComment: string;
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;
  /** One warning per document for non-finite input coordinates — see extend(). */
  private warnedNonFinite = false;

  constructor(options: DxfWriterOptions = {}) {
    this.headerComment = sanitizeDxfComment(options.headerComment ?? DEFAULT_HEADER_COMMENT);
  }

  private extend(p: Point2D): void {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      // A bad upstream coordinate (e.g. a pathological georeference scale)
      // would otherwise vanish silently: NaN fails every comparison below, so
      // it never extends $EXTMIN/$EXTMAX, and fmt() writes it as a
      // deterministic 0.0. Keep both behaviours (the file stays valid and
      // reproducible) but surface the problem — once per document, not per
      // vertex, so a fully-degenerate polyline can't spam the console.
      if (!this.warnedNonFinite) {
        this.warnedNonFinite = true;
        console.warn(
          `[DxfWriter] non-finite coordinate (${p.x}, ${p.y}) — written as 0.0 and excluded from $EXTMIN/$EXTMAX (further occurrences in this document are not logged)`,
        );
      }
      return;
    }
    if (p.x < this.minX) this.minX = p.x;
    if (p.x > this.maxX) this.maxX = p.x;
    if (p.y < this.minY) this.minY = p.y;
    if (p.y > this.maxY) this.maxY = p.y;
  }

  /**
   * Register (or reuse) a layer. Returns the sanitized layer name to pass to
   * `addPolyline`/`addLine`/`addText`. Re-registering the same source name
   * with a different colour/linetype is a no-op (first registration wins) —
   * callers should derive one style per logical layer. DIFFERENT source
   * names whose sanitized forms collide (`Wände`/`Wønde` → `W_nde`) get a
   * numeric suffix (`W_nde`, `W_nde_2`, …) instead of silently merging onto
   * one layer.
   */
  layer(name: string, cssColor: string, linetype: DxfLinetype = 'CONTINUOUS'): string {
    const assigned = this.layerNameBySource.get(name);
    if (assigned !== undefined) return assigned;
    const base = sanitizeDxfLayerName(name);
    let safe = base;
    for (let n = 2; this.layers.has(safe); n++) {
      const suffix = `_${n}`;
      safe = base.slice(0, MAX_LAYER_NAME_LENGTH - suffix.length) + suffix;
    }
    this.layers.set(safe, { name: safe, aci: cssToAci(cssColor), linetype });
    this.layerNameBySource.set(name, safe);
    return safe;
  }

  /** `62\n<aci>\n` when an entity overrides its layer's colour, else ''. */
  private colorOverrideGroup(cssColor: string | undefined): string {
    return cssColor !== undefined ? '62\n' + cssToAci(cssColor) + '\n' : '';
  }

  /**
   * Register an application name for XDATA and return its sanitized form.
   *
   * R12 lets readers invent missing tables, but an APPID referenced by XDATA
   * and absent from TABLES is the one case strict readers do reject — so it is
   * declared rather than assumed.
   */
  appId(name: string): string {
    const safe = sanitizeDxfLayerName(name);
    this.appIds.add(safe);
    return safe;
  }

  /** `1001`/`1000` groups for one entity, or `` when there is nothing to say. */
  private xdataGroups(xdata?: DxfXdata): string {
    if (!xdata) return '';
    const safe = this.appId(xdata.appId);
    let s = '1001\n' + safe + '\n';
    for (const value of xdata.strings) {
      const clean = sanitizeDxfText(value).slice(0, 255);
      if (clean) s += '1000\n' + clean + '\n';
    }
    return s;
  }

  /**
   * Add a closed or open polyline (tessellated arcs/circles are pre-sampled
   * by the caller), written as classic `POLYLINE` + `VERTEX`* + `SEQEND` —
   * `LWPOLYLINE` does not exist before R14. `colorOverride` (CSS colour)
   * emits a per-entity ACI (group 62) on the POLYLINE header instead of
   * inheriting the layer colour — used when several IFC types share one
   * category layer but render with distinct colours in the source drawing
   * (matching the SVG exporter's per-entity fill/stroke).
   */
  addPolyline(
    points: readonly Point2D[],
    layer: string,
    closed: boolean,
    colorOverride?: string,
    xdata?: DxfXdata,
  ): void {
    if (points.length < 2) return;
    for (const p of points) this.extend(p);
    const pts = points.slice();
    const colorGroup = this.colorOverrideGroup(colorOverride);
    // Resolved now rather than inside the closure: registering the APPID has
    // to happen before TABLES is written, and the closures run after it.
    const xdataGroups = this.xdataGroups(xdata);
    this.entities.push(() => {
      // The 10/20/30 "dummy point" (always 0) is part of the R12 POLYLINE
      // entity — the real coordinates live on the VERTEX chain.
      let s =
        '0\nPOLYLINE\n8\n' + layer + '\n' + colorGroup +
        '66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n' + (closed ? 1 : 0) + '\n' + xdataGroups;
      for (const p of pts) {
        s += '0\nVERTEX\n8\n' + layer + '\n10\n' + fmt(p.x) + '\n20\n' + fmt(p.y) + '\n30\n0.0\n';
      }
      s += '0\nSEQEND\n8\n' + layer + '\n';
      return s;
    });
  }

  /**
   * Define a symbol, once, for `addInsert` to place many times.
   *
   * A symbol placed as a block is a thing CAD can count, swap and schedule; the
   * same shape written as loose lines is a scribble that happens to look like a
   * detector. For a fire-detection plan that is the difference between a
   * drawing somebody can work from and a picture of one.
   *
   * Re-defining a name is a no-op — first definition wins — so a caller may
   * define lazily on every placement without checking.
   *
   * Geometry is in the block's own coordinates, around its origin.
   * `attributes` are the fields each placement fills in: the `tag` is what a
   * CAD schedule groups by, and the offset is relative to that origin.
   */
  defineBlock(name: string, definition: DxfBlockDefinition): string {
    const safe = sanitizeDxfLayerName(name);
    if (!this.blocks.has(safe)) this.blocks.set(safe, definition);
    return safe;
  }

  /**
   * Place a defined block, with values for its attributes.
   *
   * An `INSERT` naming a block the file does not define is the one thing every
   * reader rejects, so an unknown name is refused here rather than written —
   * the alternative is a file that opens as an error dialogue.
   */
  addInsert(
    blockName: string,
    position: Point2D,
    layer: string,
    options: {
      rotationDeg?: number;
      scale?: number;
      /** Attribute tag to value, for the tags the block defines. */
      values?: Readonly<Record<string, string>>;
      colorOverride?: string;
      xdata?: DxfXdata;
    } = {},
  ): void {
    const definition = this.blocks.get(blockName);
    if (!definition) return;
    this.extend(position);
    const rotationDeg = options.rotationDeg ?? 0;
    const requested = options.scale ?? 1;
    const scale = Number.isFinite(requested) && requested > 0 ? requested : 1;
    const colorGroup = this.colorOverrideGroup(options.colorOverride);
    const xdataGroups = this.xdataGroups(options.xdata);
    const attributes = definition.attributes ?? [];
    const values = options.values ?? {};
    this.entities.push(() => {
      // 66/1 says attributes follow; without it a reader stops at the INSERT
      // and the values are lost while the file still looks perfectly valid.
      const hasAttributes = attributes.length > 0;
      let s =
        '0\nINSERT\n8\n' + layer + '\n' + colorGroup +
        (hasAttributes ? '66\n1\n' : '') +
        '2\n' + blockName + '\n' +
        '10\n' + fmt(position.x) + '\n20\n' + fmt(position.y) + '\n30\n0.0\n' +
        '41\n' + fmt(scale) + '\n42\n' + fmt(scale) + '\n43\n' + fmt(scale) + '\n' +
        '50\n' + fmt(rotationDeg) + '\n' + xdataGroups;
      for (const attribute of attributes) {
        const value = sanitizeDxfText(values[attribute.tag] ?? '').slice(0, 255);
        s +=
          '0\nATTRIB\n8\n' + layer + '\n' +
          '10\n' + fmt(position.x + attribute.offset.x) + '\n' +
          '20\n' + fmt(position.y + attribute.offset.y) + '\n30\n0.0\n' +
          '40\n' + fmt(attribute.height) + '\n' +
          '1\n' + value + '\n' +
          '2\n' + attribute.tag + '\n' +
          // 70 flags: 1 = invisible. A tag carried for machines rather than
          // for the eye is marked invisible instead of being left off — a
          // schedule reads it either way, and a plan should not print it.
          '70\n' + (attribute.invisible ? 1 : 0) + '\n';
      }
      if (hasAttributes) s += '0\nSEQEND\n8\n' + layer + '\n';
      return s;
    });
  }

  /** Add a single straight segment. `colorOverride`: see {@link addPolyline}. */
  addLine(start: Point2D, end: Point2D, layer: string, colorOverride?: string): void {
    this.extend(start);
    this.extend(end);
    const colorGroup = this.colorOverrideGroup(colorOverride);
    this.entities.push(
      () =>
        '0\nLINE\n8\n' + layer + '\n' + colorGroup +
        '10\n' + fmt(start.x) + '\n20\n' + fmt(start.y) + '\n30\n0.0\n' +
        '11\n' + fmt(end.x) + '\n21\n' + fmt(end.y) + '\n31\n0.0\n',
    );
  }

  /**
   * Add single-line text. Multiline callers (annotations/MTEXT) should split
   * on `\n` and call this once per line, offsetting `position` themselves
   * (matching the SVG exporter's tspan stacking) — DXF `TEXT` group 1 is a
   * single line. `colorOverride`: see {@link addPolyline}.
   */
  addText(
    position: Point2D,
    text: string,
    height: number,
    layer: string,
    options: {
      rotationDeg?: number;
      hAlign?: DxfTextHAlign;
      vAlign?: DxfTextVAlign;
      colorOverride?: string;
    } = {},
  ): void {
    const clean = sanitizeDxfText(text);
    // `height <= 0` alone lets NaN/Infinity through (both compare false), and
    // `fmt` would then write them as the deterministic '0.0' fallback — i.e. a
    // zero-height, invisible TEXT entity, exactly what the guard exists to
    // skip. Reject non-finite heights outright instead.
    if (!clean.trim() || !Number.isFinite(height) || height <= 0) return;
    this.extend(position);
    const rotationDeg = options.rotationDeg ?? 0;
    const hAlign = options.hAlign ?? 'left';
    const vAlign = options.vAlign ?? 'baseline';
    const hCode = H_ALIGN_CODE[hAlign];
    const vCode = V_ALIGN_CODE[vAlign];
    const needsAlignPoint = hCode !== 0 || vCode !== 0;
    const colorGroup = this.colorOverrideGroup(options.colorOverride);
    this.entities.push(() => {
      let s =
        '0\nTEXT\n8\n' + layer + '\n' + colorGroup +
        '10\n' + fmt(position.x) + '\n20\n' + fmt(position.y) + '\n30\n0.0\n' +
        '40\n' + fmt(height) + '\n1\n' + clean + '\n' +
        '50\n' + fmt(rotationDeg) + '\n' +
        '72\n' + hCode + '\n' +
        '73\n' + vCode + '\n';
      if (needsAlignPoint) {
        s += '11\n' + fmt(position.x) + '\n21\n' + fmt(position.y) + '\n31\n0.0\n';
      }
      return s;
    });
  }

  /** True once at least one finite point has been written (controls $EXTMIN/$EXTMAX). */
  private hasExtents(): boolean {
    return Number.isFinite(this.minX) && Number.isFinite(this.maxX);
  }

  private buildHeader(): string {
    const [minX, minY, maxX, maxY] = this.hasExtents()
      ? [this.minX, this.minY, this.maxX, this.maxY]
      : [0, 0, 0, 0];
    // R12 (AC1009): no $INSUNITS (introduced R14) — see the `999` comment
    // this.toString() prepends ahead of this section instead.
    return (
      '0\nSECTION\n2\nHEADER\n' +
      '9\n$ACADVER\n1\nAC1009\n' +
      '9\n$EXTMIN\n10\n' + fmt(minX) + '\n20\n' + fmt(minY) + '\n30\n0.0\n' +
      '9\n$EXTMAX\n10\n' + fmt(maxX) + '\n20\n' + fmt(maxY) + '\n30\n0.0\n' +
      '0\nENDSEC\n'
    );
  }

  private buildLtypeTable(): string {
    let s = '0\nTABLE\n2\nLTYPE\n70\n2\n';
    s += '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n';
    // Dash 0.2, gap 0.1 (metres) — a reasonable default at typical drawing
    // scale. R12 pattern elements are plain `49` lengths; group 74
    // (complex-linetype element type) is an R13+ construct and must NOT
    // appear here.
    s +=
      '0\nLTYPE\n2\nDASHED\n70\n0\n3\nDashed line\n72\n65\n73\n2\n40\n0.3\n' +
      '49\n0.2\n49\n-0.1\n';
    s += '0\nENDTAB\n';
    return s;
  }

  /**
   * STYLE table with the single `STANDARD` text style. Every TEXT entity
   * this writer emits carries no group 7 and therefore implicitly
   * references STANDARD; defining it keeps strict R12 readers from having
   * to invent it. (Fixed-height 0, width factor 1, `txt` font — the
   * classic defaults.)
   */
  private buildStyleTable(): string {
    return (
      '0\nTABLE\n2\nSTYLE\n70\n1\n' +
      '0\nSTYLE\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n0.2\n3\ntxt\n4\n\n' +
      '0\nENDTAB\n'
    );
  }

  /**
   * APPID table — one entry per application name any XDATA references.
   *
   * Emitted only when there IS XDATA. R12 readers happily invent most missing
   * tables, but an APPID that XDATA points at and TABLES does not declare is
   * the case strict ones reject — so the file stays exactly as it was for
   * every drawing that carries none.
   */
  private buildAppIdTable(): string {
    if (this.appIds.size === 0) return '';
    let s = '0\nTABLE\n2\nAPPID\n70\n' + this.appIds.size + '\n';
    for (const name of this.appIds) s += '0\nAPPID\n2\n' + name + '\n70\n0\n';
    return s + '0\nENDTAB\n';
  }

  private buildLayerTable(): string {
    let s = '0\nTABLE\n2\nLAYER\n70\n' + this.layers.size + '\n';
    for (const l of this.layers.values()) {
      s += '0\nLAYER\n2\n' + l.name + '\n70\n0\n62\n' + l.aci + '\n6\n' + l.linetype + '\n';
    }
    s += '0\nENDTAB\n';
    return s;
  }

  private buildTables(): string {
    // LTYPE before LAYER (layers reference linetypes by name); STYLE for
    // the implicit STANDARD text style. VPORT/VIEW/UCS/APPID/DIMSTYLE are
    // optional in R12 — readers supply defaults — and are omitted.
    return (
      '0\nSECTION\n2\nTABLES\n' +
      this.buildLtypeTable() +
      this.buildStyleTable() +
      this.buildLayerTable() +
      this.buildAppIdTable() +
      '0\nENDSEC\n'
    );
  }

  /**
   * The BLOCKS section, or nothing when no block was defined.
   *
   * R12 needs no BLOCKS section at all, so an empty one is left out rather than
   * written as a header with nothing inside it.
   */
  private buildBlocks(): string {
    if (this.blocks.size === 0) return '';
    let s = '0\nSECTION\n2\nBLOCKS\n';
    for (const [name, definition] of this.blocks) {
      s +=
        '0\nBLOCK\n8\n0\n2\n' + name + '\n70\n0\n' +
        '10\n0.0\n20\n0.0\n30\n0.0\n3\n' + name + '\n1\n\n';
      for (const line of definition.lines) {
        s +=
          '0\nLINE\n8\n0\n' +
          '10\n' + fmt(line.start.x) + '\n20\n' + fmt(line.start.y) + '\n30\n0.0\n' +
          '11\n' + fmt(line.end.x) + '\n21\n' + fmt(line.end.y) + '\n31\n0.0\n';
      }
      for (const points of definition.polylines ?? []) {
        if (points.length < 2) continue;
        s += '0\nPOLYLINE\n8\n0\n66\n1\n10\n0.0\n20\n0.0\n30\n0.0\n70\n1\n';
        for (const p of points) {
          s += '0\nVERTEX\n8\n0\n10\n' + fmt(p.x) + '\n20\n' + fmt(p.y) + '\n30\n0.0\n';
        }
        s += '0\nSEQEND\n8\n0\n';
      }
      // ATTDEF declares the field; the ATTRIB on each INSERT carries its value.
      // A block whose fields exist only on the inserts is one a schedule can
      // read and an editor cannot re-prompt for.
      for (const attribute of definition.attributes ?? []) {
        s +=
          '0\nATTDEF\n8\n0\n' +
          '10\n' + fmt(attribute.offset.x) + '\n20\n' + fmt(attribute.offset.y) + '\n30\n0.0\n' +
          '40\n' + fmt(attribute.height) + '\n' +
          '1\n\n' +
          '3\n' + attribute.tag + '\n' +
          '2\n' + attribute.tag + '\n' +
          '70\n' + (attribute.invisible ? 1 : 0) + '\n';
      }
      s += '0\nENDBLK\n8\n0\n';
    }
    return s + '0\nENDSEC\n';
  }

  private buildEntities(): string {
    let s = '0\nSECTION\n2\nENTITIES\n';
    for (const write of this.entities) s += write();
    s += '0\nENDSEC\n';
    return s;
  }

  /**
   * Assemble the full ASCII DXF R12 document: a leading `999` comment
   * (units — see class docs), then HEADER + TABLES + ENTITIES + EOF. No
   * BLOCKS/OBJECTS sections and no BLOCK_RECORD table — R12 doesn't require
   * them (unlike R13+, where their absence would make the file invalid).
   */
  toString(): string {
    // Any point written through addPolyline/addLine/addText must land on a
    // registered layer, so ensure at least the "0" default layer exists for
    // callers that add geometry before their first `layer()` call.
    if (!this.layers.has('0')) {
      this.layers.set('0', { name: '0', aci: 7, linetype: 'CONTINUOUS' });
    }
    return (
      '999\n' + this.headerComment + '\n' +
      this.buildHeader() + this.buildTables() + this.buildBlocks() +
      this.buildEntities() + '0\nEOF\n'
    );
  }
}
