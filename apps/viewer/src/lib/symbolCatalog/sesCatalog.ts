/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The association's symbols, folded into the catalogue the plan already reads.
 *
 * # Two sources, and the plan product decides
 * The Swiss fire authorities (VKF) and the association of security-system
 * installers (SES) both prescribe a symbol for a smoke detector, and they are
 * not the same drawing. Which one is right depends on the DOCUMENT: a
 * Brandschutzplan goes to the authority and carries the VKF symbol; a Werkplan
 * is the installer's own drawing and carries the association's.
 *
 * So this is not "better symbols replacing worse ones". Both entries stay in
 * the catalogue, each naming the products it belongs to, and the lookup picks
 * by product. Letting the association symbols win everywhere would silently
 * draw a wrong authority plan — wrong in a way nobody spots, because both
 * drawings look plausible.
 *
 * Where both apply to the same product, the association's wins: that is the
 * order "Level of Information Need — Gebäudeautomation" (BdCH/bSCH, 2026)
 * gives in chapter 5.5, and the catalogue's own product table repeats it.
 *
 * # Why the drawings arrive as shapes and leave as SVG
 * The association's stencil is a Visio file. The dictionary converts it once
 * into primitives — paths and ellipses — and hands those over rather than
 * finished files, because that is what its own interface renders from.
 * Everything downstream here already speaks SVG, so this module writes the
 * shapes back out as one document per symbol. That keeps the merge to a data
 * question and leaves screen, export and storage untouched.
 *
 * # Terms
 * The symbols are used by permission, granted to this application by name. The
 * attribution travels with them: see {@link SES_ATTRIBUTION} in
 * `sesCatalogProxy.ts`, which is also where the credential question is
 * explained.
 */

import type { SymbolCatalog, SymbolCatalogEntry } from './symbolCatalog.js';

/** The frame the association draws in. Not the VKF's `-5 -5 10 10`. */
export const SES_VIEWBOX = '0 0 24 24';

/**
 * Stroke width in that frame, matching the dictionary's own rendering.
 *
 * Not carried in the data — the stencil has no line weights worth preserving,
 * and the dictionary picked this. It is repeated here rather than guessed at,
 * so the same symbol does not come out heavier on a plan than in the catalogue
 * it was chosen from.
 */
const SES_STROKE = 1.2;

/** One primitive as the dictionary hands it over. */
interface SesShape {
  readonly el?: unknown;
  readonly d?: unknown;
  readonly cx?: unknown;
  readonly cy?: unknown;
  readonly rx?: unknown;
  readonly ry?: unknown;
  readonly filled?: unknown;
}

export interface SesCatalogSource {
  /** Catalogue entries, already in the shape the merge needs. */
  readonly entries: readonly SymbolCatalogEntry[];
  /** Symbol name to SVG document. */
  readonly drawings: Readonly<Record<string, string>>;
  /** Who has to be named wherever these are shown. */
  readonly attribution: string | null;
  /** What the permission covers, in the dictionary's own words. */
  readonly permission: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** XML-escape a `d` attribute. Paths hold no `<` or `&`, but a malformed
 *  export must not be able to write markup into the document. */
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * One symbol's primitives as a standalone SVG document, or `null`.
 *
 * `null` when nothing drawable survives — an empty document would be stored as
 * a valid drawing and then render as a blank square, which reads as "this
 * device has no symbol" rather than as the fault it is.
 */
export function sesShapesToSvg(shapes: unknown, viewBox = SES_VIEWBOX): string | null {
  if (!Array.isArray(shapes)) return null;

  const parts: string[] = [];
  for (const raw of shapes) {
    if (typeof raw !== 'object' || raw === null) continue;
    const shape = raw as SesShape;
    // Black rather than `currentColor`: these become data URIs in an
    // `<image>`, where nothing is inherited from the page.
    const fill = shape.filled === true ? '#000000' : 'none';
    const common = `fill="${fill}" stroke="#000000" stroke-width="${SES_STROKE}"`;

    if (text(shape.el) === 'ellipse') {
      const cx = num(shape.cx) ?? 0;
      const cy = num(shape.cy) ?? 0;
      const rx = num(shape.rx);
      const ry = num(shape.ry);
      if (rx === null || ry === null || rx <= 0 || ry <= 0) continue;
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${common}/>`);
      continue;
    }

    const d = text(shape.d);
    if (!d) continue;
    parts.push(`<path d="${attr(d)}" ${common} stroke-linecap="round" stroke-linejoin="round"/>`);
  }

  if (parts.length === 0) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${attr(viewBox)}">${parts.join('')}</svg>`;
}

/**
 * Read the dictionary's association catalogue.
 *
 * `null` means "this was not that catalogue"; an empty source is a real answer
 * and stays distinguishable from it, the same rule `parseSymbolCatalog` uses.
 *
 * A single unusable entry costs that entry. The failure this guards against is
 * one detector with a broken drawing taking the other twenty-six with it.
 */
export function parseSesCatalog(payload: unknown): SesCatalogSource | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const raw = record.symbols;
  if (typeof raw !== 'object' || raw === null) return null;

  const frame = text(record.viewBox) || SES_VIEWBOX;
  const entries: SymbolCatalogEntry[] = [];
  const drawings: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;

    const id = text(entry.id) || key;
    const symbol = text(entry.symbol);
    if (!id || !symbol) continue;

    const svg = sesShapesToSvg(entry.zeichnung, text(entry.viewBox) || frame);
    if (!svg) continue;

    entries.push({
      id,
      symbol,
      label: text(entry.label) || symbol,
      // An association entry with no product would apply everywhere — which is
      // the one outcome this module exists to prevent. Such an entry is kept
      // out rather than let through with an empty list.
      products: Array.isArray(entry.products)
        ? entry.products.map(text).filter((value) => value.length > 0)
        : [],
      // Every one of these. The permission was granted in exchange for the
      // naming, so the obligation belongs to the drawing and travels with it.
      attributionRequired: true,
    });
    drawings[symbol] = svg;
  }

  const licence = typeof record.lizenz === 'object' && record.lizenz !== null
    ? record.lizenz as Record<string, unknown>
    : {};

  return {
    entries: entries.filter((entry) => entry.products.length > 0),
    drawings,
    attribution: text(licence.inhaber) || null,
    permission: text(licence.bewilligung) || null,
  };
}

/**
 * Put the association's entries in front of the dictionary's.
 *
 * ORDER IS THE PRECEDENCE. `symbolEntryFor` walks the entries registered for a
 * Fachklasse and takes the first one that belongs to the product being drawn,
 * so "association first" is expressed by position and not by a flag somebody
 * has to remember to check.
 *
 * Both sets are kept whole. A class the association has no symbol for still
 * finds the dictionary's, and a Brandschutzplan still finds the VKF drawing
 * for a class the association also covers.
 */
export function mergeSesCatalog(
  base: SymbolCatalog | null,
  ses: SesCatalogSource | null,
): SymbolCatalog | null {
  if (!base) return null;
  if (!ses || ses.entries.length === 0) return base;

  return {
    ...base,
    entries: [...ses.entries, ...base.entries],
    drawings: { ...base.drawings, ...ses.drawings },
    attribution: ses.attribution,
    permission: ses.permission,
  };
}
