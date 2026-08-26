/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deciding whether a fetched symbol drawing is safe and usable.
 *
 * # Why this is not optional
 * These drawings come from a server over the network and are rendered INTO the
 * viewer's own document. An SVG is not a picture format in the way a PNG is:
 * it can carry `<script>`, event-handler attributes and external references,
 * and anything it carries runs with the page's privileges. A catalogue that is
 * fetched is a catalogue that could be substituted — by a compromised host, a
 * hostile network, or simply a mistake — so what comes back is checked before
 * it is ever put in front of a renderer.
 *
 * Rejecting rather than stripping: a drawing that needed a script was not a
 * drawing, and quietly removing half of it would render something nobody
 * designed. The catalogue then reports the symbol as missing, which is a state
 * it already has to handle.
 *
 * # The shape rules
 * From the catalogue specification: a symbol is 10 × 10 millimetres of paper
 * with its origin in the MIDDLE, so it can be placed on a point. A drawing
 * with its origin in a corner sits half a symbol away from the thing it marks
 * — visible, but easy to mistake for a placement bug elsewhere.
 */

/**
 * The viewBox a square symbol declares — the ordinary case and the one the
 * catalogue's own drawings use.
 *
 * Kept as the reference for authors, NOT as the test. See {@link isCentredViewBox}.
 */
export const EXPECTED_VIEWBOX = '-5 -5 10 10';

/**
 * Whether a viewBox puts the drawing's origin in the MIDDLE.
 *
 * That — and only that — is what the rule above was ever protecting: a symbol
 * is placed ON a point, so a drawing whose origin sits in a corner lands half
 * a symbol away from the thing it marks. Height and width do not have to
 * match, and demanding they do was a mistake with real victims: the
 * catalogue's seven plate symbols (`-6 -3 12 6`, a wide red plate with
 * lettering — Brandmelderzentrale and its siblings) are perfectly centred and
 * were reported as "would sit offset", which is simply untrue of them. They
 * render correctly, letterboxed into the square mark box by
 * `preserveAspectRatio`.
 *
 * A plate IS wider than it is tall; forcing it square would shrink its
 * lettering to keep a rule that was never about proportion.
 */
export function isCentredViewBox(viewBox: string): boolean {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) return false;
  // A hair of tolerance: a drawing tool may write -2.9999999 for -3, and a
  // symbol is not misplaced by a millionth of a millimetre.
  const off = 1e-6;
  return Math.abs(minX + width / 2) <= off && Math.abs(minY + height / 2) <= off;
}

/** Why a drawing was rejected. */
export type SymbolSvgProblem =
  | 'not-svg'
  | 'script'
  | 'event-handler'
  | 'external-reference'
  | 'no-viewbox'
  | 'wrong-viewbox';

export interface SymbolSvgCheck {
  readonly ok: boolean;
  readonly problems: readonly SymbolSvgProblem[];
}

/** What to tell the author about each problem. */
export const SVG_PROBLEM_MESSAGES: Readonly<Record<SymbolSvgProblem, string>> = {
  'not-svg': 'Die Datei ist kein SVG.',
  script: 'Das SVG enthält ein <script> — abgelehnt.',
  'event-handler': 'Das SVG enthält einen Event-Handler (onload o.ä.) — abgelehnt.',
  'external-reference': 'Das SVG lädt etwas nach (Bild, Schrift, externe Referenz) — abgelehnt.',
  'no-viewbox': 'Das SVG hat keine viewBox.',
  'wrong-viewbox': 'Die viewBox ist nicht auf den Ursprung zentriert — das Symbol säße versetzt.',
};

/** `<script …>` anywhere, however it is cased or spaced. */
const SCRIPT = /<\s*script[\s>]/i;

/**
 * An `on…=` attribute.
 *
 * Matched on a word boundary before `on` so that legitimate attribute names
 * ending in "on" — `version`, and any `…on` an author invents — are not read
 * as handlers.
 */
const EVENT_HANDLER = /\son[a-z]+\s*=/i;

