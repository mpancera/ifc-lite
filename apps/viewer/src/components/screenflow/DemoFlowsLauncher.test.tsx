/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import '../../test/setup-dom.js';
import { installLayout } from '../../test/dom-layout.js';

installLayout();

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { cleanup, press, render } from '../../test/render.js';
import { patchScreenflowState, resetScreenflowState } from '@/lib/screenflow/screenflow-store';
import { DemoFlowsLauncher, closeDemoFlows, openDemoFlows } from './DemoFlowsLauncher.js';

/** Every declared demo file answers as present, so readiness is not the subject. */
function serveEverything(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('', { status: 200, headers: { 'content-type': 'application/octet-stream' } })) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

/** Nothing is served: every HEAD fails, the way an empty `demo-local` behaves. */
function serveNothing(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

/** The launcher portals to `document.body`, so assertions read the document. */
async function open(): Promise<void> {
  render(<DemoFlowsLauncher />);
  await act(async () => {
    openDemoFlows();
    // journeySteps() resolves on a microtask chain behind the HEAD requests.
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dialog(): Element | null {
  return document.querySelector('[role="dialog"][aria-label="Demo-Flows"]');
}

/** The five journey rows, not the demo-data rows below them. */
function stepRows(): Element[] {
  return [...(dialog()?.querySelectorAll('[aria-label="Journey-Schritte"] > li') ?? [])];
}

describe('DemoFlowsLauncher', () => {
  afterEach(() => {
    cleanup();
    closeDemoFlows();
    resetScreenflowState();
  });

  it('shows nothing until it is opened', () => {
    render(<DemoFlowsLauncher />);
    assert.equal(dialog(), null);
  });

  it('lists the five steps of the journey', async () => {
    const restore = serveEverything();
    try {
      await open();
      assert.equal(stepRows().length, 5, 'the journey is five steps');
    } finally {
      restore();
    }
  });

  it('offers a start only where there is a clip to start', async () => {
    const restore = serveEverything();
    try {
      await open();
      for (const row of stepRows()) {
        const text = row.textContent ?? '';
        const starts = [...row.querySelectorAll('button')].some((b) => /Vorführen/.test(b.textContent ?? ''));
        // A row that says "geplant" with a start button would hand the
        // presenter a button that does nothing in front of an audience.
        assert.equal(starts, !/geplant/.test(text), `wrong start offer on: ${text.slice(0, 40)}`);
      }
    } finally {
      restore();
    }
  });

  it('offers every demo slot, not only the ones a step happens to need', async () => {
    // The federation models belong to no step of the journey. When the upload
    // sat beside the step that needed a file, they were unreachable — there
    // was no control for them anywhere, so they could not be supplied at all.
    const restore = serveEverything();
    try {
      await open();
      const text = dialog()?.textContent ?? '';
      for (const name of ['demo-architecture.ifc', 'demo-fire-detection.ifc', 'demo-plan.dxf']) {
        assert.ok(text.includes(name), `no row for ${name}`);
      }
    } finally {
      restore();
    }
  });

  it('says which file is missing rather than offering a dead start', async () => {
    const restore = serveNothing();
    try {
      await open();
      const text = dialog()?.textContent ?? '';
      assert.match(text, /Daten fehlen/);
      assert.match(text, /\.dxf|\.ifc/, 'the row does not name the file that is missing');
    } finally {
      restore();
    }
  });

  it('steps aside once a flow is running', async () => {
    const restore = serveEverything();
    try {
      await open();
      assert.ok(dialog(), 'nothing was open to step aside');
      // A flow owns the whole screen, and anything still on top of it is in
      // the recording -- the reason this is a dialog and not a docked panel.
      await act(async () => { patchScreenflowState({ status: 'playing' }); });
      assert.equal(dialog(), null);
    } finally {
      restore();
    }
  });

  it('closes on Escape', async () => {
    const restore = serveEverything();
    try {
      await open();
      assert.ok(dialog(), 'nothing was open to close');
      press(window, 'Escape');
      assert.equal(dialog(), null);
    } finally {
      restore();
    }
  });
});
