/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ZONE_SET_THEME_ID, zoneSetTheme } from './set-theme.js';

describe('zoneSetTheme', () => {
  it('finds the theme a set names', () => {
    assert.equal(zoneSetTheme({ themeId: 'fire-compartment' }).id, 'fire-compartment');
  });

  it('calls a set with no theme a construction section', () => {
    // Every themeless set predates the field, and every one of those is a takt
    // area or a building phase — that is what the feature was built for, and
    // CONSTRUCTION is what the emitter has always written for them.
    assert.equal(zoneSetTheme({}).id, DEFAULT_ZONE_SET_THEME_ID);
    assert.equal(zoneSetTheme({ themeId: undefined }).id, 'construction');
    assert.equal(zoneSetTheme({ themeId: '' }).id, 'construction');
  });

  it('calls a theme it does not know "not defined", NOT a construction section', () => {
    // The opposite case: a newer catalogue wrote a theme this build has never
    // heard of. Answering "construction" would label someone's fire
    // compartment as scaffolding in the exported file; answering "not
    // classified" is the one thing that is certainly true.
    assert.equal(zoneSetTheme({ themeId: 'gibt-es-nicht' }).id, 'notdefined');
    assert.equal(zoneSetTheme({ themeId: 'gibt-es-nicht' }).spatialPredefinedType, 'NOTDEFINED');
  });
});
