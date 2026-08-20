/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_IDENTIFIER_RULE } from './defaultRules.js';
import { evaluateRule, ruleApplies } from './evaluate.js';
import type { CounterResolver, ValueResolver, ValueSource } from './types.js';

/** Fixed number, so these tests exercise assembly rather than allocation
 *  (which counter.test.ts covers on its own). */
const counter: CounterResolver = () => '001';

/** A resolver over a plain `Scope.Field` → value map; anything absent is ''. */
function resolverFor(values: Record<string, string>): ValueResolver {
  return (source: ValueSource) => values[`${source.scope}.${source.field}`] ?? '';
}

const COMPLETE = {
  'IfcBuilding.Name': '50266',
  'IfcBuildingStorey.Name': 'E00',
  'IfcSpace.Name': '0.14',
  'IfcEntityType.TradeCode': 'FST',
  'IfcEntityType.Tag': 'RM',
  'IfcEntity.Tag': 'RM-001',
  'IfcEntity.Name': 'Rauchmelder',
};

test('applicability matches the element class, case-insensitively', () => {
  assert.equal(ruleApplies(ASSET_IDENTIFIER_RULE, 'IfcSensor'), true);
  assert.equal(ruleApplies(ASSET_IDENTIFIER_RULE, 'IFCSENSOR'), true);
  assert.equal(ruleApplies(ASSET_IDENTIFIER_RULE, 'IfcWall'), false);
});

test('a complete model yields every segment', () => {
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(COMPLETE), counter);

  assert.equal(result.value, '50266.E00.0.14_FST.RM.RM-001.001');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.omitted, []);
});

test('a missing room drops the segment AND its separator', () => {
  // The case that motivates the whole fallback design: leaving the separator
  // behind produces "50266.E00._smoke-detector", which reads as a defect
  // rather than as an element that legitimately sits in a corridor.
  const { 'IfcSpace.Name': _room, ...noRoom } = COMPLETE;
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(noRoom), counter);

  assert.equal(result.value, '50266.E00_FST.RM.RM-001.001');
  assert.deepEqual(result.omitted, ['IfcSpace.Name']);
});

test('a device with no established trade code keeps its separator', () => {
  // The `_` marks where the location stops and the equipment starts. Losing it
  // with the trade would leave `50266.E00.0.14.RM.001`, which reads as one
  // flat chain and hides the boundary the identifier is built around.
  const { 'IfcEntityType.TradeCode': _drop, ...noTrade } = COMPLETE;
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(noTrade), counter);

  assert.equal(result.value, '50266.E00.0.14_RM.RM-001.001');
  assert.deepEqual(result.omitted, ['IfcEntityType.TradeCode']);
});

test('a missing type tag falls back to the element name', () => {
  const { 'IfcEntityType.Tag': _tag, ...noType } = COMPLETE;
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(noType));

  assert.equal(result.value, '50266.E00.0.14_FST.Rauchmelder.RM-001');
  assert.deepEqual(result.warnings, []);
});

test('an empty alternative drops the segment rather than emitting a separator', () => {
  const { 'IfcEntityType.Tag': _t, 'IfcEntity.Name': _n, ...neither } = COMPLETE;
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(neither), counter);

  assert.equal(result.value, '50266.E00.0.14_FST.RM-001.001');
  assert.deepEqual(result.omitted, ['IfcEntityType.Tag']);
});

test('a missing storey is reported, not silently shortened', () => {
  // Unlike a corridor, an element with no storey is a modelling problem: the
  // identifier would still look plausible, which is exactly the danger.
  const { 'IfcBuildingStorey.Name': _s, ...noStorey } = COMPLETE;
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(noStorey));

  assert.deepEqual(result.warnings, ['IfcBuildingStorey.Name']);
  assert.equal(result.value, '50266.0.14_FST.RM.RM-001');
});

test('when the leading segment falls away the next one loses its separator', () => {
  // Otherwise the value opens with a stray delimiter.
  const { 'IfcBuilding.Name': _b, ...noBuilding } = COMPLETE;
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(noBuilding));

  assert.equal(result.value, 'E00.0.14_FST.RM.RM-001');
  assert.ok(!result.value.startsWith('.'));
});

test('an empty model yields an empty value rather than a string of separators', () => {
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor({}));

  assert.equal(result.value, '');
  assert.equal(result.warnings.length, 2);
});

test('whitespace-only sources count as missing', () => {
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor({ ...COMPLETE, 'IfcSpace.Name': '   ' }));

  assert.equal(result.value, '50266.E00_FST.RM.RM-001');
});

test('without a counter resolver the segment simply drops out', () => {
  // Keeps the evaluator usable where allocation is impossible — a preview, or
  // a rule being tried out before anything is placed.
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(COMPLETE));

  assert.equal(result.value, '50266.E00.0.14_FST.RM.RM-001');
  assert.deepEqual(result.omitted, ['Counter']);
});

test('a counter that cannot be allocated drops its separator too', () => {
  const empty: CounterResolver = () => '';
  const result = evaluateRule(ASSET_IDENTIFIER_RULE, 1, resolverFor(COMPLETE), empty);

  assert.ok(!result.value.endsWith('.'));
});
