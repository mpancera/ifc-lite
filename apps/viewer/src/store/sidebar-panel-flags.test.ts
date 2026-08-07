/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Every docked side panel must have a visibility flag.
 *
 * A panel can be registered in `WORKSPACE_PANELS`, given an icon in the
 * activity bar and a body in `renderPanelBody` — and still be impossible to
 * open, because `openWorkspacePanel` sets the flags in `SIDEBAR_PANEL_FLAGS`
 * BY NAME and has nothing to set for a panel that is missing there. Clicking
 * its rail icon then does nothing at all, with no error anywhere.
 *
 * That is not hypothetical: location zones (#1810) shipped exactly like that
 * and read as a dead feature for months. This test is the tripwire.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_PANELS, isBottomPanel, isLeftPanel } from '../lib/panels/registry.js';
import { SIDEBAR_PANEL_FLAGS } from './index.js';

/** Panels that own the single-tenant right pane, so the ones that need a flag. */
const DOCKED_SIDE_PANELS = WORKSPACE_PANELS.filter(
  (p) => p.region === 'side' && !isBottomPanel(p.id) && !isLeftPanel(p.id)
    // The Information panel is the fallback, revealed by closing the others.
    && p.id !== 'properties',
).map((p) => p.id);

describe('sidebar panel flags', () => {
  it('covers every docked side panel', () => {
    const flagged = new Set(SIDEBAR_PANEL_FLAGS.map(([, id]) => id));
    const missing = DOCKED_SIDE_PANELS.filter((id) => !flagged.has(id));

    assert.deepEqual(
      missing, [],
      `registered but impossible to open — add a "<id>PanelVisible" flag and wire it into `
      + `openWorkspacePanel, the properties branch of showWorkspacePanel, `
      + `usePanelControls.setDockedVisible and SIDEBAR_PANEL_FLAGS`,
    );
  });

  it('has no flag for a panel that no longer exists', () => {
    const registered = new Set(WORKSPACE_PANELS.map((p) => p.id));
    const orphans = SIDEBAR_PANEL_FLAGS.filter(([, id]) => !registered.has(id));

    assert.deepEqual(orphans.map(([, id]) => id), []);
  });

  it('names each flag after its panel', () => {
    // The naming is what makes the wiring greppable; a flag called something
    // else is a flag nobody finds when adding the next panel.
    for (const [flag, id] of SIDEBAR_PANEL_FLAGS) {
      assert.equal(flag, `${id}PanelVisible`, `flag for "${id}"`);
    }
  });

  it('maps each panel to exactly one flag', () => {
    const ids = SIDEBAR_PANEL_FLAGS.map(([, id]) => id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
