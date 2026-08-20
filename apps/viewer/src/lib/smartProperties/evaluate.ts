/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Assembles a rule's value for one element.
 *
 * Pure: everything about the model arrives through the resolver, so the
 * assembly logic — which is where the subtle cases live — is testable without
 * a parsed file, a store or a renderer.
 */

import { isCounter } from './types';
import type {
  CounterResolver,
  RuleEvaluation,
  RuleSegment,
  SegmentSource,
  SmartPropertyRule,
  ValueResolver,
} from './types';

/** `IfcSensor` matches a rule listing `IfcSensor`, case-insensitively. */
export function ruleApplies(rule: SmartPropertyRule, ifcClass: string): boolean {
  const wanted = ifcClass.toLowerCase();
  return rule.applicability.some((entry) => entry.toLowerCase() === wanted);
}

function describe(source: SegmentSource): string {
  return isCounter(source) ? 'Counter' : `${source.scope}.${source.field}`;
}

/**
 * Resolve one segment to the text it contributes, including its separator.
 *
 * Returns `null` when the segment contributes nothing at all — that is what
 * makes the separator disappear with it, rather than leaving a dangling
 * delimiter that reads as a defect.
 */
function resolveSegment(
  segment: RuleSegment,
  expressId: number,
  resolve: ValueResolver,
  resolveCounter: CounterResolver | undefined,
  isFirst: boolean,
  report: { warnings: string[]; omitted: string[] },
): string | null {
  // A counter is allocated rather than read, so it takes a different resolver.
  // Without one it simply yields nothing and follows its fallback, which keeps
  // the evaluator usable in contexts that cannot allocate (a preview, a test).
  const primary = isCounter(segment.source)
    ? (resolveCounter?.(segment.source, expressId) ?? '').trim()
    : resolve(segment.source, expressId).trim();
  if (primary) return (isFirst ? '' : segment.separator ?? '') + primary;

  switch (segment.fallback.kind) {
    case 'alternative': {
      const alternative = resolve(segment.fallback.source, expressId).trim();
      if (alternative) {
        // The alternative may carry its own separator — a different source can
        // want a different delimiter.
        const separator = segment.fallback.separator ?? segment.separator ?? '';
        return (isFirst ? '' : separator) + alternative;
      }
      // The alternative was empty too. Nothing left to try, so drop the
      // segment rather than emit a bare separator.
      report.omitted.push(describe(segment.source));
      return null;
    }
    case 'warn':
      report.warnings.push(describe(segment.source));
      return null;
    case 'omit':
      report.omitted.push(describe(segment.source));
      return null;
  }
}

export function evaluateRule(
  rule: SmartPropertyRule,
  expressId: number,
  resolve: ValueResolver,
  resolveCounter?: CounterResolver,
): RuleEvaluation {
  const report = { warnings: [] as string[], omitted: [] as string[] };
  const parts: string[] = [];

  // The separator an omitted segment was going to contribute, held for the
  // next one that lands.
  //
  // A separator introduces a GROUP, not just a value: in
  // `A.01.03_FST.RM.001` the `_` says "the location stops here and the
  // equipment starts". Dropping it along with an absent trade code would
  // leave `A.01.03.RM.001` — one flat chain, with the boundary the identifier
  // is built around silently gone. So the introduction outlives its first
  // member and is taken over by whatever leads the group instead.
  let inherited: string | undefined;

  for (const segment of rule.segments) {
    // "First" means first CONTRIBUTING segment, not first in the list: when the
    // root falls away, whatever leads must not inherit its separator.
    const effective = inherited === undefined
      ? segment
      : { ...segment, separator: inherited };
    const text = resolveSegment(effective, expressId, resolve, resolveCounter, parts.length === 0, report);
    if (text === null) {
      // Only where the rule says so. Which separators open a group is a
      // property of the scheme, not something to infer: a missing room takes
      // its `.` with it, a missing trade hands its `_` on. Guessing from the
      // characters would need a precedence nobody wrote down.
      if (segment.handOnSeparator) inherited = inherited ?? segment.separator;
      continue;
    }
    inherited = undefined;
    parts.push(text);
  }

  return { value: parts.join(''), warnings: report.warnings, omitted: report.omitted };
}
