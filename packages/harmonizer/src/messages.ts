/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Messages a person will read. Every message has a stable code, because the
 * text here is an English default and a host translates on the code, not on
 * the wording. The rule for the wording: say what was found and what the
 * person can do next; never end in a dead end.
 */

import type { HarmonizerMessage, MessageSeverity } from './types.js';

export const MessageCodes = {
  /** The file is a scan or a photo; automatic recognition is not available. */
  RASTER_NOT_SUPPORTED: 'raster-not-supported',
  /** A scan lies under vector lines; the vector part is not trustworthy alone. */
  PDF_HYBRID: 'pdf-hybrid',
  /** Vector content, but no readable text (labels were outlined into paths). */
  PDF_NO_TEXT: 'pdf-no-text',
  /** Many segments shorter than a hatch stroke: hatching exported as vectors. */
  MICRO_SEGMENTS: 'micro-segments',
  /** Nothing drawn on the page at all. */
  PDF_EMPTY_PAGE: 'pdf-empty-page',
  /** Vector content, but too little of it to be a plan. */
  PDF_FEW_PATHS: 'pdf-few-paths',
  /** No paper scale could be read; the plan needs calibration. */
  NO_SCALE: 'no-scale',
  /** DWG cannot be read here; ask for the same drawing as DXF. */
  DWG_NOT_READABLE: 'dwg-not-readable',
  /** Block references point at blocks that are not in the file. */
  DXF_UNRESOLVED_BLOCKS: 'dxf-unresolved-blocks',
  /** $INSUNITS is 0; the unit was estimated from the extents. */
  DXF_NO_UNITS: 'dxf-no-units',
  /** File type not recognised from its name. */
  UNKNOWN_INPUT: 'unknown-input',
} as const;

export type MessageCode = (typeof MessageCodes)[keyof typeof MessageCodes];

const TEXTS: Record<MessageCode, (d: Record<string, unknown>) => string> = {
  'raster-not-supported': () =>
    'This plan is a scan or photo. Automatic recognition of scanned plans is not available yet. ' +
    'The plan can still be used as an underlay: calibrate it with two points and a known distance, then trace rooms with snapping.',
  'pdf-hybrid': (d) =>
    `Page ${num(d.page) + 1} has a scan as background (${pct(d.coverage)} of the page) with ${num(d.segments)} vector segments drawn over it. ` +
    'The vector part alone is not a complete plan; treat the page as a scan, or trace over it.',
  'pdf-no-text': (d) =>
    `Page ${num(d.page) + 1} contains vector geometry but no readable text. Labels were probably converted to outlines; room names cannot be read from this page.`,
  'micro-segments': (d) =>
    `${pct(d.fraction)} of the line segments are shorter than ${String(d.thresholdMm)} mm on paper. This is hatching exported as vectors; it will be filtered before rooms are detected.`,
  'pdf-empty-page': (d) => `Page ${num(d.page) + 1} is empty.`,
  'pdf-few-paths': (d) =>
    `Page ${num(d.page) + 1} has only ${num(d.segments)} vector segments. That is a title block or a diagram rather than a floor plan.`,
  'no-scale': () =>
    'No paper scale was found in the file name or on the sheet. Calibrate the plan with two points and a known distance before it is used.',
  'dwg-not-readable': () =>
    'DWG cannot be read here: the format is not published. Export the same drawing as DXF from the same CAD program; nothing is lost in that export.',
  'dxf-unresolved-blocks': (d) =>
    `${num(d.count)} block reference(s) point at blocks that are not in the file (${String(d.names)}). The drawing probably relies on external references (xrefs) that were not delivered; it is incomplete.`,
  'dxf-no-units': (d) =>
    `The DXF declares no unit ($INSUNITS = 0). From its extents it was taken as ${String(d.assumed)}; check the scale before trusting any length.`,
  'unknown-input': (d) => `"${String(d.fileName)}" is not a plan format this tool reads (DXF, PDF, JPG, PNG).`,
};

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

function pct(v: unknown): string {
  return `${Math.round(num(v) * 100)} %`;
}

/** Build a message from its code; the text is the English default. */
export function message(
  code: MessageCode,
  severity: MessageSeverity,
  data: Record<string, unknown> = {},
): HarmonizerMessage {
  return { code, severity, text: TEXTS[code](data), data };
}
