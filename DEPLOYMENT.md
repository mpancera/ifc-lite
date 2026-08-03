# Hosting the viewer

The viewer is a **static site**. There is no server-side code, no database and
no runtime to keep alive: IFC parsing, geometry and export all run in the
browser. Hosting it means copying a directory onto any web server that can
serve files over HTTP.

This is written for whoever operates that server.

## What it needs

| | |
|---|---|
| Runtime | none — static files only |
| Size | ~90 MB, ~550 files |
| Transport | HTTP or HTTPS. **Not** a file share opened directly (`file://`) — ES modules and web workers are blocked there |
| Outbound network | none. The app contacts no third party |
| Inbound | whatever access control the environment already applies |

Uploaded IFC files never leave the browser, so nothing sensitive reaches the
server. Its logs still record who requested the page and when, as with any
other internally hosted site.

## Build

```bash
pnpm install
pnpm build:wasm:fetch          # downloads prebuilt WebAssembly — no Rust toolchain needed
pnpm --filter @ifc-lite/viewer build
```

The result is `apps/viewer/dist/`. Copy its **contents** to the web root.

### Serving from a subdirectory

By default the build assumes it is served from the root of a host
(`https://example/`). If it will live under a path
(`https://example/apps/ifclite/`), that path has to be baked in — otherwise
every asset URL points at the server root and the page loads blank:

```bash
VITE_BASE_PATH=/apps/ifclite/ pnpm --filter @ifc-lite/viewer build
```

Rebuild if the path ever changes; it cannot be adjusted afterwards.

## Server configuration

### Required: the `.wasm` MIME type

`.wasm` must be served as `application/wasm`. IIS refuses to serve extensions
it does not know and returns **404**, which surfaces as the viewer loading but
never opening a file. Apache and nginx have shipped the mapping for years, but
it is worth confirming.

<details>
<summary>IIS — <code>web.config</code> in the site root</summary>

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <staticContent>
      <remove fileExtension=".wasm" />
      <mimeMap fileExtension=".wasm" mimeType="application/wasm" />
    </staticContent>
    <httpProtocol>
      <customHeaders>
        <add name="Cross-Origin-Opener-Policy" value="same-origin" />
        <add name="Cross-Origin-Embedder-Policy" value="credentialless" />
      </customHeaders>
    </httpProtocol>
    <rewrite>
      <rules>
        <rule name="SPA fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

The rewrite rule needs the URL Rewrite module. Without it, only the entry URL
works and deep links 404 — an acceptable first step.
</details>

<details>
<summary>nginx</summary>

```nginx
location / {
    root /var/www/ifclite;
    try_files $uri $uri/ /index.html;

    add_header Cross-Origin-Opener-Policy same-origin;
    add_header Cross-Origin-Embedder-Policy credentialless;
}

location ~* \.wasm$ {
    root /var/www/ifclite;
    types { application/wasm wasm; }
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```
</details>

Cloudflare Pages and Vercel need none of this — `apps/viewer/public/_headers`
and `_redirects` cover the former, `vercel.json` the latter.

### Recommended: cross-origin isolation

The two `Cross-Origin-*` headers above let the browser expose
`SharedArrayBuffer`, which allows the IDS validation worker to read the model
in place instead of copying it. **Optional**: without them the app works and
falls back to copying, which is slower on large models. Nothing else depends
on them.

### Recommended: caching

Everything under `/assets/` and `/fonts/` is content-hashed and can be cached
indefinitely (`max-age=31536000, immutable`). `index.html` must **not** be
cached, or a deployment stays invisible to anyone holding the old one.

## Verifying a deployment

1. Open the site; the model list and toolbar render.
2. Open any `.ifc` file — geometry appears. If the file dialog works but
   nothing renders, check the `.wasm` MIME type first.
3. In the browser's network tab, confirm every request goes to your own host.
   A request to any other domain means something was reintroduced — see the
   "Data leaving the browser" section of [EXTENSION.md](./EXTENSION.md).
