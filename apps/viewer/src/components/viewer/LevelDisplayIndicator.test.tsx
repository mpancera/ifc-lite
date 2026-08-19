/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The level readout: says which storeys are showing, and does not switch them.
 *
 * Reported from real use — as a chip floating in the viewport's top-left it
 * covered the toolbar band beneath it, and it was a second place to leave Solo
 * beside the hierarchy panel that owns the mode. Both toolbars mount the same
 * component, so what "Solo" looks like cannot drift between them.
 */

import '@/test/setup-dom.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { render, cleanup } from '@/test/render.js';
import { useViewerStore } from '@/store/index.js';
import { LevelDisplayIndicator } from './LevelDisplayIndicator.js';

function seed(patch: Record<string, unknown>) {
  useViewerStore.setState({
    levelDisplayMode: 'stacked',
    explodedGap: 5,
    activeStorey: null,
    models: new Map(),
    ...patch,
  } as never);
}

beforeEach(() => cleanup());
after(() => cleanup());

describe('LevelDisplayIndicator', () => {
  it('says nothing while every storey is showing', () => {
    // Stacked is what a model looks like unless somebody said otherwise, so a
    // permanent badge for it would be noise on every model.
    seed({ levelDisplayMode: 'stacked' });
    const container = render(<LevelDisplayIndicator />);
    assert.equal(container.textContent, '');
  });

  it('names the mode while only one storey is showing', () => {
    seed({ levelDisplayMode: 'solo' });
    const container = render(<LevelDisplayIndicator />);
    assert.ok(container.textContent?.includes('Solo'), container.textContent ?? '');
  });

  it('reports the gap while the levels are exploded', () => {
    seed({ levelDisplayMode: 'exploded', explodedGap: 7 });
    const container = render(<LevelDisplayIndicator />);
    assert.ok(container.textContent?.includes('Exploded'), container.textContent ?? '');
    assert.ok(container.textContent?.includes('7'), container.textContent ?? '');
  });

  it('offers nothing to click, so the mode has one owner', () => {
    // The X that used to sit here was a second way out of Solo; the hierarchy
    // panel is the one that owns Stacked / Solo / Exploded.
    seed({ levelDisplayMode: 'solo' });
    const container = render(<LevelDisplayIndicator />);
    assert.equal(container.querySelectorAll('button').length, 0);
    assert.equal(container.querySelectorAll('[role="button"]').length, 0);
  });

  it('does not float over the viewport any more', () => {
    // The reported defect: `absolute top-4 left-4` put it on top of the
    // toolbar band. It now flows inside the strip that hosts it.
    seed({ levelDisplayMode: 'solo' });
    const container = render(<LevelDisplayIndicator />);
    const chip = container.querySelector('[data-level-display-indicator]');
    assert.ok(chip, 'expected the readout');
    const className = chip!.getAttribute('class') ?? '';
    assert.ok(!className.includes('absolute'), className);
  });
});
