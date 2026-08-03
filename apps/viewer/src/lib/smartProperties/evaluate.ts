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

import type {
  RuleEvaluation,
  RuleSegment,
  SmartPropertyRule,
  ValueResolver,
  ValueSource,
} from './types';

/** `IfcSensor` matches a rule listing `IfcSensor`, case-insensitively. */
export function ruleApplies(rule: SmartPropertyRule, ifcClass: string): boolean {
  const wanted = ifcClass.toLowerCase();
  return rule.applicability.some((entry) => entry.toLowerCase() === wanted);
}

function describe(source: ValueSource): string {
  return `${source.scope}.${source.field}`;
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
  isFirst: boolean,
  report: { warnings: string[]; omitted: string[] },
): string | null {
  const primary = resolve(segment.source, expressId).trim();
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
): RuleEvaluation {
  const report = { warnings: [] as string[], omitted: [] as string[] };
  const parts: string[] = [];

  for (const segment of rule.segments) {
    // "First" means first CONTRIBUTING segment, not first in the list: when the
    // root falls away, whatever leads must not inherit its separator.
    const text = resolveSegment(segment, expressId, resolve, parts.length === 0, report);
    if (text !== null) parts.push(text);
  }

  return { value: parts.join(''), warnings: report.warnings, omitted: report.omitted };
}
