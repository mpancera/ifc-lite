/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The decisions behind the SES symbol proxy, kept away from the network.
 *
 * # What the proxy is for
 * The Swiss fire-detection symbols are published by the
 * `Verband Schweizerischer Errichter von Sicherheitsanlagen (SES)`. The
 * association granted permission for this viewer and the proof of concept —
 * **not for everyone**, which is why they are not simply a public file. They
 * are fetched from the dictionary through a named, revocable service access.
 *
 * # Why a server-side proxy and not a token in the bundle
 * This is a browser application. A credential shipped in its bundle can be
 * read by anyone who opens the app, and the permission would then cover
 * something nobody can keep: "only this application". The credential therefore
 * lives in the deployment's environment, and the browser talks to its own
 * origin — which also spares it a cross-origin preflight.
 *
 * >>> Never put the credential in this repository. Everything here is
 * >>> world-readable the moment it is pushed.
 *
 * # Why this file has no fetch in it
 * So the rules can be tested without a network, a deployment or a credential —
 * the three things that are missing exactly when someone is trying to work out
 * why the proxy answers the way it does.
 */

/** Where the dictionary serves the catalogue, when nothing else is configured. */
export const DEFAULT_SES_CATALOG_URL = 'https://data-dictionary.ch/api/symbolkatalog';

/**
 * The attribution the association asked for, spelled the way it asked.
 *
 * A name is the whole of what was required in return, so it is not paraphrased,
 * abbreviated or re-ordered anywhere — and it lives in one place so it cannot
 * drift into two spellings.
 */
export const SES_ATTRIBUTION = 'Verband Schweizerischer Errichter von Sicherheitsanlagen (SES)';

/** The deployment settings the proxy reads. All optional at the type level —
 *  a deployment that never configured them is a normal state, not a bug. */
export interface SesCatalogEnv {
  readonly SES_CATALOG_URL?: string;
  readonly SES_CATALOG_CLIENT_ID?: string;
  readonly SES_CATALOG_CLIENT_SECRET?: string;
}

export interface SesCatalogRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** What a deployment is missing, in the words used to configure it. */
export type SesCatalogGap = 'SES_CATALOG_CLIENT_ID' | 'SES_CATALOG_CLIENT_SECRET';

export type SesCatalogPlan =
  | { readonly kind: 'request'; readonly request: SesCatalogRequest }
  | { readonly kind: 'unconfigured'; readonly missing: readonly SesCatalogGap[] };

function trimmed(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * What the proxy should do with this deployment's settings.
 *
 * Both halves of the credential are required. A deployment that has only one
 * is reported as missing the other rather than attempted: sending half a
 * credential produces a redirect to a login page, which is a far more puzzling
 * symptom than being told which value is absent.
 */
export function planSesCatalogRequest(env: SesCatalogEnv): SesCatalogPlan {
  const id = trimmed(env.SES_CATALOG_CLIENT_ID);
  const secret = trimmed(env.SES_CATALOG_CLIENT_SECRET);

  const missing: SesCatalogGap[] = [];
  if (!id) missing.push('SES_CATALOG_CLIENT_ID');
  if (!secret) missing.push('SES_CATALOG_CLIENT_SECRET');
  if (missing.length > 0) return { kind: 'unconfigured', missing };

  return {
    kind: 'request',
    request: {
      url: trimmed(env.SES_CATALOG_URL) || DEFAULT_SES_CATALOG_URL,
      headers: {
        // The header names Cloudflare Access expects for a service token.
        'CF-Access-Client-Id': id,
        'CF-Access-Client-Secret': secret,
        Accept: 'application/json',
      },
    },
  };
}

/**
 * How to describe an upstream answer that is not the catalogue.
 *
 * The upstream body is deliberately NOT passed through. A rejected request to
 * an Access-protected path answers with a redirect to a sign-in page, and
 * forwarding that would hand the viewer an HTML document where it expects a
 * catalogue — parsed as a failure with no hint of what actually happened.
 */
export function describeSesCatalogFailure(status: number): string {
  if (status === 302 || status === 303 || status === 307) {
    return 'The dictionary asked for a sign-in instead of answering. The service '
      + 'access is probably missing from the policy, or its policy action is '
      + '"Allow" where it has to be "Service Auth".';
  }
  if (status === 401 || status === 403) {
    return 'The dictionary refused the service access. It may have been withdrawn, '
      + 'expired, or never covered this catalogue.';
  }
  if (status === 404) {
    return 'The dictionary has no catalogue at the configured address.';
  }
  return `The dictionary answered with status ${status}.`;
}

/** The message shown when the deployment never got a credential. */
export function describeSesCatalogGap(missing: readonly SesCatalogGap[]): string {
  return 'This deployment has no access to the association symbols. '
    + `Missing: ${missing.join(', ')}. `
    + 'The symbols are licensed to this application by name, so a copy of this '
    + 'viewer does not inherit them — see functions/README.md.';
}
