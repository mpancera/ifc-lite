/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Persistence for list definitions via localStorage
 */

import type { ListDefinition } from '@ifc-lite/lists';
import { downloadFile, sanitizeFilename } from '../export/download.js';

const STORAGE_KEY = 'ifc-lite-lists';

/**
 * Bring a stored definition up to date with headings that have since been
 * renamed.
 *
 * A saved list carries its own `label` per column, so a list authored before a
 * rename keeps showing the old heading forever — two lists over the same data
 * disagreeing about what a column is called. Only a label that still equals the
 * OLD default is rewritten; anything the author typed themselves is theirs and
 * is left alone.
 *
 * `propertyName` is the stored contract the engine resolves against and never
 * changes here — this is presentation only.
 */
export function migrateListDefinition(definition: ListDefinition): ListDefinition {
  let changed = false;
  const columns = definition.columns.map((column) => {
    if (column.source === 'spatial' && column.propertyName === 'Container'
      && (column.label === undefined || column.label === 'Container')) {
      changed = true;
      return { ...column, label: 'Contained in' };
    }
    return column;
  });
  return changed ? { ...definition, columns } : definition;
}

export function loadListDefinitions(): ListDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as ListDefinition[]).map(migrateListDefinition);
  } catch {
    return [];
  }
}

export function saveListDefinitions(definitions: ListDefinition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(definitions));
  } catch {
    console.warn('[Lists] Failed to save list definitions to localStorage');
  }
}

export function exportListDefinition(definition: ListDefinition): void {
  const json = JSON.stringify(definition, null, 2);
  const name = sanitizeFilename(definition.name, { fallback: 'list' });
  downloadFile(json, `${name}.list.json`, 'application/json');
}

export function importListDefinition(file: File): Promise<ListDefinition> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const def = JSON.parse(reader.result as string) as ListDefinition;
        if (!def.id || !def.name || !def.entityTypes || !def.columns) {
          reject(new Error('Invalid list definition file'));
          return;
        }
        // Generate a new ID to avoid collisions
        def.id = crypto.randomUUID();
        def.createdAt = Date.now();
        def.updatedAt = Date.now();
        resolve(migrateListDefinition(def));
      } catch {
        reject(new Error('Failed to parse list definition file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
