# @cloudflare/vite-plugin Vite 8 Compatibility Spike

**Date:** 2026-05-17  
**Status:** PASS — plan proceeds

## Summary

`@cloudflare/vite-plugin` works correctly on `vite@8.0.8`. Both `vite dev` and
`vite build` succeed without errors or Vite-8-specific warnings. The go/no-go
gate is cleared.

## Resolved Versions

| Package                    | Version  |
|----------------------------|----------|
| `vite`                     | 8.0.8    |
| `@cloudflare/vite-plugin`  | 1.37.1   |
| `wrangler`                 | 4.92.0   |
| `hono`                     | 4.12.19  |

Installed via `npm install vite@8.0.8 @cloudflare/vite-plugin wrangler hono`
in a fresh throwaway project at `/tmp/cf-spike`.

## Step 2: Dev Server

`vite dev` boots in ~430-600 ms. `GET /` returns `200 ok` from workerd. No
Vite-8 incompatibility errors.

```
  VITE v8.0.8  ready in 432 ms

  ➜  Local:   http://localhost:7777/
  ➜  Network: use --host to expose
  ➜  Debug:   http://localhost:7777/__debug
```

```
curl http://localhost:7777/
ok
```

## Step 3: Build Output Layout

Running `vite build` on a project with both a worker entry and a client-side
HTML/JS entry produces the following tree under `dist/`:

```
dist/
  cf_spike/              <- worker environment output
    .vite/
      manifest.json
    index.js             <- bundled worker (53 kB, hono included)
    wrangler.json        <- generated wrangler config for deployment
  client/                <- client environment output
    .assetsignore        <- contains "wrangler.json\n.dev.vars"
    index.html
    assets/
      index-BgOb5xxM.js  <- hashed client bundle
```

The generated `dist/cf_spike/wrangler.json` sets:

```json
{
  "main": "index.js",
  "assets": { "directory": "../client" },
  "no_bundle": true
}
```

Key observations:

- Worker output goes to `dist/<env-name>/` (environment name derived from the
  `wrangler.jsonc` `name` field, with hyphens converted to underscores).
- Client assets go to `dist/client/`.
- The plugin generates a `wrangler.json` inside the worker directory that
  references `../client` for the assets directory. The `wrangler deploy` command
  is meant to run from `dist/cf_spike/`.
- `dist/client/.assetsignore` explicitly excludes `wrangler.json` and
  `.dev.vars` from the assets upload, preventing worker-source leakage to the
  static asset store.
- Worker source (`index.js`) lives in a separate directory from client assets.
  There is no structural overlap.

## Step 4: Integration Questions

### Q1: Does the plugin accept a `.tsx` file as `wrangler.jsonc` `main`?

**Yes.** Setting `"main": "src/worker.tsx"` in `wrangler.jsonc` works for both
`vite dev` and `vite build` without any special configuration. The plugin
resolves and transforms `.tsx` entries the same as `.ts`.

### Q2: When does the plugin read `main`, and must the file exist before startup?

**The file must exist on disk before `vite dev` / `vite build` is invoked.**

The plugin validates `main` during Vite's `config` hook (the earliest hook,
runs during config resolution before the server or build pipeline starts).
Specifically, `resolvePluginConfig` calls `resolveWorkerConfig`, which calls
`maybeResolveMain`, which checks `fs.existsSync` on the resolved path. If the
file is absent, startup aborts with:

```
Error: The provided Wrangler config main field (/path/to/src/worker.tsx)
       doesn't point to an existing file
    at maybeResolveMain (.../index.mjs:41319:44)
    at resolveWorkerConfig (.../index.mjs:41289:23)
    at resolvePluginConfig (.../index.mjs:41429:36)
    at BasicMinimalPluginContext.config (.../index.mjs:54044:33)
    at runConfigHook (vite/dist/node/chunks/node.js:34709:42)
```

This error is the same for both `vite dev` and `vite build`.

**Implication for the framework:** The framework's generated server-entry file
(e.g. `.vite/hono-preact/server-entry.tsx`) must be written to disk before
`@cloudflare/vite-plugin` initialises. It cannot be a virtual module referenced
from `main`. See the reference note in project memory
(`@hono/vite-build entry resolution gotcha`) — the same constraint applies here.

### Q3: Are client assets and the worker emitted into separate directories?

**Yes, fully separated.** Worker output goes to `dist/<worker-name>/` and
client assets go to `dist/client/`. There is no path overlap.

Worker-source-leak protection is layered:

1. **Separate directories:** client assets cannot accidentally include the
   worker bundle because they live under a different top-level subdirectory.
2. **`.assetsignore`:** the plugin writes `dist/client/.assetsignore` containing
   `wrangler.json` and `.dev.vars`. Even if wrangler deployment were pointed at
   the client directory directly, those files would be excluded from the upload.
3. **`no_bundle: true`** in the generated `wrangler.json`: wrangler will not
   re-bundle `index.js`, relying on the already-bundled output from vite.

The `wrangler deploy` surface is `dist/cf_spike/` (worker bundle + generated
wrangler config); the `assets.directory` points up to `../client`.

### Q4: Does a WebSocket `GET` with `Upgrade: websocket` reach worker code under `vite dev`?

**Yes.** A `GET /ws` request with `Upgrade: websocket` headers reaches the hono
`upgradeWebSocket` handler and returns `101 Switching Protocols`. The worker
runs inside workerd under `vite dev`, so the full WebSocket lifecycle runs
through workerd's WebSocket API.

Test:

```bash
curl -sv \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  http://localhost:7780/ws
```

Response:

```
< HTTP/1.1 101 Switching Protocols
< Upgrade: websocket
< Connection: Upgrade
< Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

The worker log also emitted `WebSocket closed` when curl disconnected, confirming
the `onClose` handler ran.

## Go/No-Go Decision

**GO.** Both `vite dev` and `vite build` succeed on `vite@8.0.8` with
`@cloudflare/vite-plugin@1.37.1`. The plan proceeds.

The one notable constraint to carry forward: the file referenced by
`wrangler.jsonc` `main` must exist on disk before the plugin's `config` hook
runs. For the framework's virtual server-entry pattern, this means writing the
entry file to disk during a Vite plugin's own `config` hook (before
`@cloudflare/vite-plugin` reads it), or generating it in a pre-build step.
