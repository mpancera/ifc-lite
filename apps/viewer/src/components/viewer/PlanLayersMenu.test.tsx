/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The 2D layer menu: names every derived layer, says how many of each the
 * storey has, and switches one without closing on the first click.
 *
 * Radix opens a dropdown on `pointerdown` and portals its items onto the body,
 * so the queries here look there rather than inside the container.
 */

import '@/test/setup-dom.js';
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { render, click, cleanup } from '@/test/render.js';
import { PlanLayersMenu, type PlanLayer } from './PlanLayersMenu.js';

function layers(overrides: Partial<PlanLayer>[] = []): PlanLayer[] {
  const base: PlanLayer[] = [
    { id: 'rooms', label: 'Raumnummer und -name', count: 16, visible: true, onToggle: () => {} },
    { id: 'doors', label: 'Türnummern', count: 34, visible: true, onToggle: () => {} },
    { id: 'devices', label: 'Gerätesymbole', count: 0, visible: true, onToggle: () => {}, unavailable: 'Auf diesem Geschoss liegen keine Geräte' },
  ];
  return base.map((layer, i) => ({ ...layer, ...(overrides[i] ?? {}) }));
}

function open(list: PlanLayer[]) {
  const container = render(<PlanLayersMenu layers={list} />);
  const trigger = container.querySelector('[data-testid="plan-layers-menu"]');
  assert.ok(trigger, 'expected the menu trigger');
  // Radix opens on pointerdown, not on click.
  act(() => {
    trigger!.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
  });
  click(trigger!);
  return document.body;
}

function itemFor(label: string): HTMLElement {
  const found = [...document.body.querySelectorAll('[role="menuitem"]')]
    .find((el) => el.textContent?.includes(label));
  assert.ok(found, `kein Eintrag „${label}"`);
  return found as HTMLElement;
}

beforeEach(() => cleanup());
after(() => cleanup());

describe('PlanLayersMenu', () => {
  it('names every layer and how many of each there are', () => {
    // Six pictograms in a row said nothing until each was hovered; a list says
    // it out loud, and the count says whether switching it on will do anything.
    const body = open(layers());
    assert.ok(body.textContent?.includes('Raumnummer und -name'));
    assert.ok(body.textContent?.includes('Türnummern'));
    assert.ok(body.textContent?.includes('34'));
  });

  it('switches room text and door tags separately', () => {
    // The reported need: a fire plan wants the rooms named with the door
    // numbers out of the escape route's way.
    let rooms = 0;
    let doors = 0;
    open(layers([{ onToggle: () => { rooms += 1; } }, { onToggle: () => { doors += 1; } }]));

    click(itemFor('Türnummern'));
    assert.equal(doors, 1);
    assert.equal(rooms, 0, 'the room text is a different layer');
  });

  it('stays open, so several layers are one trip', () => {
    open(layers());
    click(itemFor('Türnummern'));
    assert.ok(document.body.querySelector('[role="menuitem"]'), 'menu closed after one click');
  });

  it('says why a layer cannot be shown instead of doing nothing', () => {
    let toggled = 0;
    open(layers([{}, {}, { onToggle: () => { toggled += 1; } }]));
    const item = itemFor('Gerätesymbole');

    assert.equal(item.getAttribute('aria-disabled'), 'true');
    assert.equal(item.getAttribute('title'), 'Auf diesem Geschoss liegen keine Geräte');
    click(item);
    assert.equal(toggled, 0);
  });

  it('marks the trigger while something is hidden', () => {
    const container = render(<PlanLayersMenu layers={layers([{ visible: false }])} />);
    const trigger = container.querySelector('[data-testid="plan-layers-menu"]');
    assert.equal(trigger?.getAttribute('aria-pressed'), 'true');
  });
});
