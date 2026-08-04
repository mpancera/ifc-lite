/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeps rule-driven values current after the model around them changes.
 *
 * A rule runs once when an element is placed, but its sources keep moving: a
 * room gets its number filled in, a product type is renamed, an element is
 * moved to another storey. Left alone the identifier silently describes a
 * building that no longer exists — and it still looks plausible, which is what
 * makes it dangerous.
 *
 * Two properties this has to have, both easy to get wrong:
 *
 * 1. **It must terminate.** Re-evaluating produces writes, writes are changes,
 *    changes trigger re-evaluation. The loop is broken by comparing first and
 *    writing only what actually differs, so a second pass over settled data
 *    produces nothing.
 * 2. **It must not renumber.** The counter reads back the number stored on the
 *    element, so re-evaluation reproduces it rather than allocating again.
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { activeRules } from './activeRules';
import { evaluateRule, ruleApplies } from './evaluate';
import { makeModelCounterResolver } from './modelCounter';
import { makeModelResolver } from './modelResolver';
import { COUNTER_STORE_PROPERTY, type SmartPropertyRule } from './types';

export interface PendingWrite {
  expressId: number;
  pset: string;
  property: string;
  value: string;
  /** What the property held before, for reporting. */
  previous: string | null;
}

export interface ReevaluationPlan {
  writes: PendingWrite[];
  /** Elements the rules looked at, for a cheap sanity read in tests. */
  considered: number;
}

/** Current value of a property, or `null` when it is not set. */
function currentValue(
  view: MutablePropertyView,
  expressId: number,
  pset: string,
  property: string,
): string | null {
  for (const set of view.getForEntity(expressId)) {
    if (set.name !== pset) continue;
    for (const entry of set.properties) {
      if (entry.name === property) return String(entry.value);
    }
  }
  return null;
}

export interface PlanArgs {
  store: IfcDataStore;
  view: MutablePropertyView;
  rules?: readonly SmartPropertyRule[];
}

/**
 * What would have to change for every rule-managed value to be current.
 *
 * Returns a plan rather than applying it, so the caller can decide whether the
 * change is worth a re-render — and so this stays testable without a store.
 */
export function planReevaluation(args: PlanArgs): ReevaluationPlan {
  const rules = args.rules ?? activeRules();
  const resolve = makeModelResolver({ store: args.store, view: args.view });
  const writes: PendingWrite[] = [];
  let considered = 0;

  for (const entity of args.view.getNewEntities()) {
    const applicable = rules.filter((rule) => ruleApplies(rule, entity.type));
    if (applicable.length === 0) continue;
    considered += 1;

    for (const rule of applicable) {
      // No `store` callback: re-evaluation must never hand out a NEW number.
      // An element that somehow has none keeps none, and its segment falls
      // back — better than inventing a number after the fact.
      const resolveCounter = makeModelCounterResolver({
        view: args.view,
        resolve,
        pset: rule.target.pset,
        applicability: rule.applicability,
      });

      const evaluation = evaluateRule(rule, entity.expressId, resolve, resolveCounter);
      if (!evaluation.value) continue;

      const previous = currentValue(args.view, entity.expressId, rule.target.pset, rule.target.property);
      if (previous === evaluation.value) continue;

      writes.push({
        expressId: entity.expressId,
        pset: rule.target.pset,
        property: rule.target.property,
        value: evaluation.value,
        previous,
      });
    }
  }

  return { writes, considered };
}

/** Property names a rule owns, so the UI can mark them as not hand-editable. */
export function ruleManagedProperties(
  rules: readonly SmartPropertyRule[] = activeRules(),
): ReadonlySet<string> {
  const managed = new Set<string>();
  for (const rule of rules) {
    managed.add(`${rule.target.pset}.${rule.target.property}`);
    // The stored counter is bookkeeping for the rule, not a value to edit.
    managed.add(`${rule.target.pset}.${COUNTER_STORE_PROPERTY}`);
  }
  return managed;
}
