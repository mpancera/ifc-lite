/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCIPLINE_ROLES,
  EDITOR_ROLE_ID,
  VIEWER_ROLE_ID,
  allDisciplineSystems,
  disciplineSystemName,
  findDisciplineSystem,
  isBaseRole,
  normalizeRoleId,
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

test('no system id collides with a base-role sentinel', () => {
  assert.ok(!allDisciplineSystems().some((s) => isBaseRole(s.id)));
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

test('the base roles resolve to no system', () => {
  for (const id of [VIEWER_ROLE_ID, EDITOR_ROLE_ID]) {
    assert.equal(findDisciplineSystem(id), null);
    assert.equal(roleOfSystem(id), null);
  }
  assert.equal(findDisciplineSystem(null), null);
});

test('the pre-split "standard" value migrates to Editor', () => {
  // It meant full access. Silently demoting someone mid-project to read-only
  // would look like the tool had broken.
  assert.equal(normalizeRoleId('standard'), EDITOR_ROLE_ID);
});

test('a stored role is kept as it is', () => {
  assert.equal(normalizeRoleId(VIEWER_ROLE_ID), VIEWER_ROLE_ID);
  assert.equal(normalizeRoleId(EDITOR_ROLE_ID), EDITOR_ROLE_ID);
  assert.equal(normalizeRoleId('fire.detection'), 'fire.detection');
});

test('anything unrecognised falls back to read-only', () => {
  // A role since removed from the catalogue, or a corrupted value: Viewer is
  // the safe direction to fail in.
  assert.equal(normalizeRoleId('fire.removed'), VIEWER_ROLE_ID);
  assert.equal(normalizeRoleId(null), VIEWER_ROLE_ID);
  assert.equal(normalizeRoleId(undefined), VIEWER_ROLE_ID);
  assert.equal(normalizeRoleId(''), VIEWER_ROLE_ID);
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
