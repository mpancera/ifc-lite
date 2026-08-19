/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The room settings the panel offers, as state.
 *
 * Two things are pinned here rather than in a component test, because both are
 * about what the generator is asked for and neither is about pixels:
 *
 * - the boundary mode has a value at all, and it is the room face. It decides
 *   what every area in a room schedule MEANS, and it used to be settable
 *   nowhere — the panel never passed it, so the generator's own default was
 *   the only answer anybody could get.
 * - the three ways to make a room are one selection, so the panel can show one
 *   of them instead of stacking all three.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from '../index.js';

const initial = useViewerStore.getState();

beforeEach(() => {
  useViewerStore.setState({
    addElementAutoSpaceParams: { ...initial.addElementAutoSpaceParams },
    addElementSpaceSource: 'draw',
  });
});

describe('room settings', () => {
  it('starts at the room face, which is what a room schedule means by area', () => {
    assert.equal(useViewerStore.getState().addElementAutoSpaceParams.BoundaryMode, 'inner');
  });

  it('keeps the boundary mode when another detection setting changes', () => {
    // The params are one object; a partial update that dropped a sibling
    // would silently put the areas back on the wall centrelines.
    useViewerStore.getState().setAddElementAutoSpaceParams({ BoundaryMode: 'center' });
    useViewerStore.getState().setAddElementAutoSpaceParams({ MinArea: 4 });

    const params = useViewerStore.getState().addElementAutoSpaceParams;
    assert.equal(params.BoundaryMode, 'center');
    assert.equal(params.MinArea, 4);
  });

  it('holds one of the three sources, and switching is exclusive', () => {
    useViewerStore.getState().setAddElementSpaceSource('walls');
    assert.equal(useViewerStore.getState().addElementSpaceSource, 'walls');

    useViewerStore.getState().setAddElementSpaceSource('plan');
    assert.equal(useViewerStore.getState().addElementSpaceSource, 'plan');
  });

  it('starts on drawing, the one source that needs nothing of the model', () => {
    // A panel that opened on "from walls" would look broken on a model whose
    // walls the detector cannot use, before the user had chosen anything.
    assert.equal(initial.addElementSpaceSource, 'draw');
  });
});
