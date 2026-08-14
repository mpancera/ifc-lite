/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Turning what the plan DRAWS into what the model CARRIES.
 *
 * Room stamps, door marks and opening arcs live as a screen overlay and in the
 * SVG/PDF export. Marc asked for them in the file as well (2026-08-13): "Die
 * Raumbeschriftung, Türbeschriftung und zugehörende Plangrafik (z.B.
 * Öffnungsbogen) möchte ich auch als IfcAnnotation dem Modell mitgeben
 * können." An overlay is this viewer's opinion; an `IfcAnnotation` is
 * something the next reader of the file gets too.
 *
 * # A committed annotation is a snapshot, not a link
 * Once written it is an independent object. Move the door and the arc stays
 * where it was — it is drafting content, like a line in a CAD file, and
 * nothing in IFC makes it follow. That is why re-committing has to REPLACE
 * rather than add, and why the marker below exists.
 *
 * # Text is sized for the scale it was committed at
 * On screen a label is sized in pixels so it stays legible at every zoom. In
 * the model it needs a real height, and there is only one honest source for
 * it: the scale the plan is set to right now. 2.5 mm of paper at 1:100 is
 * 0.25 m in the model, at 1:50 it is 0.125 m. Committing at a different scale
 * gives different text, correctly — the annotation belongs to a drawing, and a
 * drawing has a scale.
 */

import type { Point2D } from '@ifc-lite/drawing-2d';
import type { AnnotationInStoreParams } from '@ifc-lite/create';
import type { PlanLabel } from './roomLabels';
import type { SymbolLine } from './openingSymbols';

/**
 * `ObjectType` stamped on everything this writes.
 *
 * Follows `GENERATED_SPACE_OBJECTTYPE` (`IfcLite:GeneratedSpace`), and for the
 * same reason: a second run has to recognise its own output and replace it
 * instead of laying a second copy on top of the first. Three separate markers
 * rather than one, so "commit the labels" and "commit the plan graphics" can
 * be taken back independently.
 */
export const PLAN_ANNOTATION_OBJECTTYPES = {
  roomLabel: 'IfcLite:PlanRoomLabel',
  doorLabel: 'IfcLite:PlanDoorLabel',
  openingSymbol: 'IfcLite:PlanOpeningSymbol',
} as const;

export type PlanAnnotationKind = keyof typeof PLAN_ANNOTATION_OBJECTTYPES;

const MARKERS: ReadonlySet<string> = new Set<string>(
  Object.values(PLAN_ANNOTATION_OBJECTTYPES),
);

/** Whether an `ObjectType` marks an annotation this module wrote. */
export function isPlanAnnotationObjectType(value: string | null | undefined): boolean {
  return typeof value === 'string' && MARKERS.has(value.trim());
}

/**
 * Where `ObjectType` sits in an `IfcAnnotation`'s attribute list.
 *
 * `IfcRoot` contributes GlobalId, OwnerHistory, Name and Description;
 * `IfcObject` adds ObjectType at 4. Fixed across IFC2X3, IFC4 and IFC4X3 —
 * what those schemas disagree about is the TAIL (`PredefinedType` exists only
 * in IFC4X3), which is why reading from the front is safe here.
 */
export const ANNOTATION_OBJECTTYPE_INDEX = 4;

/**
 * Which existing annotations a re-commit should remove first.
 *
 * Only the kinds being re-committed, and only ones carrying our own marker: a
 * note the user drew by hand, or a measurement they committed, is not ours to
 * delete. Candidates come from both the file and the session's overlay,
 * because a committed annotation lives in the overlay until it is exported and
 * in the source afterwards, and a plan re-committed across that boundary would
 * otherwise double.
 */
export function planAnnotationIdsToReplace(
  candidates: readonly { readonly expressId: number; readonly attributes?: readonly unknown[] }[],
  kinds: readonly PlanAnnotationKind[],
): number[] {
  const wanted = new Set<string>(kinds.map((kind) => PLAN_ANNOTATION_OBJECTTYPES[kind]));
  if (wanted.size === 0) return [];

  const ids: number[] = [];
  for (const candidate of candidates) {
    const value = candidate.attributes?.[ANNOTATION_OBJECTTYPE_INDEX];
    if (typeof value !== 'string') continue;
    if (wanted.has(value.trim())) ids.push(candidate.expressId);
  }
  return ids;
}

/** Nominal text height on paper. 2.5 mm is the usual plan lettering. */
export const PLAN_TEXT_PAPER_MM = 2.5;

/** Rough width of one character as a fraction of its height. */
const CHARACTER_WIDTH_RATIO = 0.6;

/**
 * Text height in MODEL metres for a plan drawn at 1:`scaleDenominator`.
 *
 * Falls back to the 1:100 height for a denominator that makes no sense, rather
 * than emitting a zero-height annotation that no reader can draw.
 */
export function textHeightMetres(scaleDenominator: number | null | undefined): number {
  const usable = typeof scaleDenominator === 'number'
    && Number.isFinite(scaleDenominator)
    && scaleDenominator > 0;
  return (PLAN_TEXT_PAPER_MM / 1000) * (usable ? scaleDenominator : 100);
}

/** Drawing point → storey-local IFC, the same flip `planPointToStoreyLocal` makes. */
function toLocal(point: Point2D): readonly [number, number] {
  return [point.x, -point.y];
}

/**
 * Join touching segments into runs.
 *
 * A door symbol arrives as loose segments — the frame, then the swing arc cut
 * into a dozen chords. One `IfcAnnotation` carries ONE geometry item, so
 * committing per segment would put fourteen annotations in the model for one
 * door and make the arc impossible to select as a thing. Chaining first turns
 * that into two: the frame and the arc.
 *
 * Greedy and single-pass: take a segment, keep extending its end while
 * something starts there, then do the same backwards from its start. Enough
 * for symbol output, which is generated in order and either connects exactly
 * or not at all — this is not a general topology builder.
 */
