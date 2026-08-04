/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The rules currently in force, readable outside React.
 *
 * Placement and re-evaluation both run from imperative code — a store action
 * and an effect — so the rule set has to be reachable without a hook. Kept as
 * one module-level value rather than mirrored into the store, so there is no
 * second copy that can disagree with the saved one.
 */

import { DEFAULT_SMART_PROPERTY_RULES } from './defaultRules';
import type { SmartPropertyRule } from './types';

let active: readonly SmartPropertyRule[] = DEFAULT_SMART_PROPERTY_RULES;

/** `null` restores the shipped defaults. */
export function setActiveRules(rules: readonly SmartPropertyRule[] | null): void {
  active = rules ?? DEFAULT_SMART_PROPERTY_RULES;
}

export function activeRules(): readonly SmartPropertyRule[] {
  return active;
}

/** True while the shipped defaults are in force, for the editor's reset state. */
export function usingDefaultRules(): boolean {
  return active === DEFAULT_SMART_PROPERTY_RULES;
}
