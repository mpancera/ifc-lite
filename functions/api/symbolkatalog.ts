/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `/api/symbolkatalog` — the association symbols, fetched on the server side.
 *
 * A Cloudflare Pages Function. It exists for one reason: to hold a credential
 * that must not reach the browser. See `sesCatalogProxy.ts` for why, and
 * `functions/README.md` for how a deployment is configured.
 *
 * Everything else in this app is static. This is the first and, so far, only
 * piece of server-side code, and it stays deliberately thin: read the
 * settings, add two headers, hand the answer through. A viewer hosted
 * elsewhere simply has no such route, and the app treats that as "no
 * association symbols" rather than as an error — which is also the correct
 * legal outcome, since the permission names this application.
 */

import {
  describeSesCatalogFailure,
  describeSesCatalogGap,
  planSesCatalogRequest,
  SES_ATTRIBUTION,
  type SesCatalogEnv,
} from '../../apps/viewer/src/lib/symbolCatalog/sesCatalogProxy.js';

interface PagesContext {
  readonly request: Request;
  readonly env: SesCatalogEnv;
}

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      // Named in the response as well as in the payload, so the attribution
      // survives even a caller that only ever looks at the headers.
      'X-Symbol-Source': SES_ATTRIBUTION,
    },
  });
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const plan = planSesCatalogRequest(context.env);

  if (plan.kind === 'unconfigured') {
    // 503 rather than 500: nothing is broken. This deployment was never given
    // the access, which is the normal state of any copy of this repository.
    return json(
      { error: 'unconfigured', message: describeSesCatalogGap(plan.missing) },
      503,
      'no-store',
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(plan.request.url, {
      headers: plan.request.headers,
      // Without this, a rejected request follows the redirect and returns the
      // sign-in PAGE with status 200 — the one failure that looks like success.
      redirect: 'manual',
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return json(
      { error: 'unreachable', message: `The dictionary could not be reached: ${message}` },
      502,
      'no-store',
    );
  }

  if (!upstream.ok) {
    return json(
      { error: 'refused', status: upstream.status, message: describeSesCatalogFailure(upstream.status) },
      upstream.status === 404 ? 404 : 502,
      'no-store',
    );
  }

  // Cached for everyone rather than per visitor: the credential belongs to this
  // deployment, not to the person browsing, so every visitor of this app is
  // equally entitled to the same answer. Five minutes keeps a corrected symbol
  // from waiting for a redeploy while sparing the dictionary a request per load.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Symbol-Source': SES_ATTRIBUTION,
    },
  });
}
