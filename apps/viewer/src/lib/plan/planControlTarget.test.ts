/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '@/test/setup-dom.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPlanControlTarget } from './planControlTarget.js';

function build(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('isPlanControlTarget', () => {
  it('recognises the toolbar button that caused this', () => {
    // Pressing "3D" selected whatever line lay under the button, because the
    // toolbar sits inside the element that handles the plan's clicks.
    const host = build('<div class="toolbar"><button id="b">3D</button></div>');
    assert.equal(isPlanControlTarget(host.querySelector('#b')), true);
  });

  it('counts the icon inside a button as the button', () => {
    // What the pointer lands on is usually the svg or the label, not the button.
    const host = build('<button><svg id="i"></svg><span id="t">2D</span></button>');
    assert.equal(isPlanControlTarget(host.querySelector('#i')), true);
    assert.equal(isPlanControlTarget(host.querySelector('#t')), true);
  });

  it('leaves the drawing alone', () => {
    // The canvas and the overlays are children too, and clicking them MUST
    // still select — a guard that swallowed those would trade one broken
    // selection for a plan nothing can be selected in.
    const host = build('<canvas id="c"></canvas><svg id="s"><path id="p"/></svg>');
    assert.equal(isPlanControlTarget(host.querySelector('#c')), false);
    assert.equal(isPlanControlTarget(host.querySelector('#p')), false);
  });

  it('covers a menu built out of divs with roles', () => {
    const host = build('<div role="menu"><div role="menuitem" id="m">Gerätesymbole</div></div>');
    assert.equal(isPlanControlTarget(host.querySelector('#m')), true);
  });

  it('survives a target that is not an element', () => {
    assert.equal(isPlanControlTarget(null), false);
    assert.equal(isPlanControlTarget(document), false);
  });
});
