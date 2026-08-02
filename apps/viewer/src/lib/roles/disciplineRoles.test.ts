/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCIPLINE_ROLES,
  STANDARD_ROLE_ID,
  allDisciplineSystems,
  disciplineSystemName,
  findDisciplineSystem,
  roleOfSystem,
} from './disciplineRoles.js';

/**
 * The `IfcDistributionSystemEnum` values the roles are allowed to use. Kept
 * explicit so a typo (or an invented value) fails here rather than producing
 * an IFC file no consumer can validate.
 */
const VALID_PREDEFINED_TYPES = new Set(['FIREPROTECTION', 'SECURITY', 'CONTROL']);

test('discipline systems have unique ids', () => {
  const ids = allDisciplineSystems().map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('no system id collides with the standard sentinel', () => {
  assert.ok(!allDisciplineSystems().some((s) => s.id === STANDARD_ROLE_ID));
});

test('every system declares a standard IfcDistributionSystemEnum value', () => {
  for (const system of allDisciplineSystems()) {
    assert.ok(
      VALID_PREDEFINED_TYPES.has(system.predefinedType),
      `${system.id} uses non-standard PredefinedType "${system.predefinedType}"`,
    );
  }
});

test('systems sharing a PredefinedType are told apart by ObjectType', () => {
  // All four fire systems are FIREPROTECTION — without a distinct ObjectType
  // they would collapse into one system on placement.
  const seen = new Set<string>();
  for (const system of allDisciplineSystems()) {
    const key = `${system.predefinedType}:${system.objectType}`;
    assert.ok(!seen.has(key), `duplicate installation key ${key}`);
    seen.add(key);
  }
});

test('the standard role resolves to no system', () => {
  assert.equal(findDisciplineSystem(STANDARD_ROLE_ID), null);
  assert.equal(findDisciplineSystem(null), null);
  assert.equal(roleOfSystem(STANDARD_ROLE_ID), null);
});

test('an unknown id resolves to no system rather than throwing', () => {
  assert.equal(findDisciplineSystem('not.a.system'), null);
  assert.equal(roleOfSystem('not.a.system'), null);
});

test('findDisciplineSystem resolves a declared system', () => {
  const system = findDisciplineSystem('fire.detection');
  assert.equal(system?.predefinedType, 'FIREPROTECTION');
  assert.equal(system?.objectType, 'FireDetection');
});

test('every system resolves back to the role that declares it', () => {
  for (const role of DISCIPLINE_ROLES) {
    for (const system of role.systems) {
      assert.equal(roleOfSystem(system.id)?.id, role.id);
    }
  }
});

test('disciplineSystemName qualifies the system with its role', () => {
  assert.equal(disciplineSystemName(findDisciplineSystem('security.video')!), 'Security - Videosecurity');
});

test('disciplineSystemName adds no non-ASCII of its own', () => {
  // The STEP escapers do not encode non-ASCII, so the separator this function
  // introduces must stay ASCII even where a role's own label is not.
  for (const system of allDisciplineSystems()) {
    const added = disciplineSystemName(system)
      .replace(system.label, '')
      .replace(roleOfSystem(system.id)?.label ?? '', '');
    // eslint-disable-next-line no-control-regex
    assert.ok(/^[\x20-\x7E]*$/.test(added), `separator for ${system.id} is not ASCII`);
  }
});
