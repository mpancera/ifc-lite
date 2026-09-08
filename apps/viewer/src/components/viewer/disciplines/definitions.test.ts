/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The discipline tabs are data, and data drifts silently: a panel id that
 * no longer exists renders a dead button, two items with one id render one
 * button, and a feature-catalogue path that names a group nobody has any
 * more sends the reader to a tab that is not there. Each of those is a
 * one-line check here.
 */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_PANELS } from '@/lib/panels/registry.js';
import { FEATURE_SECTIONS } from '@/lib/features/catalog.js';
import { DISCIPLINE_TABS, disciplineTab } from './definitions.js';

const PANEL_IDS = new Set(WORKSPACE_PANELS.map((panel) => panel.id));

describe('discipline tab definitions', () => {
  it('has five tabs, each with at least one group of at least one item', () => {
    assert.deepEqual(
      DISCIPLINE_TABS.map((tab) => tab.id),
      ['data', 'architecture', 'fire', 'security', 'automation'],
    );
    for (const tab of DISCIPLINE_TABS) {
      assert.ok(tab.groups.length > 0, `${tab.id} has no groups`);
      for (const group of tab.groups) {
        assert.ok(group.items.length > 0, `${tab.id} › ${group.label} is empty`);
      }
    }
  });

  it('every panel item points at a registered workspace panel', () => {
    for (const tab of DISCIPLINE_TABS) {
      for (const group of tab.groups) {
        for (const item of group.items) {
          if (item.kind !== 'panel') continue;
          assert.ok(PANEL_IDS.has(item.panel), `${tab.id} › ${group.label} › ${item.label}: unknown panel "${item.panel}"`);
        }
      }
    }
  });

  it('never lists two different items under one id, or one label twice in a tab', () => {
    const byId = new Map<string, string>();
    for (const tab of DISCIPLINE_TABS) {
      const labels = new Set<string>();
      for (const group of tab.groups) {
        for (const item of group.items) {
          // A shared item (Add element on three trade tabs) is the SAME
          // object, which is allowed; two objects with one id are not.
          const seen = byId.get(item.id);
          if (seen !== undefined) assert.equal(seen, item.label, `id "${item.id}" is used for "${seen}" and "${item.label}"`);
          byId.set(item.id, item.label);
          assert.ok(!labels.has(item.label), `${tab.id} shows "${item.label}" twice`);
          labels.add(item.label);
        }
      }
    }
  });

  it('gives every trade tab a Role group built from the role catalogue', () => {
    for (const id of ['fire', 'security', 'automation'] as const) {
      const tab = disciplineTab(id);
      assert.ok(tab, `${id} tab missing`);
      const role = tab.groups[0];
      assert.equal(role?.label, 'Role', `${id}: first group is not Role`);
      assert.ok(role.items.length >= 2, `${id}: Role group has ${role.items.length} systems`);
      assert.ok(role.items.every((item) => item.kind === 'action' && item.id.startsWith('role:')));
    }
  });

  it('resolves base tab ids to no discipline tab', () => {
    assert.equal(disciplineTab('home'), null);
    assert.equal(disciplineTab('author'), null);
    assert.equal(disciplineTab('fire')?.label, 'Fire');
  });

  it('keeps the feature catalogue pointing at groups and items that exist', () => {
    // A `where` of the form "Tab › Group › Item" whose first segment names a
    // discipline tab is a promise about this file. Anything after the item
    // (", oder …", "bei aktivem …") is prose and ignored.
    const tabsByLabel = new Map(DISCIPLINE_TABS.map((tab) => [tab.label, tab]));
    let checked = 0;
    for (const section of FEATURE_SECTIONS) {
      for (const entry of section.entries) {
        if (!entry.where) continue;
        const [tabLabel, groupLabel, itemPart] = entry.where.split(' › ');
        const tab = tabsByLabel.get(tabLabel ?? '');
        if (!tab) continue;
        const group = tab.groups.find((g) => g.label === groupLabel);
        assert.ok(group, `"${entry.name}": no group "${groupLabel}" on the ${tab.label} tab`);
        const itemLabel = (itemPart ?? '').split(/[,(]/)[0].trim();
        assert.ok(
          group.items.some((item) => item.label === itemLabel),
          `"${entry.name}": no item "${itemLabel}" under ${tab.label} › ${group.label}`,
        );
        checked++;
      }
    }
    assert.ok(checked >= 20, `only ${checked} catalogue entries point at a discipline tab`);
  });
});
