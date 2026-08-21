/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Saying why the graph has no layout.
 *
 * The layout runs in a web worker, and a worker is the part of this app most
 * likely to be stopped by something that has nothing to do with the model: a
 * managed laptop's security policy refusing to start one, or a caching proxy
 * serving a chunk that no longer exists after a deploy. Both end the same way —
 * the promise rejects and there are no positions.
 *
 * Until this existed the panel drew an EMPTY AREA in that case. The failure was
 * in the console and nowhere else, so the honest report from the other side was
 * "the graph doesn't load", with nothing to act on. Naming the two causes turns
 * that into either "ask the network team" or "reload with Ctrl+Shift+R".
 *
 * Kept apart from `layout.ts` so a test can reach it without importing elkjs,
 * which would try to spin up the very worker this is about.
 */

/** What the panel puts on screen when a layout fails. */
export interface LayoutFailure {
  /** One sentence naming the cause, in the user's terms. */
  readonly message: string;
  /** What to do about it, or `null` when there is nothing useful to suggest. */
  readonly hint: string | null;
  /** The raw text, for the fine print — it is what a bug report needs. */
  readonly detail: string;
}

function textOf(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * Turn a rejected layout into something worth reading.
 *
 * The matching is deliberately loose. Browsers word these differently and the
 * wording changes between versions, so this looks for the few tokens that stay
 * put; anything unrecognised keeps its own text rather than being flattened
 * into a generic apology.
 */
export function describeLayoutFailure(err: unknown): LayoutFailure {
  const detail = textOf(err);
  const lower = detail.toLowerCase();

  // A policy said no. `SecurityError` is what Chrome and Firefox both raise
  // when a Content-Security-Policy forbids the worker, and corporate proxies
  // and endpoint agents inject exactly that header.
  if (
    lower.includes('securityerror')
    || lower.includes('content security policy')
    || lower.includes('worker-src')
    || lower.includes('refused to create')
  ) {
    return {
      message: 'Der Browser durfte den Layout-Worker nicht starten.',
      hint: 'Meist eine Sicherheitsrichtlinie (Firmennetz, Endpoint-Schutz oder eine Erweiterung). '
        + 'Ein Test im Inkognito-Fenster oder über einen anderen Netzzugang zeigt, welches davon es ist.',
      detail,
    };
  }

  // The file itself never arrived: a stale cached chunk after a deploy, or a
  // proxy in the way. Both are cured by a reload that bypasses the cache.
  if (
    lower.includes('failed to fetch')
    || lower.includes('dynamically imported module')
    || lower.includes('importscripts')
    || lower.includes('networkerror')
    || lower.includes('404')
  ) {
    return {
      message: 'Der Layout-Worker liess sich nicht laden.',
      hint: 'Meist ein veralteter Zwischenspeicher — mit Strg+Shift+R neu laden. '
        + 'Bleibt es dabei, blockiert ein Proxy die Datei.',
      detail,
    };
  }

  return {
    message: 'Das Layout des Graphen ist fehlgeschlagen.',
    hint: null,
    detail,
  };
}
