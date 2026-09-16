/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeping the synced Elementbeispiele between sessions.
 *
 * # Why they are stored now, when they were deliberately not before
 * The list started as something a dialog showed while it was open, and a
 * stored copy would only have added a way to be quietly out of date. Then Marc
 * asked for the examples to sit in the Add Element library beside the company
 * catalogue and be placed by click — and a picker cannot reach out to the
 * network every time somebody opens it. Syncing is the user's action; what it
 * yields has to survive until the next one.
 *
 * What is stored is the LIST, never the geometry. An example's IFC file is
 * fetched fresh at placement, because that is the moment its geometry matters
 * and the dictionary's copy is the one that counts.
 *
 * IndexedDB rather than localStorage, and the open/upgrade shape of
 * `classCatalogStorage` — a different database with a different lifetime, so
 * the two share a pattern and no code.
 */

import { parseElementExamples, type ElementExampleCatalog } from './elementExamples.js';

const DB_NAME = 'ifc-lite-element-examples';
/** Bump when the stored shape changes; extend `onupgradeneeded` below. */
const DB_VERSION = 1;
const STORE = 'catalog';
const KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error('[elementExamples/idb] Failed to open database:', request.error);
      // Cleared so a later call can try again — a transient failure should not
      // poison the rest of the session.
      dbPromise = null;
      reject(request.error);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
  return dbPromise;
}

/**
 * What goes on disk: the dictionary's own wire shape.
 *
 * So the READ can go through the same parser the network response does. What
 * an older version of this app wrote is data like any other, and the parser is
 * where the shape is decided — storing the parsed form would mean trusting it.
 */
function toWireShape(catalog: ElementExampleCatalog) {
  return {
    source: catalog.source,
    fetchedAt: catalog.fetchedAt,
    elementbeispiele: catalog.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      klasse: entry.entity,
      predefinedType: entry.predefinedType,
      organisation: entry.organisation,
      geaendert: entry.changed,
      teile: entry.parts,
    })),
  };
}

/** The stored list, or `null` when none was ever synced. */
export async function loadStoredElementExamples(): Promise<ElementExampleCatalog | null> {
  try {
    const db = await openDatabase();
    return await new Promise<ElementExampleCatalog | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const stored = request.result as { source?: string; fetchedAt?: string } | undefined;
        if (!stored) return resolve(null);
        const parsed = parseElementExamples(stored, stored.source ?? 'gespeichert');
        // The stored copy keeps the time it was FETCHED, not the time it was
        // read back — "synced three weeks ago" is the useful statement.
        resolve(parsed && stored.fetchedAt ? { ...parsed, fetchedAt: stored.fetchedAt } : parsed);
      };
    });
  } catch (error) {
    console.error('[elementExamples/idb] Read failed:', error);
    return null;
  }
}

/** Replace the stored list. */
export async function storeElementExamples(catalog: ElementExampleCatalog): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    // The whole document, so a shrinking list really shrinks.
    tx.objectStore(STORE).put(toWireShape(catalog), KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Forget them, for a settings action that wants to start clean. */
export async function clearStoredElementExamples(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('[elementExamples/idb] Clear failed:', error);
  }
}
