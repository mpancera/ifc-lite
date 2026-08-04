/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Rules that fill a property from the model around an element.
 *
 * An asset identifier is not a value somebody types — it is derived: building,
 * storey, room, product type, instance tag, joined by separators. Typing it by
 * hand is where transcription errors and drift come from, and re-typing it when
 * a room number changes is worse.
 *
 * A rule is a list of SEGMENTS. Each carries a separator and a value source,
 * and — crucially — what to do when that source yields nothing. Real models are
 * incomplete: a device in a corridor has no room, a type may have no tag. The
 * fallback is therefore part of the rule, not an error path bolted on after.
 */

/** Where a segment reads from, relative to the element being evaluated. */
export type ValueScope =
  | 'IfcSite'
  | 'IfcBuilding'
  | 'IfcBuildingStorey'
  | 'IfcSpace'
  /** The element itself, whatever its class. */
  | 'IfcEntity'
  /** The element's `IfcXxxType`, resolved through IfcRelDefinesByType. */
  | 'IfcEntityType';

export interface ValueSource {
  kind?: 'value';
  scope: ValueScope;
  /** Attribute name, e.g. `Name`, `LongName`, `Tag`, `Description`. */
  field: string;
}

/**
 * A running number that distinguishes otherwise identical elements — the
 * second smoke detector in a room is `002`.
 *
 * Structurally different from every other source: it is not read off the
 * model, it is ALLOCATED, and once allocated it must never move. If detector
 * 002 is deleted, 003 stays 003 — renumbering would silently invalidate every
 * label, drawing and reference that already quotes the old number, and it
 * would do so without any visible edit. So the allocated number is stored on
 * the element and read back on later evaluations; only an element that has
 * none gets a fresh one.
 */
export interface CounterSource {
  kind: 'counter';
  /** Zero-padded width, e.g. 3 → `007`. */
  width: number;
  /**
   * What makes two elements peers, i.e. what the number counts WITHIN.
   * `['IfcSpace', 'IfcEntityType']` numbers each product type separately
   * per room, which is the common reading of "per room and type".
   */
  scopedBy: ValueScope[];
}

export type SegmentSource = ValueSource | CounterSource;

export function isCounter(source: SegmentSource): source is CounterSource {
  return source.kind === 'counter';
}

/**
 * What happens when a segment's source is empty.
 *
 * `omit` drops the segment AND the separator in front of it — otherwise a
 * missing room leaves `Building..Type`, which reads like a defect rather than
 * an absence.
 */
export type SegmentFallback =
  | { kind: 'warn' }
  | { kind: 'omit' }
  | { kind: 'alternative'; separator?: string; source: ValueSource };

export interface RuleSegment {
  /** Text before this segment's value. Absent on the first segment. */
  separator?: string;
  source: SegmentSource;
  fallback: SegmentFallback;
}

/**
 * Where an allocated counter is kept so later evaluations reuse it instead of
 * renumbering. `TagNumber` is a standard property of
 * `Pset_ConstructionOccurence` and means exactly this, so the number survives
 * an export and is answerable ("why is this 007?") without parsing the
 * assembled identifier back apart — which any separator appearing inside a
 * room name would defeat.
 */
export const COUNTER_STORE_PROPERTY = 'TagNumber';

export interface SmartPropertyRule {
  id: string;
  name: string;
  /** IFC classes this applies to, e.g. `['IfcSensor', 'IfcAlarm']`. */
  applicability: string[];
  /** Where the result is written. */
  target: { pset: string; property: string };
  segments: RuleSegment[];
}

export interface RuleEvaluation {
  /** The assembled value; `''` when nothing could be resolved. */
  value: string;
  /** Sources that were empty and whose fallback was `warn`. */
  warnings: string[];
  /** Segments dropped because their source was empty. */
  omitted: string[];
}

/** Reads a single value for the element under evaluation. */
export type ValueResolver = (source: ValueSource, expressId: number) => string;

/**
 * Supplies a counter segment's number.
 *
 * Separate from {@link ValueResolver} because it is not a read: it may have to
 * allocate, and allocation has to see the element's peers. Returning `''`
 * means "cannot number this" — the segment then follows its fallback like any
 * other.
 */
export type CounterResolver = (source: CounterSource, expressId: number) => string;
