/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Issuing the whole set of deliverables in one go.
 *
 * # Why it drives the plan rather than rendering beside it
 * A drawing is what is on screen: the plan's own state — the storey it cuts,
 * the product supplying its symbols and rotation, the layers switched on —
 * decides what the export contains. A runner that assembled that state
 * somewhere else would produce a file that does not match the one the operator
 * approved, and it would drift the first time either side changed. So the run
 * puts the plan into each product's state, waits for the sheet to actually
 * arrive, and asks it to write itself.
 *
 * # Why it is a plain function and not a hook
 * The earlier design note called for `useExportBatch`, on the reasoning that
 * the writers are React. They are — but they are already reachable through
 * `requestPlanExport`, which the plan answers wherever it is mounted. What is
 * left is a sequence with waits in it, and that is an async function. A hook
 * would tie the run to one component's lifetime: navigate away mid-batch and
 * half the submission is missing, with no error anywhere.
 *
 * # Why it refuses before it starts
 * `productBlocker` is asked for every product first. A run that writes four
 * files and stops on the fifth leaves somebody with half a submission and no
 * obvious way to tell which half — and it is a folder of files, so nothing on
 * screen afterwards says what is missing.
 */

/**
 * The viewer store, as a value rather than a singleton import.
 *
 * Passed in so a test can drive the run against a store it built, and so this
 * module has no opinion about which store is the app's.
 */
type ViewerStoreApi = typeof import('@/store').useViewerStore;
import type { PlanProduct } from '@/lib/planProducts/planProducts';
import { planDrawingState } from '@/lib/plan/planViewport';
import { batchProducts, productBlocker, type ExportProduct } from './exportProducts';

/**
 * How long one sheet may take to cut, and how long the plan may take to write
 * it once asked.
 *
 * A minute each because cutting a real storey out of a real building is not
 * fast, and a batch that gave up early would report a failure for a sheet that
 * was seconds from arriving. Overridable so a test can exercise the
 * give-up path without waiting a minute for it — three of them did, and a
 * three-minute test file is one nobody runs.
 */
export const DEFAULT_BATCH_TIMEOUTS = { sheetMs: 60_000, writeMs: 60_000 } as const;

export interface BatchTimeouts {
  readonly sheetMs: number;
  readonly writeMs: number;
}

export interface BatchOutcome {
  /** Products written, in the order they were written. */
  readonly written: string[];
  /** Product id to the reason it could not be written. */
  readonly failures: Readonly<Record<string, string>>;
  /** Set when the run never started, with the reason. */
  readonly refused: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until `check` is true, or give up.
 *
 * Polling rather than subscribing because two of the three things waited on —
 * the plan's status and its drawing — are deliberately not store state: they
 * change on every regenerate and only this runner reads them.
 */
async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await sleep(120);
  }
  return check();
}

/** Put the plan into the state one product describes. */
function applyProduct(store: ViewerStoreApi, product: ExportProduct): void {
  const state = store.getState();
  if (product.kind !== 'plan2d') return;
  state.setActivePlanProduct(product.planProductId);
  if (product.storeyId !== null) {
    // The plan reads `activeStorey` — the same field the hierarchy and the
    // storey tabs drive — so a batch moves the whole view, visibly. That is
    // the honest behaviour: the files being written ARE these sheets.
    const modelId = [...state.models.keys()][0];
    if (modelId) state.setActiveStorey({ modelId, expressId: product.storeyId });
  }
  if (state.viewMode !== '2d') state.setViewMode('2d');
}

/** Whether the plan is showing the sheet this product asked for. */
function sheetIsUp(product: ExportProduct): boolean {
  const drawing = planDrawingState();
  if (!drawing) return false;
  if (drawing.status !== 'ready') return false;
  if (product.kind !== 'plan2d') return false;
  if (drawing.planProductId !== product.planProductId) return false;
  // `null` means "whichever storey is active", so any storey satisfies it.
  if (product.storeyId !== null && drawing.storeyExpressId !== product.storeyId) return false;
  return drawing.hasDrawing;
}

/**
 * Run the batch. Resolves when every product has been written or refused.
 *
 */
export async function runExportBatch(
  store: ViewerStoreApi,
  planProducts: readonly PlanProduct[],
  timeouts: BatchTimeouts = DEFAULT_BATCH_TIMEOUTS,
): Promise<BatchOutcome> {
  const products = batchProducts(store.getState().exportProducts);
  if (products.length === 0) {
    return { written: [], failures: {}, refused: 'Kein Produkt für den Stapel ausgewählt' };
  }

  // Every blocker up front — see the note at the top of this file.
  const blocked = products
    .map((product) => ({ product, why: productBlocker(product, planProducts) }))
    .filter((entry): entry is { product: ExportProduct; why: string } => entry.why !== null);
  if (blocked.length > 0) {
    const names = blocked.map((entry) => `${entry.product.name}: ${entry.why}`).join('; ');
    return { written: [], failures: {}, refused: `Der Stapel kann so nicht laufen — ${names}` };
  }

  const state = store.getState();
  state.beginExportRun(products.length);

  const written: string[] = [];
  const failures: Record<string, string> = {};

  for (const product of products) {
    applyProduct(store, product);

    if (!await waitUntil(() => sheetIsUp(product), timeouts.sheetMs)) {
      const drawing = planDrawingState();
      failures[product.id] = drawing === null
        ? 'Der Grundriss ist nicht offen'
        : drawing.hasDrawing
          ? `Der Grundriss zeigt noch «${drawing.planProductId ?? 'nichts'}»`
          : 'Auf diesem Geschoss liegt auf Schnitthöhe nichts';
      store.getState().reportExportProduct(product.id, failures[product.id]);
      continue;
    }

    store.getState().requestPlanExport(product.format as 'pdf' | 'svg' | 'dxf');
    // The plan clears the field when it has taken the request. A download is
    // not a store fact — proving the file landed would mean reading the user's
    // disk — so "the plan took it" is the strongest honest signal there is.
    const taken = await waitUntil(
      () => store.getState().planExportRequested === null,
      timeouts.writeMs,
    );
    if (!taken) {
      failures[product.id] = 'Der Grundriss hat die Ausgabe nicht angenommen';
      store.getState().requestPlanExport(null);
      store.getState().reportExportProduct(product.id, failures[product.id]);
      continue;
    }

    written.push(product.id);
    store.getState().reportExportProduct(product.id);
    // A breath between files: three downloads fired in the same tick are three
    // downloads the browser may collapse into one prompt.
    await sleep(400);
  }

  store.getState().endExportRun();
  return { written, failures, refused: null };
}
