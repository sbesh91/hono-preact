# Node Environment-API spike for the Node adapter

Date: 2026-05-18
Task: Task 0 of the Node adapter (Plan B) implementation plan; implementation gate.

## Outcome: GO

All three mechanisms the Node adapter depends on were validated against a
throwaway project (`/tmp/node-env-spike`) with real `vite build`, `vite dev`,
HTTP requests, and a `ws` WebSocket client.

| Step | Mechanism | Result |
|------|-----------|--------|
| 2 | Multi-environment build (`client` + `ssr` + `builder.buildApp`) | GO |
| 3 | SSR dev middleware via `createServerModuleRunner` (incl. HMR) | GO |
| 4 | WebSocket `upgrade` wiring with `@hono/node-ws` in dev | GO |

## Resolved versions

Installed with plain `npm` on Node v24.10.0, `vite@8.0.8` pinned.

| Package | Resolved version |
|---------|------------------|
| `vite` | 8.0.8 |
| `hono` | 4.12.19 |
| `@hono/node-server` | 1.19.14 |
| `@hono/node-ws` | 1.3.1 |
| `ws` (transitive of node-ws; also used for the test client) | 8.20.1 |

## Vite 8 API specifics (verified by inspecting `vite`'s exports)

The module runner for the SSR environment is created with:

```ts
import { createServerModuleRunner } from 'vite';
// ...
const runner = createServerModuleRunner(server.environments.ssr);
const mod = await runner.import('/src/server.ts'); // path is root-relative
```

`createServerModuleRunner` is a **named export of `vite`** (not `vite/module-runner`).
Other relevant runner/environment exports present in `vite@8.0.8`:
`createBuilder`, `DevEnvironment`, `BuildEnvironment`,
`createRunnableDevEnvironment`, `createFetchableDevEnvironment`,
`isRunnableDevEnvironment`, `createServerModuleRunnerTransport`,
`moduleRunnerTransform`, `runnerImport`.

`runner.import()` re-evaluates the module on HMR, so re-importing on every
request always yields the latest app. No manual cache invalidation needed.

## Step 2: multi-environment build config (verified)

One `npx vite build` emits both bundles. `builder.buildApp` drives both
environments sequentially.

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  environments: {
    client: {
      build: {
        outDir: 'dist/client',
        rollupOptions: { input: 'src/client.ts' },
      },
    },
    ssr: {
      build: {
        outDir: 'dist/server',
        ssr: true,
        // The adapter generates a prod entry that imports the user app and
        // calls serve()/injectWebSocket; that file is the input here.
        rollupOptions: { input: 'src/prod-entry.ts' },
      },
    },
  },
  builder: {
    async buildApp(builder) {
      await builder.build(builder.environments.client);
      await builder.build(builder.environments.ssr);
    },
  },
});
```

### Build output layout (verified)

```
dist/client/assets/client-<hash>.js   # browser bundle (hashed)
dist/server/prod-entry.js             # Node-runnable server bundle (un-hashed)
```

The `ssr` environment bundle **externalizes** `hono`, `@hono/node-server`,
`@hono/node-ws` (they appear as bare `import` statements). The bundle is plain
ESM and runs under `node dist/server/prod-entry.js` directly, provided those
deps are installed in the deployed `node_modules`.

### Prod entry shape the build plugin must generate (verified runnable)

```ts
import { serve } from '@hono/node-server';
import { app, injectWebSocket } from './server.ts';

