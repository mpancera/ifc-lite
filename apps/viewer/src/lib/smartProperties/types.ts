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
  scope: ValueScope;
  /** Attribute name, e.g. `Name`, `LongName`, `Tag`, `Description`. */
  field: string;
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
  source: ValueSource;
  fallback: SegmentFallback;
}

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
