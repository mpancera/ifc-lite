/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Loads a real element catalog from a local JSON file the user picks —
 * the "Firmenbibliothek" data source. Deliberately the simplest thing
 * that could work: no server, no file-system access beyond the browser's
 * own file picker, cached in IndexedDB so it survives a reload. Never
 * touches this repo — there is no code path that writes catalog content
 * to a file under version control.
 *
 * Swapping this for a live AAS registry client later is a new
 * `CatalogProvider` implementation, not a UI change — see `types.ts`.
 */

import type { CatalogEntry, CatalogProvider, CatalogSourceKind } from './types.js';
import { loadImportedCatalog, saveImportedCatalog, clearImportedCatalog } from './idbCatalogStorage.js';

const VALID_DISCIPLINES = new Set(['fire', 'security', 'intrusion', 'other']);
const VALID_MOUNTINGS = new Set(['ceiling', 'wall', 'floor', 'freestanding']);
const VALID_SOURCE_KINDS = new Set<CatalogSourceKind>(['local-seed', 'file-import', 'aas']);

export interface CatalogImportError {
  index: number;
  entryId: string | null;
  message: string;
}

export interface CatalogImportResult {
  entries: CatalogEntry[];
  /** Entries that failed validation and were dropped — the rest still import. */
  errors: CatalogImportError[];
}

/**
 * Validates one parsed JSON value as a `CatalogEntry`, normalising
 * `provenance.source` to `'file-import'` when the file doesn't declare a
 * recognised one (so a malformed/omitted field can't silently masquerade
 * as `'local-seed'`). Throws with a short reason on the first structural
 * problem — the caller collects these per-entry rather than failing the
 * whole import for one bad row.
 */
function validateEntry(raw: unknown, index: number): CatalogEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`entry ${index}: not an object`);
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id) throw new Error(`entry ${index}: missing "id"`);
  if (typeof e.label !== 'string' || !e.label) throw new Error(`entry ${index} (${e.id}): missing "label"`);
  if (typeof e.discipline !== 'string' || !VALID_DISCIPLINES.has(e.discipline)) {
    throw new Error(`entry ${index} (${e.id}): "discipline" must be one of fire/security/intrusion/other`);
  }
  if (typeof e.category !== 'string' || !e.category) throw new Error(`entry ${index} (${e.id}): missing "category"`);
  if (typeof e.mounting !== 'string' || !VALID_MOUNTINGS.has(e.mounting)) {
    throw new Error(`entry ${index} (${e.id}): "mounting" must be one of ceiling/wall/floor/freestanding`);
  }
  const ifc = e.ifc as Record<string, unknown> | undefined;
  if (!ifc || typeof ifc.entity !== 'string' || !ifc.entity.startsWith('Ifc')) {
    throw new Error(`entry ${index} (${e.id}): "ifc.entity" must be an IFC entity name`);
  }
  const geometry = e.geometry as Record<string, unknown> | undefined;
  if (
    !geometry ||
    typeof geometry.width !== 'number' || geometry.width <= 0 ||
    typeof geometry.depth !== 'number' || geometry.depth <= 0 ||
    typeof geometry.height !== 'number' || geometry.height <= 0
  ) {
    throw new Error(`entry ${index} (${e.id}): "geometry.width/depth/height" must be positive numbers`);
  }

  const provenance = e.provenance as Record<string, unknown> | undefined;
  const source = provenance && typeof provenance.source === 'string' && VALID_SOURCE_KINDS.has(provenance.source as CatalogSourceKind)
    ? (provenance.source as CatalogSourceKind)
    : 'file-import';

  return {
    id: e.id,
    label: e.label,
    description: typeof e.description === 'string' ? e.description : undefined,
    discipline: e.discipline as CatalogEntry['discipline'],
    category: e.category,
    ifc: {
      entity: ifc.entity,
      predefinedType: typeof ifc.predefinedType === 'string' ? ifc.predefinedType : undefined,
      objectType: typeof ifc.objectType === 'string' ? ifc.objectType : undefined,
    },
    geometry: { width: geometry.width, depth: geometry.depth, height: geometry.height },
    mounting: e.mounting as CatalogEntry['mounting'],
    technicalData: isPlainRecord(e.technicalData) ? (e.technicalData as CatalogEntry['technicalData']) : undefined,
    manufacturer: typeof e.manufacturer === 'string' ? e.manufacturer : undefined,
    articleNumber: typeof e.articleNumber === 'string' ? e.articleNumber : undefined,
    globalAssetId: typeof e.globalAssetId === 'string' ? e.globalAssetId : undefined,
    provenance: {
      source,
      sourceRef: provenance && typeof provenance.sourceRef === 'string' ? provenance.sourceRef : undefined,
    },
  };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parses + validates catalog JSON text. Pure — does not touch storage. */
export function parseCatalogImport(jsonText: string): CatalogImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const rawEntries = Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown })?.entries;
  if (!Array.isArray(rawEntries)) {
    throw new Error('Expected a JSON array of catalog entries (or an object with an "entries" array).');
  }

  const entries: CatalogEntry[] = [];
  const errors: CatalogImportError[] = [];
  const seenIds = new Set<string>();
  rawEntries.forEach((raw, index) => {
    try {
      const entry = validateEntry(raw, index);
      if (seenIds.has(entry.id)) {
        errors.push({ index, entryId: entry.id, message: `duplicate id "${entry.id}" — kept the first occurrence` });
        return;
      }
      seenIds.add(entry.id);
      entries.push(entry);
    } catch (err) {
      const entryId = isPlainRecord(raw) && typeof raw.id === 'string' ? raw.id : null;
      errors.push({ index, entryId, message: err instanceof Error ? err.message : String(err) });
    }
  });

  return { entries, errors };
}

export class FileImportCatalogProvider implements CatalogProvider {
  readonly id = 'file-import' as const;

  listEntries(): Promise<CatalogEntry[]> {
    return loadImportedCatalog();
  }

  /** Parses, validates, and persists `file`'s contents. Replaces any previously imported catalog. */
  async importFromFile(file: File): Promise<CatalogImportResult> {
    const text = await file.text();
    const result = parseCatalogImport(text);
    await saveImportedCatalog(result.entries);
    return result;
  }

  clear(): Promise<void> {
    return clearImportedCatalog();
  }
}
