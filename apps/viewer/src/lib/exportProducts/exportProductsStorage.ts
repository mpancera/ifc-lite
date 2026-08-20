/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Remembering what a project is issued as.
 *
 * Project-scoped, unlike the plan products in `lib/planProducts`, and the
 * difference is worth stating because the two look alike. A plan product is a
 * TEMPLATE — "a Feuerwehrlageplan is drawn like this" — and is worth having in
 * every project. An export list is a DELIVERY SCHEDULE: which drawings this
 * building owes, at which storeys. Carried between projects it would offer the
 * last building's storeys for this one's submission.
 */

import type { ProjectKey } from '@ifc-lite/project';
import { readScoped, writeScoped, clearScoped } from '@/lib/project/scopedStorage';
import {
  isFormatValid, defaultFormat,
  type ExportProduct, type ExportProductKind, type ExportFormat,
} from './exportProducts.js';

const STORAGE_KEY = 'ifc-lite:export-products';

const KINDS: ReadonlySet<string> = new Set<ExportProductKind>(['plan2d', 'list', 'graph']);

/**
 * Read stored products, skipping anything unusable.
 *
 * Skipping rather than failing, as everywhere else: one product hand-edited
 * into nonsense should cost that product, not somebody's whole delivery list.
 */
export function parseExportProducts(payload: unknown): ExportProduct[] {
  if (!Array.isArray(payload)) return [];

  const products: ExportProduct[] = [];
  const seen = new Set<string>();

  for (const item of payload) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const kind = typeof record.kind === 'string' ? record.kind : '';
    if (!id || !KINDS.has(kind)) continue;
    // A duplicate id would make the panel edit two rows at once, and the batch
    // would overwrite one file with the other.
    if (seen.has(id)) continue;
    seen.add(id);

    const name = typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : id;
    // A format that does not fit the kind — a plan stored as CSV — is dropped
    // back to the kind's default rather than rejected: the product is still
    // meaningful, only its output setting was wrong.
    const stored = record.format as ExportFormat;
    const format = isFormatValid(kind as ExportProductKind, stored)
      ? stored
      : defaultFormat(kind as ExportProductKind);
    const inBatch = record.inBatch !== false;

    if (kind === 'plan2d') {
      const planProductId = typeof record.planProductId === 'string'
        ? record.planProductId.trim()
        : '';
      // Without it the product cannot name a drawing at all.
      if (!planProductId) continue;
      products.push({
        kind: 'plan2d', id, name, inBatch, format, planProductId,
        storeyId: typeof record.storeyId === 'number' && Number.isFinite(record.storeyId)
          ? record.storeyId
          : null,
      });
      continue;
    }

    if (kind === 'list') {
      const listId = typeof record.listId === 'string' ? record.listId.trim() : '';
      if (!listId) continue;
      products.push({ kind: 'list', id, name, inBatch, format, listId });
      continue;
    }

    const chainId = typeof record.chainId === 'string' ? record.chainId.trim() : '';
    // Both halves or nothing: a chain with no starting classes draws an empty
    // diagram, and an empty diagram reads as an answer.
    const startTypes = Array.isArray(record.startTypes)
      ? record.startTypes.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : [];
    if (!chainId || startTypes.length === 0) continue;
    products.push({ kind: 'graph', id, name, inBatch, format, chainId, startTypes });
  }

  return products;
}

/** This project's delivery list. Empty until somebody builds one. */
export function loadExportProducts(project: ProjectKey | null): ExportProduct[] {
  const raw = readScoped(STORAGE_KEY, project);
  if (raw === null) return [];

  try {
    return parseExportProducts(JSON.parse(raw));
  } catch (error) {
    console.warn(`[export] ignoring malformed products in ${STORAGE_KEY}`, error);
    return [];
  }
}

/** Save the list, or clear it when the last product is removed. */
export function saveExportProducts(
  project: ProjectKey | null,
  products: readonly ExportProduct[],
): void {
  if (products.length === 0) {
    clearScoped(STORAGE_KEY, project);
    return;
  }
  writeScoped(STORAGE_KEY, project, JSON.stringify(products));
}

/**
 * An id that no product in the list is using.
 *
 * Counts up rather than using a timestamp: an id somebody may end up reading
 * in a filename should be legible, and two products created in the same
 * millisecond would collide anyway.
 */
export function nextProductId(
  products: readonly ExportProduct[],
  prefix: string,
): string {
  const taken = new Set(products.map((product) => product.id));
  for (let index = 1; ; index += 1) {
    const candidate = `${prefix}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}
