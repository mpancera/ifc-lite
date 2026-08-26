# Pages Functions

Server-side routes for a **Cloudflare Pages** deployment of the viewer. Every
other host serves the build output as plain static files and simply has no such
routes — see [`../DEPLOYMENT.md`](../DEPLOYMENT.md), which still describes the
app correctly: nothing here is required to open, view or export a model.

| Route | What it does |
|---|---|
| `api/symbolkatalog` | fetches the association symbols from the data dictionary, using a credential that must not reach the browser |

## Where this directory has to live

Cloudflare Pages looks for `functions/` in the project's **root directory** —
the one configured under *Settings → Builds & deployments*. This repository
builds from its own root (`apps/viewer/dist` is the output), so `functions/`
belongs at the repository root, where it is.

If the routes 404 on a deployment while the app itself loads, that setting is
the first thing to check: a root directory of `apps/viewer` would look for
`apps/viewer/functions/` and find nothing. Functions take precedence over
`_redirects`, so a working route never falls through to the SPA shell —
**a route that answers with `index.html` is a route Pages did not find.**

## `api/symbolkatalog`

The Swiss fire-detection symbols are published by the
**Verband Schweizerischer Errichter von Sicherheitsanlagen (SES)**. The
association granted permission for this viewer and for the proof of concept —
by name, and not for everyone. The dictionary therefore serves them behind a
named, revocable service access rather than as a public file.

That access is a credential. In a browser application a credential in the
bundle is readable by anyone who opens the app, so it lives in the deployment's
environment instead and never leaves the server.

> **Never commit the credential.** Everything in this repository is
> world-readable the moment it is pushed.

### Settings

*Settings → Environment variables*, for the environment being deployed:

| Name | Value |
|---|---|
| `SES_CATALOG_CLIENT_ID` | Client ID of the service token (ends in `.access`) |
| `SES_CATALOG_CLIENT_SECRET` | its Client Secret — shown once, at creation |
| `SES_CATALOG_URL` | optional; defaults to `https://data-dictionary.ch/api/symbolkatalog` |

Mark the secret as **encrypted**. The service token itself is created on the
dictionary's side; its setup is documented there
(`docs/symbolkatalog-token.md` in the `data-dictionary` repository), including
the one setting that is easy to get wrong — the Access policy action has to be
*Service Auth*, not *Allow*.

> **Saving the variables changes nothing on its own.** Pages reads them when it
> BUILDS, so the running deployment keeps the values it was built with. A
> deployment has to follow — *Deployments → Retry deployment*, or simply the
> next push to the connected branch. Without it the route keeps answering
> `503 unconfigured` with both values sitting right there in the dashboard,
> which is a confusing half hour.

### What the answers mean

| Status | Meaning |
|---|---|
| `200` | the catalogue |
| `503` | this deployment has no credential — the normal state of a fresh copy |
| `502` + `refused` | the dictionary declined; the message says whether it looks like a withdrawn access or a policy set to *Allow* |
| `502` + `unreachable` | the dictionary could not be reached at all |
| `404` | nothing is served at the configured address |

The upstream body is never passed through on failure: an Access-protected path
answers a rejected request with a redirect to a sign-in page, and forwarding
that would hand the viewer an HTML document where it expects a catalogue.

## Typechecking

`pnpm typecheck` (turbo) covers workspace packages, and this directory is not
one. Check it directly:

```bash
npx tsc -p functions --noEmit
```

The logic worth testing lives in
`apps/viewer/src/lib/symbolCatalog/sesCatalogProxy.ts` and is covered by the
viewer's own test run, so the file here stays thin enough to read in one go.
