/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `Linienmodule je Zone` — the button that finally calls `ensureLineControllers`.
 *
 * The store action shipped without a caller and stayed that way: it looked
 * finished from the slice and was dead from the app. So the first test here is
 * the crude one — the click reaches the store at all, with the ACTIVE model's
 * id. Swap `onClick={prepare}` for a no-op, or hand the action the wrong id,
 * and it goes red; that is the whole defect this wiring exists to close.
 *
 * The rest guard the report. The action's three counters can add up to "wrote
 * nothing" in two different ways — every zone already had a module, or every
 * zone was skipped for want of a room — and a green success toast over either
 * of them tells the planner a job was done that was not. Each case is asserted
 * on the toast CHANNEL, not just its text, because that is what carries the
 * claim: `info` says nothing changed, `success` says something did.
 */

import '@/test/setup-dom.js';

import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { render, cleanup, click } from '@/test/render.js';
import { useViewerStore, type ViewerState } from '@/store';
import { fixtureModel, fixtureModels } from '@/test/store-fixture.js';
import { toast } from '@/components/ui/toast';
import { WiringPanel } from './WiringPanel.js';

const MODEL_ID = 'model-under-test';

let initialState: ViewerState;

/** Seed a loaded model and swap `ensureLineControllers` for a recording double. */
function seed(result: ReturnType<ViewerState['ensureLineControllers']>) {
  const calls: string[] = [];
  useViewerStore.setState({
    ...fixtureModels(fixtureModel(MODEL_ID)),
    wiringSequence: [],
    wiringRing: false,
    ensureLineControllers: (modelId: string) => {
      calls.push(modelId);
      return result;
    },
  } as Partial<ViewerState>);
  return calls;
}

/** The preparation button, found by its label rather than by DOM position. */
function prepareButton(container: HTMLElement): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('button')].filter(
    (el) => el.textContent?.trim() === 'Linienmodule je Zone',
  );
  assert.equal(found.length, 1, `expected exactly one prepare button, found ${found.length}`);
  return found[0];
}

describe('WiringPanel — Linienmodule je Zone', () => {
  before(() => {
    initialState = useViewerStore.getState();
  });

  afterEach(() => {
    cleanup();
    useViewerStore.setState(initialState, true);
  });

  after(() => {
    useViewerStore.setState(initialState, true);
  });

  it('clicking it calls ensureLineControllers with the active model id', () => {
    const calls = seed({ created: 2, skipped: 0, zonesWithoutRoom: 0 });
    const container = render(<WiringPanel onClose={() => {}} />);

    click(prepareButton(container));

    assert.deepEqual(calls, [MODEL_ID]);
  });

  it('reports what it wrote, and names the zones it left alone', () => {
    const successMock = mock.method(toast, 'success', () => {});
    try {
      seed({ created: 2, skipped: 3, zonesWithoutRoom: 0 });
      const container = render(<WiringPanel onClose={() => {}} />);

      click(prepareButton(container));

      assert.equal(successMock.mock.callCount(), 1);
      const message = successMock.mock.calls[0].arguments[0] as string;
      // Both halves matter: the run is meant to be repeatable, so a second
      // pass has to say it recognised its own earlier work rather than
      // reporting two modules out of five zones as the whole story.
      assert.match(message, /2 Linienmodule angelegt/);
      assert.match(message, /3 bereits vorhanden/);
    } finally {
      successMock.mock.restore();
    }
  });

  it('does not claim success when every zone already had its module', () => {
    const successMock = mock.method(toast, 'success', () => {});
    const infoMock = mock.method(toast, 'info', () => {});
    try {
      seed({ created: 0, skipped: 4, zonesWithoutRoom: 0 });
      const container = render(<WiringPanel onClose={() => {}} />);

      click(prepareButton(container));

      assert.equal(successMock.mock.callCount(), 0, 'a no-op must not be reported as success');
      assert.equal(infoMock.mock.callCount(), 1);
    } finally {
      successMock.mock.restore();
      infoMock.mock.restore();
    }
  });

  it('does not claim success when every zone was skipped for want of a room', () => {
    const successMock = mock.method(toast, 'success', () => {});
    const infoMock = mock.method(toast, 'info', () => {});
    try {
      seed({ created: 0, skipped: 0, zonesWithoutRoom: 2 });
      const container = render(<WiringPanel onClose={() => {}} />);

      click(prepareButton(container));

      assert.equal(successMock.mock.callCount(), 0, 'nothing was written — this is not a success');
      assert.equal(infoMock.mock.callCount(), 1);
      // The planner has to learn WHY nothing appeared, or the button reads as
      // broken: the zones exist but no room has been painted into them yet.
      assert.match(infoMock.mock.calls[0].arguments[0] as string, /2 Zonen ohne Raum/);
    } finally {
      successMock.mock.restore();
      infoMock.mock.restore();
    }
  });

  it('surfaces the store refusal instead of a success toast', () => {
    const successMock = mock.method(toast, 'success', () => {});
    const errorMock = mock.method(toast, 'error', () => {});
    try {
      seed({ error: 'Keine Auslösezone gefunden' });
      const container = render(<WiringPanel onClose={() => {}} />);

      click(prepareButton(container));

      assert.equal(successMock.mock.callCount(), 0);
      assert.equal(errorMock.mock.callCount(), 1);
      assert.match(errorMock.mock.calls[0].arguments[0] as string, /Keine Auslösezone/);
    } finally {
      successMock.mock.restore();
      errorMock.mock.restore();
    }
  });
});