const server = serve({ fetch: app.fetch, port: 3456 }, (info) => {
  console.log(`listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
```

`node dist/server/prod-entry.js` served `GET /`, `GET /api/ping`, and a full
WebSocket open/message(echo)/close cycle.

## Step 3: SSR dev middleware (verified, incl. HMR)

```ts
// inside a Plugin's configureServer(server: ViteDevServer)
import { createServerModuleRunner } from 'vite';

const runner = createServerModuleRunner(server.environments.ssr);

async function getServerModule() {
  return runner.import('/src/server.ts'); // re-import reflects HMR
}

// IMPORTANT: register the SSR middleware DIRECTLY in configureServer,
// NOT via the returned post hook `return () => { ... }`.
// The post hook runs AFTER Vite's spaFallback/html middlewares, which
// rewrite req.url to "/index.html" -- the SSR app then never sees the
// real path and 404s. Registering directly puts our middleware first.
server.middlewares.use(async (req, res, next) => {
  try {
    const { app } = await getServerModule();

    const url = `http://${req.headers.host}${req.url}`;
    const method = req.method ?? 'GET';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) v.forEach((vv) => headers.append(k, vv));
    }
    let body: BodyInit | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      body = chunks.length ? Buffer.concat(chunks) : undefined;
    }

    const request = new Request(url, { method, headers, body });
    const response = await app.fetch(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    next(err as Error);
  }
});
```

Verified: `GET /` and `GET /api/ping` are served by the SSR app under
`vite dev`. Editing `src/server.ts` (changing the `/` response body) was
reflected on the next request with no server restart -- HMR confirmed.

### Gotcha for Task 3 (load-bearing)

`server.middlewares` is a Connect stack. Registering via the
`configureServer` return value (`return () => { server.middlewares.use(...) }`)
places the middleware **after** Vite's internal middlewares. Vite's
`spaFallbackMiddleware` rewrites `req.url` to `/index.html`, so the SSR app
receives the wrong path and returns 404. Register the SSR catch-all middleware
**directly inside `configureServer`** (synchronously, before the function
returns) so it runs ahead of Vite's HTML/SPA middlewares.

## Step 4: WebSocket upgrade wiring (verified)

### How `@hono/node-ws` actually works (from reading `dist/index.cjs`)

`createNodeWebSocket({ app })` returns `{ wss, injectWebSocket, upgradeWebSocket }`.
The three share **closure state** (`wss`, a `waiterMap`). Therefore:

- `upgradeWebSocket` (used in route handlers) and `injectWebSocket` (used to
  attach the upgrade listener) **must come from the same
  `createNodeWebSocket()` call**. A fresh `createNodeWebSocket()` per request
  has an empty `waiterMap` and the upgrade silently fails.
- `injectWebSocket(target)` does exactly one thing:
  `target.on('upgrade', handler)`. It does not need a real `http.Server`; any
  object with an `on` method works.

So the SSR server module owns one `createNodeWebSocket({ app })` call and
exports both `app` and `injectWebSocket` (or the whole node-ws result).

### Prod: pass the real server (verified)

```ts
const server = serve({ fetch: app.fetch });
injectWebSocket(server); // attaches `upgrade` listener to the http server
```

### Dev: forward the dev server's `upgrade` event (verified)

In dev, the user app must register its `upgrade` handler on the *Vite dev
server's* `httpServer`. Because `injectWebSocket` only calls
`target.on('upgrade', fn)`, capture that `fn` via a shim and forward each real
upgrade event to it. Re-import per upgrade so HMR is respected.

```ts
// inside configureServer(server: ViteDevServer)
server.httpServer?.on('upgrade', async (req, socket, head) => {
  try {
    const { injectWebSocket } = await getServerModule();
    let handler:
      | ((req: unknown, socket: unknown, head: unknown) => void)
      | undefined;
    // injectWebSocket(target) === target.on('upgrade', handler)
    injectWebSocket({
      on(event: string, fn: typeof handler) {
        if (event === 'upgrade') handler = fn;
      },
    });
    handler?.(req, socket, head);
  } catch (err) {
    console.error('[ws] dev upgrade error', err);
    socket.destroy();
  }
});
```

Verified: a `ws` client connecting to `ws://localhost:<port>/ws` during
`vite dev` reached the handler -- `onOpen`, `onMessage` (echoed back), and
`onClose` all ran (confirmed in both the dev server log and the client).

## SSR server module shape (used by all steps)

The user/framework server entry must construct node-ws once and export the
app plus `injectWebSocket` so prod and dev share the same wiring:

```ts
import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get('/', (c) => c.html('<h1>...</h1>'));
app.get('/ws', upgradeWebSocket(() => ({
  onOpen() {}, onMessage(evt, ws) { ws.send(`echo:${evt.data}`); }, onClose() {},
})));

export { app, injectWebSocket };
export default app;
```

## Concerns / notes for Tasks 2 and 3

1. **Middleware ordering (Task 3):** must register the SSR middleware
   synchronously in `configureServer`, not in the returned post hook (see
   Step 3 gotcha). This is the single most likely thing to get wrong.
2. **SSR externals (Task 2):** `hono`, `@hono/node-server`, `@hono/node-ws`
   are externalized in the `ssr` bundle. The deploy target needs them in
   `node_modules`, or the build config must mark them `noExternal` if a
   fully self-contained bundle is wanted. Decide deliberately.
3. **`ws` peer dep:** `ws@8.20.1` comes in transitively via `@hono/node-ws`;
   no need to declare it directly for the adapter runtime. (It was installed
   explicitly in the spike only for the test client.)
4. **Static assets:** not exercised in this spike. Prod serving of
   `dist/client/*` will need `serveStatic` from `@hono/node-server/serve-static`
   wired into the generated prod entry; verify in Task 2/3.
5. **Dev WS per-upgrade re-import:** re-importing the module on every upgrade
   is correct for HMR but creates a new `createNodeWebSocket` closure each
   time. Fine for short-lived upgrade negotiation; the resulting `WebSocket`
   connection is held by `ws`'s `WebSocketServer` independently, so this is
   safe. No connection leak observed.
6. The dev server prints `[vite] connected.` before its banner; cosmetic, not
   an error.
```
