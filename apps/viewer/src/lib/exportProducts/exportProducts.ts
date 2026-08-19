/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Everything this model is meant to be ISSUED as.
 *
 * A project does not produce one drawing. It produces a set of deliverables —
 * two fire drawings today, a room schedule, a device list, a system diagram —
 * and the thing people actually want is to press one button and get all of
 * them, reproducibly, rather than to remember the eleven settings each one
 * needs and repeat that by hand every revision.
 *
 * # Why a kind rather than separate lists
 * A batch that can only hold drawings is a batch that has to be rebuilt the
 * day somebody wants a list in it. So an export product is a discriminated
 * union from the start, and the batch runner never learns what a plan is: it
 * asks each product to produce a file. Today there is exactly one kind and the
 * union looks like ceremony; the alternative is that the second kind rewrites
 * the panel, the storage and the runner.
 *
 * # What a product is NOT
 * Not a saved file, and not a record of one. It is the RECIPE — what to
 * select, how to draw it, on what sheet. Running it twice on a changed model
 * gives two different files, which is the point: the deliverable follows the
 * model rather than being a snapshot somebody has to remember to refresh.
 */

import type { PlanProduct } from '@/lib/planProducts/planProducts';

/** What kind of deliverable a product produces. */
export type ExportProductKind = 'plan2d' | 'list' | 'graph';

/** The formats a product can be written as. */
export type ExportFormat = 'pdf' | 'svg' | 'dxf' | 'csv' | 'json';

/** Fields every product carries, whatever it produces. */
interface ExportProductBase {
  /** Stable key. Never shown, never translated. */
  readonly id: string;
  /** What the author sees in the list. */
  readonly name: string;
  /**
   * Whether this product is part of the next batch run.
   *
   * On the product rather than in a separate selection: "which of these do I
   * issue" is a decision worth keeping between sessions, and a selection that
   * resets on reload gets re-made by hand every time.
   */
  readonly inBatch: boolean;
  /** The format the batch writes this product as. */
  readonly format: ExportFormat;
}

/** A 2D drawing: a plan product on a sheet. */
export interface Plan2DExportProduct extends ExportProductBase {
  readonly kind: 'plan2d';
  /** Which plan product supplies the selection, symbols, rotation and sheet. */
  readonly planProductId: string;
  /**
   * Which storey to draw, or `null` for whichever is active.
   *
   * `null` is the useful default while somebody is working, and a named storey
   * is what makes a batch reproducible — a run that draws "whatever was on
   * screen" produces a different set every time.
   */
  readonly storeyId: number | null;
}

/**
 * A tabular deliverable. Not built yet — declared so the batch runner and the
 * storage have the shape they will need, and so adding it does not reopen
 * either of them.
 */
export interface ListExportProduct extends ExportProductBase {
  readonly kind: 'list';
  /** Which saved list definition supplies the columns and the filter. */
  readonly listId: string;
}

/** A diagram deliverable. Not built yet — see {@link ListExportProduct}. */
export interface GraphExportProduct extends ExportProductBase {
  readonly kind: 'graph';
  readonly graphViewId: string;
}

export type ExportProduct =
  | Plan2DExportProduct
  | ListExportProduct
  | GraphExportProduct;

/** Which formats a kind can actually be written as. */
export const FORMATS_BY_KIND: Readonly<Record<ExportProductKind, readonly ExportFormat[]>> = {
  // A drawing goes to paper or to CAD. CSV of a drawing is meaningless.
  plan2d: ['pdf', 'svg', 'dxf'],
  list: ['csv', 'json'],
  graph: ['svg', 'json'],
};

/** Whether a format is valid for a kind. */
export function isFormatValid(kind: ExportProductKind, format: ExportFormat): boolean {
  return FORMATS_BY_KIND[kind].includes(format);
}

/** The format a newly created product of this kind starts with. */
export function defaultFormat(kind: ExportProductKind): ExportFormat {
  return FORMATS_BY_KIND[kind][0];
}

/** Human label for a kind, for the panel's grouping headers. */
export const KIND_LABELS: Readonly<Record<ExportProductKind, string>> = {
  plan2d: 'Pläne',
  list: 'Listen',
  graph: 'Diagramme',
};

/**
 * The products a batch run would produce, in the order it produces them.
 *
 * Order is the list's own, not sorted by kind: somebody who arranged their
 * deliverables in the order the submission expects should get that order in
 * the folder they end up with.
 */
export function batchProducts(products: readonly ExportProduct[]): ExportProduct[] {
  return products.filter((product) => product.inBatch);
}

/**
 * Characters a filename must not carry.
 *
 * Windows forbids these outright, and a slash or backslash would silently
 * create a folder instead of a file. Whitespace is deliberately NOT here: it
 * becomes a hyphen a step later, and listing it in both places means the
 * hyphen step never sees it — which is exactly the bug this once had.
 */
const FORBIDDEN_IN_FILENAME = /[<>:"/\\|?*]/g;

/**
 * A filename for one product, without the extension.
 *
 * Deliberately derived from the product NAME rather than from a counter: a
 * folder of `export-1.pdf` … `export-7.pdf` tells nobody which drawing is
 * which, and the whole point of a batch is not having to open them to find out.
 */
export function productFilename(product: ExportProduct): string {
  const cleaned = product.name
    .trim()
    .replace(FORBIDDEN_IN_FILENAME, '')
    // Runs of whitespace become one hyphen: `plan-brandschutzkonzept` reads,
    // `planbrandschutzkonzept` does not.
    .replace(/\s+/g, '-')
    // Whatever the two steps above left doubled up or dangling.
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return cleaned.length > 0 ? cleaned : product.id;
}

/**
 * Whether a product can run right now, and why not when it cannot.
 *
 * Checked before a batch starts rather than as each file is written: a run
 * that produces four files and then stops on the fifth leaves somebody with a
 * half-finished submission and no obvious way to tell which half.
 */
export function productBlocker(
  product: ExportProduct,
  planProducts: readonly PlanProduct[],
): string | null {
  if (product.kind === 'plan2d') {
    const plan = planProducts.find((candidate) => candidate.id === product.planProductId);
    if (!plan) return `Planprodukt "${product.planProductId}" gibt es nicht mehr`;
    return null;
  }
  // The two kinds below are declared but not built. Saying so plainly beats
  // producing an empty file that looks like a successful export.
  return product.kind === 'list'
    ? 'Listen-Export ist noch nicht gebaut'
    : 'Diagramm-Export ist noch nicht gebaut';
}

/** A new 2D product for a plan product, ready to be added to the list. */
export function newPlan2DProduct(
  plan: PlanProduct,
  id: string,
): Plan2DExportProduct {
  return {
    kind: 'plan2d',
    id,
    name: plan.name,
    inBatch: true,
    format: defaultFormat('plan2d'),
    planProductId: plan.id,
    storeyId: null,
  };
}