/**
 * Anything that would make the renderer fetch a second resource.
 *
 * `<image>` and `<use href>` pull a file; `@import` and `url(http…)` pull a
 * stylesheet or a font; `<foreignObject>` opens the door to HTML entirely.
 * The specification asks for self-contained files, so any of these means the
 * drawing was not written to it.
 */
const EXTERNAL = [
  /<\s*image[\s>]/i,
  /<\s*foreignObject[\s>]/i,
  /\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /\bxlink:href\s*=\s*["']?\s*(?:https?:)?\/\//i,
  /@import/i,
  /url\(\s*["']?\s*(?:https?:)?\/\//i,
];

/** The `viewBox` value, or `null` when there is none. */
export function viewBoxOf(svg: string): string | null {
  const match = /viewBox\s*=\s*["']([^"']+)["']/i.exec(svg);
  // Whitespace and commas are both legal separators in a viewBox, so both are
  // normalised before comparing — `-5,-5,10,10` is the same box.
  return match ? match[1].trim().replace(/[\s,]+/g, ' ') : null;
}

/**
 * Check a fetched drawing.
 *
 * Every problem is collected rather than returning at the first: somebody
 * fixing a symbol should see everything wrong with it in one pass.
 */
export function checkSymbolSvg(svg: string): SymbolSvgCheck {
  const problems: SymbolSvgProblem[] = [];

  if (!/<\s*svg[\s>]/i.test(svg)) {
    // Nothing else is worth saying about a file that is not an SVG at all —
    // most often an HTML error page served with status 200.
    return { ok: false, problems: ['not-svg'] };
  }

  if (SCRIPT.test(svg)) problems.push('script');
  if (EVENT_HANDLER.test(svg)) problems.push('event-handler');
  if (EXTERNAL.some((pattern) => pattern.test(svg))) problems.push('external-reference');

  const viewBox = viewBoxOf(svg);
  if (viewBox === null) problems.push('no-viewbox');
  else if (!isCentredViewBox(viewBox)) problems.push('wrong-viewbox');

  return { ok: problems.length === 0, problems };
}

/**
 * Whether a drawing may be rendered.
 *
 * The safety problems are absolute. A wrong or missing viewBox is a DRAWING
 * fault rather than a danger, so it is reported but does not block: a symbol
 * sitting slightly off is still more useful than no symbol, and the coverage
 * view names it so somebody can fix the source.
 */
export function isSymbolSvgRenderable(check: SymbolSvgCheck): boolean {
  const unsafe: readonly SymbolSvgProblem[] = [
    'not-svg', 'script', 'event-handler', 'external-reference',
  ];
  return !check.problems.some((problem) => unsafe.includes(problem));
}

/**
 * A drawing made ready to embed, or `null` when it must not be shown.
 *
 * Two things stand between a stored symbol and a visible one:
 *
 * - It has to be safe. {@link isSymbolSvgRenderable} draws that line; a caller
 *   that skips the check hands whatever the catalogue holds to the DOM.
 * - It has to have a SIZE. A missing viewBox is treated as a drawing fault
 *   rather than a danger — fine when the SVG is inlined, fatal when it is
 *   embedded as an image, because an SVG with neither viewBox nor dimensions
 *   has no intrinsic size and renders as nothing at all. Found the hard way:
 *   detectors that were in the plan's DOM and drew empty space.
 *
 * So the expected viewBox is written in where none is stated. A WRONG one is
 * left alone: it is the author's statement about their own drawing, and the
 * coverage view already names it.
 */
export function svgForEmbedding(svg: string): string | null {
  const check = checkSymbolSvg(svg);
  if (!isSymbolSvgRenderable(check)) return null;
  if (viewBoxOf(svg) !== null) return svg;
  return svg.replace(/<\s*svg\b/i, `<svg viewBox="${EXPECTED_VIEWBOX}"`);
}

/** One line naming what is wrong, for a settings list. */
export function describeSymbolSvgProblems(check: SymbolSvgCheck): string {
  return check.problems.map((problem) => SVG_PROBLEM_MESSAGES[problem]).join(' ');
}
