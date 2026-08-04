/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Runs the applicable rules for one element and writes their results.
 *
 * Written into a real property set rather than kept as a derived value, so it
 * reaches schedules, the Lens, the properties panel and the export without any
 * of them needing to know rules exist. The cost is that it has to be rewritten
 * when a source changes; the alternative — resolving on read — would mean
 * teaching each of those surfaces separately.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { DEFAULT_SMART_PROPERTY_RULES } from './defaultRules';
import { evaluateRule, ruleApplies } from './evaluate';
import { makeModelResolver } from './modelResolver';
import { makeModelCounterResolver } from './modelCounter';
import { COUNTER_STORE_PROPERTY } from './types';
import type { SmartPropertyRule } from './types';

export interface AppliedRule {
  rule: SmartPropertyRule;
  value: string;
  warnings: string[];
}

export interface ApplyRulesArgs {
  store: IfcDataStore;
  view: MutablePropertyView;
  expressId: number;
  /** The element's IFC class, e.g. `IfcSensor`. */
  ifcClass: string;
  rules?: readonly SmartPropertyRule[];
  /**
   * Writes a result. Separate so the caller owns undo/dirty bookkeeping.
   * `expressId` defaults to the element under evaluation; a counter writes its
   * allocated number against that same element.
   */
  write: (pset: string, property: string, value: string, expressId?: number) => void;
}

/**
 * Apply every rule matching this element's class. Rules producing an empty
 * value write nothing: an empty identifier is worse than an absent one,
 * because it looks maintained.
 */
export function applySmartPropertyRules(args: ApplyRulesArgs): AppliedRule[] {
  const rules = args.rules ?? DEFAULT_SMART_PROPERTY_RULES;
  const applicable = rules.filter((rule) => ruleApplies(rule, args.ifcClass));
  if (applicable.length === 0) return [];

  const resolve = makeModelResolver({ store: args.store, view: args.view });
  const applied: AppliedRule[] = [];

  for (const rule of applicable) {
    // A freshly allocated number is written straight away, so the next element
    // in the same room sees it and continues rather than repeating it.
    const resolveCounter = makeModelCounterResolver({
      view: args.view,
      resolve,
      pset: rule.target.pset,
      applicability: rule.applicability,
      store: (expressId, value) => {
        args.write(rule.target.pset, COUNTER_STORE_PROPERTY, String(value), expressId);
      },
    });

    const evaluation = evaluateRule(rule, args.expressId, resolve, resolveCounter);
    if (!evaluation.value) continue;
    args.write(rule.target.pset, rule.target.property, evaluation.value);
    applied.push({ rule, value: evaluation.value, warnings: evaluation.warnings });
  }

  return applied;
}
