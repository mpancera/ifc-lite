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

/** The viewBox every symbol is expected to declare. */
export const EXPECTED_VIEWBOX = '-5 -5 10 10';

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
  'wrong-viewbox': `Die viewBox ist nicht "${EXPECTED_VIEWBOX}" — das Symbol säße versetzt.`,
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
  else if (viewBox !== EXPECTED_VIEWBOX) problems.push('wrong-viewbox');

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

/** One line naming what is wrong, for a settings list. */
export function describeSymbolSvgProblems(check: SymbolSvgCheck): string {
  return check.problems.map((problem) => SVG_PROBLEM_MESSAGES[problem]).join(' ');
}