export function chainSegments(
  lines: readonly SymbolLine[],
  tolerance = 1e-6,
): Point2D[][] {
  const near = (a: Point2D, b: Point2D) => (
    Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
  );

  const unused = lines.filter((line) => !near(line.start, line.end));
  const taken = new Set<number>();
  const chains: Point2D[][] = [];

  for (let i = 0; i < unused.length; i += 1) {
    if (taken.has(i)) continue;
    taken.add(i);
    const chain: Point2D[] = [unused[i].start, unused[i].end];

    // Forward: anything starting (or ending) where the chain currently ends.
    let extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < unused.length; j += 1) {
        if (taken.has(j)) continue;
        const tail = chain[chain.length - 1];
        if (near(unused[j].start, tail)) { chain.push(unused[j].end); }
        else if (near(unused[j].end, tail)) { chain.push(unused[j].start); }
        else continue;
        taken.add(j);
        extended = true;
      }
    }

    // Backward, from the chain's head.
    extended = true;
    while (extended) {
      extended = false;
      for (let j = 0; j < unused.length; j += 1) {
        if (taken.has(j)) continue;
        const head = chain[0];
        if (near(unused[j].end, head)) { chain.unshift(unused[j].start); }
        else if (near(unused[j].start, head)) { chain.unshift(unused[j].end); }
        else continue;
        taken.add(j);
        extended = true;
      }
    }

    chains.push(chain);
  }

  return chains;
}

export interface PlanAnnotationInput {
  readonly roomLabels: readonly PlanLabel[];
  readonly doorLabels: readonly PlanLabel[];
  readonly symbols: readonly { readonly expressId: number; readonly lines: readonly SymbolLine[] }[];
  /**
   * The plan's current scale, as the 100 in 1:100.
   *
   * `null` where the viewport cannot state one; the text then falls back to
   * the 1:100 height rather than the commit refusing — a note at a slightly
   * wrong size is recoverable, a missing one is silently absent.
   */
  readonly scaleDenominator: number | null;
}

/**
 * One annotation per LINE of a label.
 *
 * `IfcAnnotation` carries a single text item, and `IfcTextLiteralWithExtent`
 * holds one string — there is no multi-line layout to hand a reader. So the
 * three lines of a room stamp become three annotations, stacked the way the
 * overlay stacks them, which is also what a CAD file would contain. They share
 * a `Name` and carry the labelled element's id in `Description`, so they can
 * be told apart from other rooms' text and traced back to what they describe.
 */
function labelAnnotations(
  labels: readonly PlanLabel[],
  objectType: string,
  height: number,
): AnnotationInStoreParams[] {
  const out: AnnotationInStoreParams[] = [];

  for (const label of labels) {
    const lines = label.lines.filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    // Stacked around the anchor, matching the overlay: the block grows up and
    // down from the middle rather than hanging below it.
    const blockTop = label.anchor.y - ((lines.length - 1) * height) / 2;
    const heading = lines[0];

    lines.forEach((text, index) => {
      const position = toLocal({ x: label.anchor.x, y: blockTop + index * height });
      out.push({
        geometry: {
          kind: 'text',
          text,
          position: [position[0], position[1]],
          width: Math.max(text.length * height * CHARACTER_WIDTH_RATIO, height),
          height,
        },
        Name: heading,
        Description: `#${label.expressId}`,
        ObjectType: objectType,
      });
    });
  }

  return out;
}

/** Opening symbols as polylines, one per connected run. */
function symbolAnnotations(
  symbols: PlanAnnotationInput['symbols'],
): AnnotationInStoreParams[] {
  const out: AnnotationInStoreParams[] = [];

  for (const symbol of symbols) {
    for (const chain of chainSegments(symbol.lines)) {
      if (chain.length < 2) continue;
      out.push({
        geometry: { kind: 'polyline', points: chain.map(toLocal) },
        Name: 'Öffnungssymbol',
        Description: `#${symbol.expressId}`,
        ObjectType: PLAN_ANNOTATION_OBJECTTYPES.openingSymbol,
      });
    }
  }

  return out;
}

/** Everything the plan would commit, grouped by what it is. */
export interface PlanAnnotationSet {
  readonly roomLabel: readonly AnnotationInStoreParams[];
  readonly doorLabel: readonly AnnotationInStoreParams[];
  readonly openingSymbol: readonly AnnotationInStoreParams[];
}

export function planAnnotations(input: PlanAnnotationInput): PlanAnnotationSet {
  const height = textHeightMetres(input.scaleDenominator);
  return {
    roomLabel: labelAnnotations(
      input.roomLabels, PLAN_ANNOTATION_OBJECTTYPES.roomLabel, height,
    ),
    doorLabel: labelAnnotations(
      input.doorLabels, PLAN_ANNOTATION_OBJECTTYPES.doorLabel, height,
    ),
    openingSymbol: symbolAnnotations(input.symbols),
  };
}

/** `12 Raumbeschriftungen, 8 Türbeschriftungen, 14 Plangrafiken`. */
export function describeAnnotationSet(set: PlanAnnotationSet): string {
  const parts: string[] = [];
  const say = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  say(set.roomLabel.length, 'Raumbeschriftung', 'Raumbeschriftungen');
  say(set.doorLabel.length, 'Türbeschriftung', 'Türbeschriftungen');
  say(set.openingSymbol.length, 'Plangrafik', 'Plangrafiken');
  return parts.length > 0 ? parts.join(', ') : 'nichts zu übernehmen';
}
