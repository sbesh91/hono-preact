# CF `upgradeWebSocket` Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the raw `upgradeWebSocket` helper work under the Cloudflare adapter with byte-for-byte behavioral parity to Node (issue #291).

**Architecture:** Add a framework-owned Cloudflare WebSocket upgrader (`makeCfWebSocketUpgrader`) that mints a per-connection `WebSocketPair`, wires the WSEvents handlers, and — unlike `hono/cloudflare-workers` — fires `onOpen` after `server.accept()`. The CF adapter's generated worker entry installs it into the existing upgrader seam, symmetric to how the Node adapter installs `createNodeWebSocket(...).upgradeWebSocket`. The seam is independent of the realtime connector (`/__sockets` sockets/rooms still route through the DO connector and never touch this upgrader).

**Tech Stack:** TypeScript, Hono (`hono/ws` `WSContext`/`WSEvents`), `@cloudflare/workers-types` (`WebSocketPair`, workerd `WebSocket`/`Response.webSocket`), Vitest, `@cloudflare/vite-plugin` (workerd dev for integration), Preact (docs site).

## Global Constraints

- **No em-dashes** in prose, comments, or commit messages (use commas/semicolons/parentheses).
- **No type casts** where a reshape works (CLAUDE.md "Type casts"). Workerd `Response.webSocket` is already typed in `packages/server` via `/// <reference types="@cloudflare/workers-types/latest" />`; `realtime-do-glue.ts` constructs `new Response(null, { status: 101, webSocket: client })` with no cast, so no `CfResponseInit` reshape is needed. Match that.
- **New file gets the workerd types reference:** first line `/// <reference types="@cloudflare/workers-types/latest" />` (matches `cf-pubsub.ts`, `realtime-do-glue.ts`).
- **Docs style:** describe current behavior only. No "used to throw / formerly Node-only" migration breadcrumbs.
- **The CF-only door** (`server/internal/cloudflare`) value-imports `cloudflare:workers` transitively; only the CF generated entry imports it. The new upgrader must NOT import `cloudflare:workers` itself (it only references the `WebSocketPair` runtime global).
- **Pre-push CI parity** (CLAUDE.md), in order: framework build → `pnpm gen:agents-corpus` → `pnpm format:check` → `pnpm typecheck` → `pnpm test:types` → `pnpm test:coverage` → `pnpm test:integration` → `pnpm --filter site build`. `format:check` is the most-missed; run `pnpm format` if it fails.
- **Work happens in the worktree** `.claude/worktrees/291-cf-websocket-upgrader` on branch `worktree-291-cf-websocket-upgrader`. Use worktree-prefixed absolute paths. Serena is unavailable here; use rg/Read/Edit.

---

### Task 1: `makeCfWebSocketUpgrader` (the CF upgrader unit)

**Files:**
- Create: `packages/server/src/cf/ws-upgrader-cf.ts`
- Test: `packages/server/src/cf/__tests__/ws-upgrader-cf.test.ts`

**Interfaces:**
- Consumes: `WebSocketUpgrader` type from `@hono-preact/iso/internal/runtime` (shape: `(createEvents: (c: Context) => WSEvents | Promise<WSEvents>) => MiddlewareHandler`); `WSContext` + `WSEvents` from `hono/ws`; `WebSocketPair` workerd global.
- Produces: `export function makeCfWebSocketUpgrader(): WebSocketUpgrader` — consumed by Task 2 (the CF door + adapter codegen).

**Behavioral contract:**
1. Non-`Upgrade: websocket` request → `await next()`, return, and never construct a `WebSocketPair`.
2. Upgrade request → build `WebSocketPair`, wire `message`/`close`/`error` listeners **only when** the handler is present, call `server.accept()`, then fire `events.onOpen?.(new Event('open'), ws)` (the parity fix), return `new Response(null, { status: 101, webSocket: client })`.
3. `onOpen` fires strictly after `accept()`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/cf/__tests__/ws-upgrader-cf.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context, Next } from 'hono';
import { makeCfWebSocketUpgrader } from '../ws-upgrader-cf.js';

