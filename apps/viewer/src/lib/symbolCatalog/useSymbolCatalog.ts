/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The symbol catalogue, as the app holds it.
 *
 * Module-level state rather than a store slice, following `useClassCatalog`
 * for the same reason: one document, changed by one action, read by whoever
 * draws a plan. In the viewer store every read would be a subscription to
 * data that changes about once a month.
 *
 * # Fetched only when asked
 * `syncSymbolCatalog()` is a settings action, not a start-up step. A viewer
 * that reaches out to the network to open a file is a viewer that fails to
 * open a file when the network is down.
 *
 * # The sync fetches the drawings too
 * The catalogue names its symbols; the drawings are separate files. Both are
 * fetched in one action, because a catalogue without drawings cannot put
 * anything on a plan, and a viewer that fetched them lazily would go to the
 * network from inside a repaint.
 */

import { useEffect, useState } from 'react';
import {
  parseSymbolCatalog, referencedSymbols, symbolDrawingUrl,
  DEFAULT_SYMBOL_CATALOG_URL, type SymbolCatalog,
} from './symbolCatalog.js';
import { loadStoredSymbolCatalog, storeSymbolCatalog } from './symbolCatalogStorage.js';
import { checkSymbolSvg, isSymbolSvgRenderable, describeSymbolSvgProblems } from './symbolSvg.js';
import { externalRequestsAllowed } from '@/lib/privacy/externalRequests';

let current: SymbolCatalog | null = null;
let loaded = false;
const listeners = new Set<(catalog: SymbolCatalog | null) => void>();

function publish(catalog: SymbolCatalog | null): void {
  current = catalog;
  for (const listener of listeners) listener(catalog);
}

/** Read what was stored, once per session. */
async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  publish(await loadStoredSymbolCatalog());
}

/** One drawing that could not be used, and why. */
export interface RejectedSymbol {
  readonly symbol: string;
  readonly reason: string;
}

export interface SymbolCatalogSyncResult {
  readonly ok: boolean;
  /** How many entries arrived, on success. */
  readonly count?: number;
  /** How many drawings were fetched and accepted. */
  readonly drawings?: number;
  /**
   * Drawings that were fetched and refused, or could not be fetched.
   *
   * Reported rather than silently dropped: a symbol missing from a fire plan
   * is exactly the kind of absence nobody notices until somebody needs it.
   */
  readonly rejected?: readonly RejectedSymbol[];
  /** What to tell the user, on failure. */
  readonly error?: string;
}

/** How many drawings to fetch at once. */
const DRAWING_BATCH = 6;

/**
 * Fetch every drawing the catalogue names.
 *
 * Batched rather than all at once: a catalogue of a hundred symbols would
 * otherwise open a hundred parallel connections, which browsers queue anyway
 * and servers dislike.
 *
 * One drawing failing costs that drawing. The catalogue is still worth having
 * with a symbol missing — the coverage view names what is absent.
 */
async function fetchDrawings(
  names: readonly string[],
  catalogUrl: string,
): Promise<{ drawings: Record<string, string>; rejected: RejectedSymbol[] }> {
  const drawings: Record<string, string> = {};
  const rejected: RejectedSymbol[] = [];

  for (let start = 0; start < names.length; start += DRAWING_BATCH) {
    const batch = names.slice(start, start + DRAWING_BATCH);
    await Promise.all(batch.map(async (symbol) => {
      try {
        const response = await fetch(symbolDrawingUrl(symbol, catalogUrl), { cache: 'no-store' });
        if (!response.ok) {
          rejected.push({ symbol, reason: `HTTP ${response.status}` });
          return;
        }
        const svg = await response.text();
        const check = checkSymbolSvg(svg);
        // Safety problems are absolute; a wrong viewBox is reported but the
        // drawing is still kept. See `symbolSvg.ts`.
        if (!isSymbolSvgRenderable(check)) {
          rejected.push({ symbol, reason: describeSymbolSvgProblems(check) });
          return;
        }
        if (!check.ok) rejected.push({ symbol, reason: describeSymbolSvgProblems(check) });
        drawings[symbol] = svg;
      } catch (error) {
        rejected.push({ symbol, reason: (error as Error).message });
      }
    }));
  }

  return { drawings, rejected };
}

/**
 * Fetch the catalogue and its drawings, and keep them.
 *
 * On failure the PREVIOUS catalogue stays in place, following
 * `syncClassCatalog`: a sync that emptied the list because a server was
 * briefly down would take the symbols off somebody's drawing mid-edit.
 */
export async function syncSymbolCatalog(
  url = DEFAULT_SYMBOL_CATALOG_URL,
): Promise<SymbolCatalogSyncResult> {
  // The app has a setting for whether it may talk to anything outside itself,
  // and this is a request outside itself — several, in fact. Somebody who
  // turned that off did so on purpose.
  if (!externalRequestsAllowed()) {
    return {
      ok: false,
      error: 'Externe Anfragen sind blockiert. Unter Datei → Datenschutz freigeben.',
    };
  }

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, error: `Der Symbolkatalog antwortete mit ${response.status}.` };
    }

    const listing = parseSymbolCatalog(await response.json(), url);
    if (!listing) {
      return { ok: false, error: 'Der Symbolkatalog kam in einer unbekannten Form zurück.' };
    }

    const { drawings, rejected } = await fetchDrawings(referencedSymbols(listing), url);
    const catalog: SymbolCatalog = { ...listing, drawings };

    await storeSymbolCatalog(catalog);
    loaded = true;
    publish(catalog);

    return {
      ok: true,
      count: catalog.entries.length,
      drawings: Object.keys(drawings).length,
      rejected,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Der Symbolkatalog war nicht erreichbar: ${(error as Error).message}`,
    };
  }
}

/** The catalogue as it stands, without subscribing. */
export function getSymbolCatalog(): SymbolCatalog | null {
  return current;
}

/** The catalogue, loading the stored copy on first use. */
export function useSymbolCatalog(): SymbolCatalog | null {
  const [catalog, setCatalog] = useState<SymbolCatalog | null>(current);

  useEffect(() => {
    listeners.add(setCatalog);
    void ensureLoaded();
    return () => { listeners.delete(setCatalog); };
  }, []);

  return catalog;
}

/** Test seam: drop the session's copy so the next read goes to storage. */
export function resetSymbolCatalogForTests(): void {
  current = null;
  loaded = false;
  listeners.clear();
}
