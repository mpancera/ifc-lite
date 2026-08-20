/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The batch run, driven against a stand-in store and a stand-in plan.
 *
 * What is worth pinning here is not that a happy path resolves — it is the two
 * ways a batch quietly ruins a submission: writing the previous sheet under
 * the next one's filename because it did not wait, and stopping halfway with
 * no way to tell which half is missing. Both are timing, so both are tested by
 * making the fake plan slow on purpose.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setPlanDrawingState } from '../plan/planViewport.js';
import { runExportBatch } from './runExportBatch.js';
import type { ExportProduct } from './exportProducts.js';
import type { PlanProduct } from '../planProducts/planProducts.js';

/** Short enough to exercise the give-up paths without waiting a real minute. */
const QUICK = { sheetMs: 900, writeMs: 900 };

const PLAN: PlanProduct = { id: 'plan-a', name: 'Grundriss A' } as PlanProduct;
const PLAN_B: PlanProduct = { id: 'plan-b', name: 'Grundriss B' } as PlanProduct;

function product(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    kind: 'plan2d',
    id: 'p1',
    name: 'Blatt 1',
    inBatch: true,
    format: 'pdf',
    planProductId: 'plan-a',
    storeyId: null,
    ...over,
  } as ExportProduct;
}

/**
 * A store with only what the runner touches, plus a record of what it did.
 *
 * Hand-built rather than the real one: the run's contract is a sequence of
 * calls in an order, and a real store would let a passing test hide a missing
 * call behind some other slice's default.
 */
function fakeStore(products: ExportProduct[]) {
  const calls: string[] = [];
  const state = {
    exportProducts: products,
    models: new Map([['m1', {}]]),
    viewMode: '2d',
    planExportRequested: null as string | null,
    activeStorey: null as unknown,
    setActivePlanProduct: (id: string) => { calls.push(`plan:${id}`); },
    setActiveStorey: (ref: { expressId: number }) => { calls.push(`storey:${ref.expressId}`); },
    setViewMode: (m: string) => { calls.push(`view:${m}`); state.viewMode = m; },
    requestPlanExport: (f: string | null) => {
      calls.push(f === null ? 'clear' : `export:${f}`);
      state.planExportRequested = f;
    },
    beginExportRun: (total: number) => { calls.push(`begin:${total}`); },
    reportExportProduct: (id: string, failure?: string) => {
      calls.push(failure ? `fail:${id}` : `done:${id}`);
    },
    endExportRun: () => { calls.push('end'); },
  };
  const store = { getState: () => state } as unknown as Parameters<typeof runExportBatch>[0];
  return { store, state, calls };
}

/** The plan answers an export request after `delayMs`, as the real one does. */
function autoAnswer(state: { planExportRequested: string | null }, delayMs = 0): () => void {
  const timer = setInterval(() => {
    if (state.planExportRequested !== null) {
      setTimeout(() => { state.planExportRequested = null; }, delayMs);
    }
  }, 20);
  return () => clearInterval(timer);
}

afterEach(() => setPlanDrawingState(null));

describe('runExportBatch', () => {
  it('refuses an empty selection instead of reporting a run of nothing', async () => {
    const { store } = fakeStore([product({ inBatch: false })]);
    const outcome = await runExportBatch(store, [PLAN], QUICK);
    assert.match(outcome.refused ?? '', /Kein Produkt/);
    assert.deepEqual(outcome.written, []);
  });

  it('refuses BEFORE writing anything when one product is blocked', async () => {
    // The whole point of checking up front: four files and a stop on the fifth
    // leaves a half submission that nothing on screen explains.
    const { store, calls } = fakeStore([
      product({ id: 'ok' }),
      product({ id: 'gone', planProductId: 'plan-does-not-exist' }),
    ]);
    setPlanDrawingState({ storeyExpressId: null, planProductId: 'plan-a', status: 'ready', hasDrawing: true });
    const outcome = await runExportBatch(store, [PLAN], QUICK);
    assert.ok(outcome.refused, 'the run went ahead with a blocked product');
    assert.equal(calls.length, 0, `nothing should have happened, got: ${calls.join(',')}`);
  });

  it('waits for the sheet it asked for before exporting it', async () => {
    const { store, state, calls } = fakeStore([
      product({ id: 'a', planProductId: 'plan-a', format: 'svg' }),
      product({ id: 'b', planProductId: 'plan-b', format: 'svg' }),
    ]);
    const stop = autoAnswer(state);
    // The plan lags: it is still showing A when B is asked for, and only
    // catches up later. Without the wait, B would be written from A's sheet.
    setPlanDrawingState({ storeyExpressId: null, planProductId: 'plan-a', status: 'ready', hasDrawing: true });
    const run = runExportBatch(store, [PLAN, PLAN_B], QUICK);
    setTimeout(() => {
      setPlanDrawingState({ storeyExpressId: null, planProductId: 'plan-b', status: 'ready', hasDrawing: true });
    }, 400);
    const outcome = await run;
    stop();

    assert.deepEqual(outcome.written, ['a', 'b']);
    // B's export must come after the plan reported plan-b, which the ordering
    // of the recorded calls carries: switch, then export, per product.
    assert.deepEqual(
      calls.filter((c) => c.startsWith('plan:') || c.startsWith('export:')),
      ['plan:plan-a', 'export:svg', 'plan:plan-b', 'export:svg'],
    );
  });

  it('carries on past a sheet that never arrives, and says which one', async () => {
    const { store, state, calls } = fakeStore([
      product({ id: 'missing', planProductId: 'plan-b' }),
      product({ id: 'fine', planProductId: 'plan-a' }),
    ]);
    const stop = autoAnswer(state);
    // Only plan-a ever comes up, so the first product times out. It must not
    // take the second one down with it.
    setPlanDrawingState({ storeyExpressId: null, planProductId: 'plan-a', status: 'ready', hasDrawing: true });
    const outcome = await runExportBatch(store, [PLAN, PLAN_B], QUICK);
    stop();

    assert.deepEqual(outcome.written, ['fine']);
    assert.ok(outcome.failures.missing, 'the timed-out product was not reported');
    assert.ok(calls.includes('fail:missing'));
    assert.ok(calls.includes('done:fine'));
    assert.equal(calls.at(-1), 'end', 'the run must close even after a failure');
  });

  it('says the plan is not open rather than blaming the product', async () => {
    const { store, state } = fakeStore([product({ id: 'p' })]);
    const stop = autoAnswer(state);
    setPlanDrawingState(null);
    const outcome = await runExportBatch(store, [PLAN], QUICK);
    stop();
    assert.match(outcome.failures.p ?? '', /nicht offen/);
  });

  it('refuses to export a storey with nothing on the cut', async () => {
    const { store, state } = fakeStore([product({ id: 'p' })]);
    const stop = autoAnswer(state);
    // An empty sheet writes a valid, blank file — which is worse than an
    // error, because it looks like a delivered drawing.
    setPlanDrawingState({ storeyExpressId: null, planProductId: 'plan-a', status: 'ready', hasDrawing: false });
    const outcome = await runExportBatch(store, [PLAN], QUICK);
    stop();
    assert.match(outcome.failures.p ?? '', /nichts/);
  });
});