// A fake workerd server socket recording the call order of accept / listener
// registration / send, so the test can assert onOpen fires AFTER accept().
function makeFakeSocket() {
  const calls: string[] = [];
  const listeners: Record<string, (evt: unknown) => void> = {};
  return {
    calls,
    listeners,
    accept: vi.fn(() => calls.push('accept')),
    addEventListener: vi.fn((type: string, cb: (evt: unknown) => void) => {
      calls.push(`listen:${type}`);
      listeners[type] = cb;
    }),
    send: vi.fn((data: unknown) => calls.push(`send:${String(data)}`)),
    close: vi.fn(),
    protocol: '',
    readyState: 1,
    url: 'https://example.com/ws',
  };
}

// Install fake workerd globals: the real Response rejects status 101, and
// WebSocketPair does not exist off-workerd.
function installGlobals() {
  const client = { __client: true };
  const server = makeFakeSocket();
  vi.stubGlobal(
    'WebSocketPair',
    class {
      0 = client;
      1 = server;
    }
  );
  const responses: Array<{ status?: number; webSocket?: unknown }> = [];
  vi.stubGlobal(
    'Response',
    class {
      status?: number;
      webSocket?: unknown;
      constructor(_body: unknown, init?: { status?: number; webSocket?: unknown }) {
        this.status = init?.status;
        this.webSocket = init?.webSocket;
        responses.push({ status: init?.status, webSocket: init?.webSocket });
      }
    }
  );
  return { client, server, responses };
}

function ctxWithUpgrade(hasUpgrade: boolean): Context {
  return {
    req: { header: (k: string) => (k === 'Upgrade' && hasUpgrade ? 'websocket' : undefined) },
  } as unknown as Context;
}

afterEach(() => vi.unstubAllGlobals());

describe('makeCfWebSocketUpgrader', () => {
  it('passes non-upgrade requests through to next() without creating a pair', async () => {
    vi.stubGlobal('WebSocketPair', class { constructor() { throw new Error('should not construct'); } });
    const upgrader = makeCfWebSocketUpgrader();
    const handler = upgrader(() => ({ onMessage() {} }));
    const next = vi.fn<Next>(async () => {});
    await handler(ctxWithUpgrade(false), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts, then fires onOpen for Node parity, and returns a 101 with the client socket', async () => {
    const { client, server } = installGlobals();
    const upgrader = makeCfWebSocketUpgrader();
    const openSpy = vi.fn();
    const handler = upgrader(() => ({
      onOpen: openSpy,
      onMessage() {},
    }));
    const res = (await handler(ctxWithUpgrade(true), vi.fn())) as unknown as {
      status: number;
      webSocket: unknown;
    };
    expect(server.accept).toHaveBeenCalledOnce();
    expect(openSpy).toHaveBeenCalledOnce();
    // onOpen must fire strictly AFTER accept() (the parity guarantee).
    expect(server.accept.mock.invocationCallOrder[0]).toBeLessThan(
      openSpy.mock.invocationCallOrder[0]
    );
    expect(res.status).toBe(101);
    expect(res.webSocket).toBe(client);
  });

  it('wires only the handlers that are present', async () => {
    const { server } = installGlobals();
    const upgrader = makeCfWebSocketUpgrader();
    const handler = upgrader(() => ({ onMessage() {} }));
    await handler(ctxWithUpgrade(true), vi.fn());
    const listened = server.addEventListener.mock.calls.map((c) => c[0]);
    expect(listened).toEqual(['message']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hono-preact/server test -- ws-upgrader-cf`
Expected: FAIL — cannot resolve `../ws-upgrader-cf.js` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/cf/ws-upgrader-cf.ts`:

```ts
/// <reference types="@cloudflare/workers-types/latest" />
import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';
import { WSContext } from 'hono/ws';
import type { WebSocketUpgrader } from '@hono-preact/iso/internal/runtime';

/**
 * A Cloudflare WebSocket upgrader for the raw `upgradeWebSocket` helper, with
 * Node parity. Unlike `hono/cloudflare-workers`' upgradeWebSocket, it fires
 * `onOpen` after `server.accept()`, so a raw `upgradeWebSocket` route behaves
 * identically on Node and Cloudflare. Each call mints its own `WebSocketPair`:
 * a per-connection duplex socket needs no Durable Object (the DO exists only for
 * cross-connection fan-out and hibernation state, which a raw socket does not use).
 *
 * Installed into the WebSocket-upgrader seam by the Cloudflare adapter's
 * generated worker entry, symmetric to how the Node adapter installs
 * `createNodeWebSocket({ app }).upgradeWebSocket`. Independent of the realtime
 * connector: `/__sockets` (defineSocket / rooms) routes through the connector
 * and never reaches this upgrader.
 */
export function makeCfWebSocketUpgrader(): WebSocketUpgrader {
  return (
    createEvents: (c: Context) => WSEvents | Promise<WSEvents>
  ): MiddlewareHandler => {
    return async (c, next) => {
      if (c.req.header('Upgrade') !== 'websocket') {
        await next();
        return;
      }
      const events = await createEvents(c);
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const ws = new WSContext<WebSocket>({
        close: (code, reason) => server.close(code, reason),
        get protocol() {
          return server.protocol;
        },
        raw: server,
        get readyState() {
          return server.readyState;
        },
        url: server.url ? new URL(server.url) : null,
        send: (source) => server.send(source),
      });
      if (events.onMessage) {
        server.addEventListener('message', (evt) => events.onMessage?.(evt, ws));
      }
      if (events.onClose) {
        server.addEventListener('close', (evt) => events.onClose?.(evt, ws));
      }
      if (events.onError) {
        server.addEventListener('error', (evt) => events.onError?.(evt, ws));
      }
      server.accept();
      events.onOpen?.(new Event('open'), ws);
      return new Response(null, { status: 101, webSocket: client });
    };
  };
}
```

Note: if `pnpm typecheck` (Step 5) reports an event-type mismatch on a listener callback, annotate the param to match `cf-pubsub.ts`'s proven pattern, e.g. `server.addEventListener('message', (evt: MessageEvent) => events.onMessage?.(evt, ws))`, `(evt: CloseEvent)` for close, `(evt: Event)` for error. This is a platform-boundary type annotation, not a value cast.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @hono-preact/server test -- ws-upgrader-cf`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck the server package**

Run: `pnpm --filter @hono-preact/server exec tsc --noEmit`
Expected: no errors (only the Node-engine `[WARN]` lines). If an event-type error appears, apply the annotation from the Step 3 note and re-run Steps 4-5.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/cf/ws-upgrader-cf.ts packages/server/src/cf/__tests__/ws-upgrader-cf.test.ts
git commit -m "feat(server): CF WebSocket upgrader with Node onOpen parity (#291)"
```

---

### Task 2: Install the upgrader in the Cloudflare adapter

**Files:**
- Modify: `packages/server/src/internal-cloudflare.ts` (add the door export)
- Modify: `packages/vite/src/adapter-cloudflare.ts` (extend the generated worker entry)
- Test: `packages/vite/src/__tests__/adapter-cloudflare.test.ts` (add wrapEntry assertions)

**Interfaces:**
- Consumes: `makeCfWebSocketUpgrader` (Task 1); `installWebSocketUpgrader` from `hono-preact/internal/runtime` (already exists; the Node adapter imports it).
- Produces: a CF generated entry that calls `installWebSocketUpgrader(makeCfWebSocketUpgrader())`.

The door export flows to the umbrella `hono-preact/server/internal/cloudflare` automatically (`packages/hono-preact/src/server-internal-cloudflare.ts` is `export *`). No exhaustive export-drift guard covers this door.

- [ ] **Step 1: Write the failing wrapEntry assertions**

Add to `packages/vite/src/__tests__/adapter-cloudflare.test.ts` (reuse the existing top-of-file `ctx` fixture):

```ts
  it('wrapEntry installs the raw-WS upgrader for api.ts upgradeWebSocket routes', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    // Imported from the CF-only server door alongside the connector/DO.
    expect(tail).toContain('makeCfWebSocketUpgrader');
    // installWebSocketUpgrader is grouped with the other iso-runtime installers.
    expect(tail).toContain('installWebSocketUpgrader,');
    expect(tail).toContain('installWebSocketUpgrader(makeCfWebSocketUpgrader());');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hono-preact/vite test -- adapter-cloudflare`
Expected: FAIL — the three `toContain` assertions fail (strings absent from the generated tail).

- [ ] **Step 3: Add the CF-door export**

In `packages/server/src/internal-cloudflare.ts`, add after the `makeAssetsPreloadReader` export line:

```ts
export { makeCfWebSocketUpgrader } from './cf/ws-upgrader-cf.js';
```

- [ ] **Step 4: Extend the CF adapter codegen**

In `packages/vite/src/adapter-cloudflare.ts` `wrapEntry`:

(a) Add `makeCfWebSocketUpgrader` to the CF-door import block. Change the line:

```ts
        `  makeAssetsPreloadReader,\n` +
```

to:

```ts
        `  makeAssetsPreloadReader,\n` +
        `  makeCfWebSocketUpgrader,\n` +
```

(b) Add `installWebSocketUpgrader` to the iso-runtime import block. Change:

```ts
        `import {\n` +
        `  installRealtimeConnector,\n` +
        `  installPubSubBackend,\n` +
        `} from 'hono-preact/internal/runtime';\n` +
```

to:

```ts
        `import {\n` +
        `  installRealtimeConnector,\n` +
        `  installPubSubBackend,\n` +
        `  installWebSocketUpgrader,\n` +
        `} from 'hono-preact/internal/runtime';\n` +
```

(c) Add the install call. Immediately after the `installPubSubBackend(...)` block (the line `);\n` that closes it, right before the `\n` preceding the `// Re-export the Durable Object class` comment), insert:

```ts
        `\n` +
        `// Raw \`upgradeWebSocket\` routes in api.ts upgrade in the worker via a\n` +
        `// WebSocketPair (no Durable Object; the DO is only for fan-out state).\n` +
        `// This upgrader fires onOpen for parity with the Node adapter, unlike\n` +
        `// hono/cloudflare-workers. Independent of the realtime connector above:\n` +
        `// /__sockets goes through the connector, never this upgrader.\n` +
        `installWebSocketUpgrader(makeCfWebSocketUpgrader());\n` +
```

- [ ] **Step 5: Run the wrapEntry test to verify it passes**

Run: `pnpm --filter @hono-preact/vite test -- adapter-cloudflare`
Expected: PASS (existing tests + the new one).

- [ ] **Step 6: Rebuild the framework dist and typecheck**

The vite package resolves the server door through built `dist/` in some paths; rebuild so nothing reads stale dist.

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: build succeeds; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/internal-cloudflare.ts packages/vite/src/adapter-cloudflare.ts packages/vite/src/__tests__/adapter-cloudflare.test.ts
git commit -m "feat(vite): install the CF WebSocket upgrader in the worker entry (#291)"
```

---

### Task 3: End-to-end proof over real workerd

**Files:**
- Create: `packages/vite/src/__tests__/fixtures/cf-fw-ws/vite.config.ts`
- Create: `packages/vite/src/__tests__/fixtures/cf-fw-ws/wrangler.jsonc`
- Create: `packages/vite/src/__tests__/fixtures/cf-fw-ws/src/routes.ts`
- Create: `packages/vite/src/__tests__/fixtures/cf-fw-ws/src/Layout.tsx`
- Create: `packages/vite/src/__tests__/fixtures/cf-fw-ws/src/pages/home.tsx`
- Create: `packages/vite/src/__tests__/fixtures/cf-fw-ws/src/api.ts`
- Modify: `packages/vite/src/__tests__/websocket-dev.test.ts` (add a describe block + a two-frame helper)

**Interfaces:**
- Consumes: the full framework plugin + CF adapter (Tasks 1-2) driven by `@cloudflare/vite-plugin` (workerd) in a real `vite dev` server, exactly like the existing `cf-ws` and `cf-socket` fixtures.
- Produces: an automated assertion that a raw `hono-preact` `upgradeWebSocket` route on CF emits the `onOpen` frame (`ready`) then echoes.

- [ ] **Step 1: Create the fixture `vite.config.ts`**

Copy `packages/vite/src/__tests__/fixtures/cf-socket/vite.config.ts` **verbatim** to `packages/vite/src/__tests__/fixtures/cf-fw-ws/vite.config.ts` (same alias list, same `plugins: [honoPreact({ adapter: cloudflareAdapter() })]`). The relative `pkg()` path depth is identical (both fixtures are at `fixtures/<name>/`).

- [ ] **Step 2: Create `wrangler.jsonc` (no Durable Object, proving none is needed)**

`packages/vite/src/__tests__/fixtures/cf-fw-ws/wrangler.jsonc`:

```jsonc
{
  "name": "cf-fw-ws",
  "main": "node_modules/.vite/hono-preact/server-entry.tsx",
  "compatibility_date": "2026-02-22",
  "compatibility_flags": ["nodejs_compat"]
}
```

- [ ] **Step 3: Create the minimal app files**

`packages/vite/src/__tests__/fixtures/cf-fw-ws/src/routes.ts`:

```ts
import { defineRoutes } from 'hono-preact';

export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
  },
]);
```

`packages/vite/src/__tests__/fixtures/cf-fw-ws/src/Layout.tsx`:

```tsx
import { ClientScript, Head } from 'hono-preact';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="cf-fw-ws" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
```

`packages/vite/src/__tests__/fixtures/cf-fw-ws/src/pages/home.tsx`:

```tsx
export default function Home() {
  return <h1>cf-fw-ws fixture</h1>;
}
```

`packages/vite/src/__tests__/fixtures/cf-fw-ws/src/api.ts`:

```ts
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono-preact';

const app = new Hono();

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    // onOpen fires on CF via the framework upgrader (parity with Node);
    // hono/cloudflare-workers would silently skip it.
    onOpen(_e, ws) {
      ws.send('ready');
    },
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  }))
);

export default app;
```

- [ ] **Step 4: Add the failing integration test**

In `packages/vite/src/__tests__/websocket-dev.test.ts`, add the fixture root next to the existing ones (after `const cfWsRoot = ...`):

```ts
const cfFwWsRoot = resolve(here, 'fixtures/cf-fw-ws');
```

Add a helper below `echoOverWs` that collects the onOpen frame then the echo:

```ts
// Collects the first frame (the onOpen 'ready' push), then sends `message` and
// resolves with [firstFrame, echoFrame]. Proves onOpen parity + echo on CF.
function readyThenEcho(port: number, message: string): Promise<string[]> {
  return new Promise<string[]>((res, rej) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const frames: string[] = [];
    const timer = setTimeout(() => {
      ws.close();
      rej(new Error('ws timeout'));
    }, 15_000);
    ws.on('message', (data) => {
      frames.push(data.toString());
      if (frames.length === 1) {
        ws.send(message);
      } else {
        clearTimeout(timer);
        ws.close();
        res(frames);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      rej(err);
    });
  });
}
```

Add the describe block at the end of the file:

```ts
describe('Cloudflare framework adapter: raw upgradeWebSocket', () => {
  let server: ViteDevServer;

  beforeAll(async () => {
    server = await createServer({ root: cfFwWsRoot, server: { port: 0 } });
    await server.listen();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it('fires onOpen (parity) then echoes over /ws with no Durable Object', async () => {
    const [ready, echo] = await readyThenEcho(serverPort(server), 'hello');
    expect(ready).toBe('ready');
    expect(echo).toBe('echo: hello');
  }, 20_000);
});
```

- [ ] **Step 5: Run the integration test**

Run: `pnpm test:integration -- websocket-dev`
Expected: PASS, including the new "Cloudflare framework adapter" block.

If the fixture fails to boot because the generated entry's re-exported `HonoPreactRealtimeDO` class requires a binding, add these two keys to the fixture `wrangler.jsonc` (copied from `cf-socket`) and re-run:

```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "HONO_PREACT_REALTIME", "class_name": "HonoPreactRealtimeDO" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["HonoPreactRealtimeDO"] }]
```

If that fallback is used, change the test's `it(...)` title to drop "with no Durable Object" and note in the fixture that the binding is only present to satisfy wrangler's DO-class validation, not because raw WS uses it.

- [ ] **Step 6: Commit**

```bash
git add packages/vite/src/__tests__/fixtures/cf-fw-ws packages/vite/src/__tests__/websocket-dev.test.ts
git commit -m "test(vite): real-workerd proof of CF raw upgradeWebSocket parity (#291)"
```

---

### Task 4: Restore the docs-site echo demo and update the coverage guard

**Files:**
- Modify: `apps/site/src/api.ts` (restore the `/api/demo/echo` route)
- Modify: `apps/site/src/__tests__/framework-coverage.test.ts` (drop the `upgradeWebSocket` allowlist entry)

**Interfaces:**
- Consumes: the public `upgradeWebSocket` export (now CF-capable).
- Produces: a live `/api/demo/echo` route on the docs worker; the coverage guard now counts `upgradeWebSocket` as demo-covered.

The guard scans `../api.ts` for value imports from `'hono-preact'`. It has two opposing assertions: an uncovered non-allowlisted export fails one test, and a still-allowlisted-but-now-used export fails the "no stale allowlist entries" test. So the route addition and the allowlist removal MUST land together.

- [ ] **Step 1: Verify the coverage guard is currently green (baseline)**

Run: `pnpm --filter site test -- framework-coverage`
Expected: PASS (with the current allowlist entry present).

- [ ] **Step 2: Restore the echo route**

Replace the comment block in `apps/site/src/api.ts` (lines 16-19, the "No raw WebSocket route here..." comment) and add the import. The file becomes:

```ts
// Hand-authored Hono routes mounted by the framework (the plugin auto-loads
// src/api.ts when present; the default export must be the Hono app).
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono-preact';
import { listAllTasks, listProjects } from './demo/data.js';

const app = new Hono();

app.get('/api/demo/health', (c) =>
  c.json({
    ok: true,
    projects: listProjects().length,
    tasks: listAllTasks().length,
  })
);

// Raw WebSocket route. Works on both adapters: on Cloudflare it upgrades via a
// WebSocketPair in the worker (no Durable Object), firing onOpen for parity
// with Node.
app.get(
  '/api/demo/echo',
  upgradeWebSocket(() => ({
    onOpen(_e, ws) {
      ws.send('ready');
    },
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  }))
);

export default app;
```

- [ ] **Step 3: Drop the allowlist entry**

In `apps/site/src/__tests__/framework-coverage.test.ts`, remove the two-line `upgradeWebSocket:` entry (currently lines 81-82):

```ts
  upgradeWebSocket:
    'Node-adapter-only raw WS upgrader; unusable under the site Cloudflare adapter (#282 finding)',
```

- [ ] **Step 4: Run the coverage guard to verify it still passes**

Run: `pnpm --filter site test -- framework-coverage`
Expected: PASS — `upgradeWebSocket` is now "used" (via `api.ts`) and no longer allowlisted, satisfying both the uncovered-export and stale-allowlist assertions.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/api.ts apps/site/src/__tests__/framework-coverage.test.ts
git commit -m "feat(site): restore /api/demo/echo raw WS route on Cloudflare (#291)"
```

---

### Task 5: Reverse the Node-only claims in the docs

**Files:**
- Modify: `apps/site/src/pages/docs/websockets.mdx`

**Interfaces:** none (prose). Deliverable: docs describe the current cross-runtime behavior with no migration breadcrumbs.

- [ ] **Step 1: Rewrite the intro paragraph (line ~3)**

Change:

```
The raw `upgradeWebSocket` export, imported from `hono-preact`, lets you register any hand-authored WS route in `api.ts` on the same connection, following Hono's own `upgradeWebSocket` pattern; it requires the Node adapter (see below).
```

to:

```
The raw `upgradeWebSocket` export, imported from `hono-preact`, lets you register any hand-authored WS route in `api.ts`, following Hono's own `upgradeWebSocket` pattern. It works on both adapters: on Node it rides the framework's shared connection, and on Cloudflare it upgrades in the worker via a per-route `WebSocketPair`.
```

- [ ] **Step 2: Rewrite the Cloudflare-setup aside (line ~180)**

Change the trailing parenthetical:

```
(This applies to `defineSocket`; the raw `upgradeWebSocket` path below is separate and Node-only.)
```

to:

```
(This applies to `defineSocket`. The raw `upgradeWebSocket` path below is separate and needs no Durable Object binding: it upgrades in the worker via a `WebSocketPair`.)
```

- [ ] **Step 3: Rewrite the "resolves lazily / Cloudflare throws" paragraph (line ~236)**

Change:

```
`upgradeWebSocket` resolves its upgrader lazily at request time, and only the Node adapter installs one. Under the Cloudflare adapter a raw WS route throws at request time (`no WebSocket upgrader installed`); on Cloudflare, realtime goes through the typed primitives (`defineSocket`, rooms), which run inside the framework's Durable Object.
```

to:

```
Both adapters install a WebSocket upgrader, so the same `upgradeWebSocket` route works on Node and Cloudflare with identical `onOpen` → `onMessage` → `onClose` semantics. The two runtimes differ only in how the connection is minted: Node shares the framework's single connection (the one that powers `serverSockets`), while Cloudflare mints a fresh `WebSocketPair` per route and needs no Durable Object binding.
```

- [ ] **Step 4: Rewrite the `### Cloudflare Workers` subsection (line ~263)**

Change:

```
### Cloudflare Workers

The Cloudflare adapter does not install a raw upgrader, so an `upgradeWebSocket` route in `api.ts` fails at request time with `no WebSocket upgrader installed`. Realtime on Cloudflare goes through the typed primitives instead: `defineSocket` / `serverRoute(r).socket` and rooms run inside the framework's `HONO_PREACT_REALTIME` Durable Object (see the Cloudflare setup note above).
```

to:

```
### Cloudflare Workers

On Cloudflare the same `api.ts` route works unchanged. The adapter upgrades each raw route in the worker via a `WebSocketPair`, so it needs no Durable Object binding (unlike `defineSocket`, which does). `onOpen` fires on Cloudflare just as it does on Node:

```ts
// src/api.ts
import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono-preact';

const app = new Hono();

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(_e, ws) {
      ws.send('ready');
    },
    onMessage(event, ws) {
      ws.send(`echo: ${event.data}`);
    },
  }))
);

export default app;
```

Each raw route is its own `WebSocketPair` connection; for cross-connection fan-out use rooms, and for the typed duplex primitive use `defineSocket` (which runs in the Durable Object).
```

- [ ] **Step 5: Rewrite the API-reference line (line ~335)**

Change:

```
Wraps Hono's `upgradeWebSocket` pattern, resolved lazily at request time; only the Node adapter installs an upgrader, so this is a Node-adapter API.
```

to:

```
Wraps Hono's `upgradeWebSocket` pattern. Works on both adapters: Node shares the framework connection, Cloudflare upgrades via a per-route `WebSocketPair` (no Durable Object). `onOpen` fires on both.
```

- [ ] **Step 6: Verify the docs build**

Run: `pnpm --filter site build`
Expected: build succeeds (MDX compiles; no broken code fences).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/pages/docs/websockets.mdx
git commit -m "docs(site): raw upgradeWebSocket works on both adapters (#291)"
```

---

### Final verification (before any push / PR)

Run the full pre-push CI parity sequence from the worktree root, in order:

- [ ] `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
- [ ] `pnpm gen:agents-corpus`
- [ ] `pnpm format:check` (run `pnpm format` and amend/commit if it fails)
- [ ] `pnpm typecheck`
- [ ] `pnpm test:types`
- [ ] `pnpm test:coverage`
- [ ] `pnpm test:integration`
- [ ] `pnpm --filter site build`

Then manually drive `/api/demo/echo` in `apps/site` dev (Cloudflare adapter) to confirm the live path: connect to `ws://localhost:<port>/api/demo/echo`, expect a `ready` frame, send a message, expect `echo: <message>`.

---

## Self-Review

**Spec coverage:**
- CF upgrader with onOpen parity → Task 1. ✓
- Export via CF-only door → Task 2 Step 3. ✓
- Install in CF `wrapEntry` codegen → Task 2 Step 4. ✓
- Restore `/api/demo/echo` → Task 4. ✓
- Drop coverage allowlist entry → Task 4 Step 3. ✓
- Docs reversal (all 6 spec spots: intro, setup aside, lazy/throws paragraph, Cloudflare subsection, API-ref line; the "on the same connection" wording is folded into the intro rewrite) → Task 5. ✓
- Unit test (non-upgrade→next, conditional listeners, onOpen-after-accept, 101) → Task 1. ✓
- wrapEntry `toContain` test → Task 2. ✓
- Real-workerd fixture + integration test → Task 3. ✓
- "No DO needed" asserted by the DO-less fixture → Task 3 Step 2 (with a documented fallback). ✓
- Out-of-scope items (Direction #2, throw-message wording, release notes) correctly omitted. ✓

**Placeholder scan:** No TBD/TODO. The one conditional (Task 3 Step 5 DO-binding fallback) carries the exact fallback content and the exact follow-up edits, so it is a decision branch, not a placeholder.

**Type consistency:** `makeCfWebSocketUpgrader(): WebSocketUpgrader` is defined in Task 1 and referenced verbatim in Task 2 (door export + codegen string + wrapEntry assertions). `installWebSocketUpgrader` matches the existing iso-runtime export the Node adapter uses. Fixture route path `/ws` and the `ready`/`echo: <msg>` frames match between Task 3's fixture (`src/api.ts`) and its assertions. `/api/demo/echo` path and frames match between Task 4's route and the final manual-verification step.
