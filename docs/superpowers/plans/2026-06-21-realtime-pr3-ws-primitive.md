# Realtime PR 3: duplex WebSocket primitive (`defineSocket`/`useSocket`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed, per-connection duplex WebSocket primitive: `serverSockets` (`.server` named export) defined with `defineSocket`/`route.socket`, served at a single `GET /__sockets` endpoint, and consumed by a client `useSocket` hook. Node only (the CF upgrader installs with PR 5's Durable Object).

**Architecture:** The per-runtime WebSocket upgrader reaches the runtime through a new **install seam** (`installWebSocketUpgrader`/`getWebSocketUpgrader`, modeled exactly on `installPubSubBackend`); `createServerEntry` registers `GET /__sockets` with a handler that resolves the upgrader **lazily at request time**. The Node adapter wrapper calls `createNodeWebSocket({ app })`, installs its `upgradeWebSocket`, and owns `injectWebSocket` (replacing the old "re-export `injectWebSocket` from the user's `api.ts`" convention; a public `upgradeWebSocket` is exposed so `api.ts` can still author raw WS on the one shared `wss`). Messages are typed discriminated unions, JSON on the wire via `Serialize<T>`; guards run before the upgrade (deny closes `4403`); `open()` may return a teardown fn. This is PR 3 of the 5-PR program (spec: `docs/superpowers/specs/2026-06-20-first-class-realtime-design.md`); PRs 1-2 are merged.

**Tech Stack:** TypeScript, Hono + `@hono/node-ws` (`createNodeWebSocket`), Preact hooks, Vitest, Babel AST (vite plugins).

## Global Constraints

- **No em-dashes** in prose, code comments, or commit messages.
- **Casts are a smell.** New source uses no `as` casts except the two sanctioned boundaries the codebase already blesses: parsing untrusted wire JSON (`JSON.parse(...) as Serialize<T>`, exactly as `action.ts`/`loader-fetch.ts` do) and the phantom-brand pattern if reused. Reshape everywhere else. Tests may use a documented stub cast for a field the code under test does not read.
- **Discriminated-union messages, types-only validation.** `defineSocket<Incoming, Outgoing, Data>()`; the wire is JSON modeled by `Serialize<T>`. No runtime schema validator (match loaders/actions).
- **Framework owns WS wiring (decided).** The Node wrapper calls `createNodeWebSocket({ app })` and owns `injectWebSocket`; the old `injectWebSocket`-from-`api.ts` re-export is removed (breaking, unreleased). A public `upgradeWebSocket` (delegating to `getWebSocketUpgrader`) is exposed for raw `api.ts` WS on the shared `wss`.
- **Node only (decided).** Ship the generic seam + the Node upgrader. Do NOT wire the Cloudflare upgrader here; that lands in PR 5 with the Durable-Object backend.
- **`open()` returns a teardown fn** (or void); the framework calls it on close/abort.
- **Reserved path.** Add `SOCKETS_RPC_PATH` to the vite reserved-path set so `api.ts` cannot shadow it.
- **Pre-merge gate** (mirror `.github/workflows/ci.yml`): framework build, `format:check`, `typecheck`, `test:types`, `test:coverage`, `test:integration`, `pnpm --filter site build`.
- Commits land on the current branch `realtime-pr3-ws-primitive` (based on `main` with PRs 1-2 merged).

---

### Task 1: contract constants + `installWebSocketUpgrader` seam

**Files:**
- Modify: `packages/iso/src/internal/contract.ts`
- Create: `packages/iso/src/internal/ws-upgrader.ts`
- Modify: `packages/iso/src/internal-runtime.ts` (export the seam)
- Test: `packages/iso/src/internal/__tests__/ws-upgrader.test.ts`

**Interfaces produced:**
- contract: `SOCKETS_RPC_PATH = '/__sockets'`, `SOCKET_MODULE_PARAM = 'm'`, `SOCKET_NAME_PARAM = 's'`, `FORM_SOCKET_FIELD = '__socket'`, `WS_DENY_CODE = 4403`, `WS_TIMEOUT_CODE = 4408`.
- `ws-upgrader.ts`: `type WebSocketUpgrader = (createEvents: (c: Context) => WSEvents | Promise<WSEvents>) => MiddlewareHandler` (alias Hono's `UpgradeWebSocket` shape); `installWebSocketUpgrader(u: WebSocketUpgrader): void`; `getWebSocketUpgrader(): WebSocketUpgrader` (throws a clear error if none installed).

- [ ] **Step 1: Add the contract constants**

In `packages/iso/src/internal/contract.ts`, after the `FORM_ACTION_FIELD` constant, add:

```ts
/** The socket-upgrade endpoint (a header-only GET; selectors ride the query). */
export const SOCKETS_RPC_PATH = '/__sockets';
/** Query params selecting which socket: module key + socket name. */
export const SOCKET_MODULE_PARAM = 'm';
export const SOCKET_NAME_PARAM = 's';
/** Client socket-stub descriptor field for the socket name (module reuses FORM_MODULE_FIELD). */
export const FORM_SOCKET_FIELD = '__socket';
/** WebSocket close codes (4000-4999 = application-defined). */
export const WS_DENY_CODE = 4403;
export const WS_TIMEOUT_CODE = 4408;
```

- [ ] **Step 2: Write the failing seam test**

Create `packages/iso/src/internal/__tests__/ws-upgrader.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  installWebSocketUpgrader,
  getWebSocketUpgrader,
  __resetWebSocketUpgraderForTesting,
} from '../ws-upgrader.js';

afterEach(() => __resetWebSocketUpgraderForTesting());

describe('ws-upgrader seam', () => {
  it('throws a clear error when no upgrader is installed', () => {
    expect(() => getWebSocketUpgrader()).toThrow(/no websocket upgrader/i);
  });

  it('returns the installed upgrader', () => {
    const fake = ((createEvents) => createEvents) as never;
    installWebSocketUpgrader(fake);
    expect(getWebSocketUpgrader()).toBe(fake);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/ws-upgrader.test.ts`
Expected: FAIL, cannot resolve `../ws-upgrader.js`.

- [ ] **Step 4: Implement the seam**

Create `packages/iso/src/internal/ws-upgrader.ts`:

```ts
import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';

// The per-runtime WebSocket upgrader (Hono's UpgradeWebSocket shape). Installed
// at boot by the adapter wrapper (Node: createNodeWebSocket({app}).upgradeWebSocket;
// Cloudflare in a later release). createServerEntry reads it lazily at request
// time when handling GET /__sockets. Mirrors the installPubSubBackend seam: the
// Vite adapter is build-time only and cannot supply this directly.
export type WebSocketUpgrader = (
  createEvents: (c: Context) => WSEvents | Promise<WSEvents>
) => MiddlewareHandler;

let current: WebSocketUpgrader | null = null;

export function installWebSocketUpgrader(upgrader: WebSocketUpgrader): void {
  current = upgrader;
}

export function getWebSocketUpgrader(): WebSocketUpgrader {
  if (!current) {
    throw new Error(
      'hono-preact: no WebSocket upgrader installed. serverSockets require a ' +
        'WS-capable adapter (the Node adapter installs one at boot).'
    );
  }
  return current;
}

/** Test-only reset. */
export function __resetWebSocketUpgraderForTesting(): void {
  current = null;
}
```

- [ ] **Step 5: Export the seam from the runtime door**

In `packages/iso/src/internal-runtime.ts`, add next to the `installPubSubBackend` export:

```ts
export { installWebSocketUpgrader } from './internal/ws-upgrader.js';
export type { WebSocketUpgrader } from './internal/ws-upgrader.js';
```

- [ ] **Step 6: Run the seam test (pass) and commit**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/ws-upgrader.test.ts`
Expected: PASS (2 tests).

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/internal/contract.ts packages/iso/src/internal/ws-upgrader.ts packages/iso/src/internal-runtime.ts packages/iso/src/internal/__tests__/ws-upgrader.test.ts
git commit -m "feat(iso): socket wire contract + installWebSocketUpgrader runtime seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `defineSocket` + `route.socket` + socket types

**Files:**
- Create: `packages/iso/src/define-socket.ts`
- Modify: `packages/iso/src/server-route.ts` (add `socket` to `RouteServer` + factory)
- Test: `packages/iso/src/__tests__/define-socket.test-d.ts`
- Test: `packages/iso/src/__tests__/define-socket.test.ts`

**Interfaces produced:**
- `ServerSocket<Outgoing, Data>`: `{ send(message: Outgoing): void; close(code?: number, reason?: string): void; data: Data; readonly raw: unknown }`.
- `SocketHandler<Incoming, Outgoing, Data, Params>`: `{ use?: ReadonlyArray<Middleware>; open?(socket, ctx): void | (() => void) | Promise<void | (() => void)>; message?(socket, message: Incoming): void | Promise<void>; close?(socket, ev: { code: number; reason: string }): void; error?(socket, err: unknown): void }` where `ctx: { c: Context; params: Params }`.
- `SocketRef<Incoming, Outgoing>`: the client-facing descriptor type (carries the message types phantom-wise; runtime on the server is the def, on the client a `{__module, __socket}` stub).
- `defineSocket<Incoming, Outgoing, Data = undefined>(handler): SocketRef<Incoming, Outgoing>` and `RouteServer.socket<Incoming, Outgoing, Data = undefined>(handler): SocketRef<Incoming, Outgoing>` (route form types `ctx.params`).

- [ ] **Step 1: Read the patterns to mirror**

Read `packages/iso/src/action.ts` (the `defineAction`/`ActionRef` shape, how the server def doubles as a client-typed ref) and `packages/iso/src/server-route.ts` (the `liveLoader` addition pattern). Mirror how `defineAction` returns a value typed for the client while holding the server fn.

- [ ] **Step 2: Write the type contract test**

Create `packages/iso/src/__tests__/define-socket.test-d.ts`:

```ts
// Type-level contract for defineSocket. Run under `pnpm test:types`.
import { expectTypeOf } from 'vitest';
import { defineSocket, type SocketRef } from '../define-socket.js';

type In = { kind: 'ping' } | { kind: 'say'; text: string };
type Out = { kind: 'pong'; at: number } | { kind: 'said'; text: string };

function _probes() {
  const ref = defineSocket<In, Out, { joinedAt: number }>({
    open(socket) {
      // socket.send is typed to Outgoing; socket.data to Data.
      expectTypeOf(socket.data).toEqualTypeOf<{ joinedAt: number }>();
      socket.send({ kind: 'pong', at: 1 });
      // @ts-expect-error wrong outgoing shape
      socket.send({ kind: 'nope' });
      return () => undefined; // teardown allowed
    },
    message(socket, msg) {
      expectTypeOf(msg).toEqualTypeOf<In>();
      if (msg.kind === 'say') socket.send({ kind: 'said', text: msg.text });
    },
  });
  expectTypeOf(ref).toEqualTypeOf<SocketRef<In, Out>>();
}

void _probes;
```

- [ ] **Step 3: Implement `define-socket.ts`**

Create `packages/iso/src/define-socket.ts`:

```ts
import type { Context } from 'hono';
import type { Middleware } from './middleware.js';
import {
  FORM_MODULE_FIELD,
  FORM_SOCKET_FIELD,
} from './internal/contract.js';

/** The per-connection socket handle handed to the server handlers. */
export interface ServerSocket<Outgoing, Data> {
  send(message: Outgoing): void;
  close(code?: number, reason?: string): void;
  data: Data;
  /** The underlying runtime socket (escape hatch). */
  readonly raw: unknown;
}

export interface SocketHandler<Incoming, Outgoing, Data, Params> {
  /** Guard/middleware chain run before the upgrade; a deny closes 4403. */
  use?: ReadonlyArray<Middleware>;
  /** Per-connection setup. May return a teardown fn called on close. */
  open?(
    socket: ServerSocket<Outgoing, Data>,
    ctx: { c: Context; params: Params }
  ): void | (() => void) | Promise<void | (() => void)>;
  message?(
    socket: ServerSocket<Outgoing, Data>,
    message: Incoming
  ): void | Promise<void>;
  close?(
    socket: ServerSocket<Outgoing, Data>,
    ev: { code: number; reason: string }
  ): void;
  error?(socket: ServerSocket<Outgoing, Data>, err: unknown): void;
}

// The runtime def the server registry reads. __moduleKey/__socketName are
// threaded by the build (the prepended __moduleKey export + the client stub),
// so they are optional here and unused on the server (the registry keys by the
// module's own __moduleKey + the serverSockets property name).
export interface SocketDef<Incoming, Outgoing, Data>
  extends SocketHandler<Incoming, Outgoing, Data, Record<string, string>> {
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
}

/**
 * The client-facing reference. On the server it is the SocketDef; on the client
 * the `.server` import is stripped to a `{ __module, __socket }` descriptor. The
 * message types ride phantom fields so `useSocket(ref)` infers them.
 */
export interface SocketRef<Incoming, Outgoing> {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_SOCKET_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
}

/**
 * Define a typed duplex WebSocket. Place it in a `serverSockets` map in a
 * `.server` module; consume it with `useSocket(serverSockets.x)`.
 *
 * The handler only ever touches its own connection (`socket`); per-connection
 * state lives on `socket.data`. `open` may return a teardown fn.
 */
export function defineSocket<Incoming, Outgoing, Data = undefined>(
  handler: SocketHandler<Incoming, Outgoing, Data, Record<string, string>>
): SocketRef<Incoming, Outgoing> {
  // The handler IS the runtime def on the server; the type presents as a
  // client SocketRef. The build strips the body on the client and replaces it
  // with the descriptor stub, so this object only runs server-side.
  return handler as SocketDef<Incoming, Outgoing, Data>;
}
```

Note: the single `as SocketDef<...>` return is the one sanctioned cast in this file, the def-doubles-as-ref pattern (identical to how `defineAction` returns a server fn typed as a client ref). If `action.ts` achieves this without a cast (e.g. via an overload), mirror that instead and drop the cast.

- [ ] **Step 4: Add `socket` to `RouteServer` + the factory**

In `packages/iso/src/server-route.ts`:
- Import: `import { defineSocket, type SocketHandler, type SocketRef } from './define-socket.js';`
- Add to the `RouteServer<RouteId>` interface:

```ts
  /**
   * Define a duplex WebSocket bound to this route. `ctx.params` is typed from
   * the route's pattern. Consume with `useSocket(serverSockets.x)`.
   */
  socket<Incoming, Outgoing, Data = undefined>(
    handler: SocketHandler<Incoming, Outgoing, Data, RouteParams<RouteId>>
  ): SocketRef<Incoming, Outgoing>;
```

- Add to the factory return object:

```ts
    socket: (handler) => defineSocket(handler),
```

(`defineSocket`'s `Params` defaults to `Record<string,string>`; the route form passes `RouteParams<RouteId>` at the type level. If the param variance requires it, widen `defineSocket`'s signature to accept `SocketHandler<Incoming, Outgoing, Data, RouteParams<RouteId>>` via a generic `Params` param. Verify with the type test.)

- [ ] **Step 5: Write a small runtime test**

Create `packages/iso/src/__tests__/define-socket.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineSocket } from '../define-socket.js';

describe('defineSocket', () => {
  it('returns the handler object (server def doubles as the ref)', () => {
    const open = () => undefined;
    const ref = defineSocket<{ a: 1 }, { b: 2 }, undefined>({ open });
    // The runtime value is the handler (server reads .open/.message/.use).
    expect((ref as { open?: unknown }).open).toBe(open);
  });
});
```

- [ ] **Step 6: Run type + unit tests, then commit**

Run: `pnpm exec vitest run --typecheck.only packages/iso/src/__tests__/define-socket.test-d.ts` -> PASS.
Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-socket.test.ts` -> PASS.

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/define-socket.ts packages/iso/src/server-route.ts packages/iso/src/__tests__/define-socket.test-d.ts packages/iso/src/__tests__/define-socket.test.ts
git commit -m "feat(iso): defineSocket + route.socket typed duplex socket definition

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `serverSockets` codegen (vite)

**Files:**
- Modify: `packages/vite/src/server-exports-contract.ts`
- Modify: `packages/vite/src/server-loader-validation.ts`
- Modify: `packages/vite/src/stub-templates.ts`
- Modify: `packages/vite/src/server-only.ts`
- Test: `packages/vite/src/__tests__/server-sockets-stub.test.ts`

**Interfaces produced:** client import of `serverSockets` from a `.server` file resolves to a `Proxy` whose `serverSockets.x` is `{ [FORM_MODULE_FIELD]: moduleKey, [FORM_SOCKET_FIELD]: 'x' }`.

- [ ] **Step 1: Add `serverSockets` to the contract**

In `packages/vite/src/server-exports-contract.ts`:

```ts
export const RECOGNIZED_SERVER_EXPORTS = [
  'serverActions',
  'serverLoaders',
  'serverSockets',
] as const;
```

- [ ] **Step 2: Widen the "must export one of" validation**

In `packages/vite/src/server-loader-validation.ts`, the check that requires `serverActions` or `serverLoaders` must also accept `serverSockets`. Change the condition (currently `!namedExports.includes('serverActions') && !namedExports.includes('serverLoaders')`) to also require the absence of `serverSockets`:

```ts
      if (
        !namedExports.includes('serverActions') &&
        !namedExports.includes('serverLoaders') &&
        !namedExports.includes('serverSockets')
      ) {
```

(Update the error message text to mention `serverSockets` too.)

- [ ] **Step 3: Add `socketStubSource` (mirror `actionStubSource`)**

In `packages/vite/src/stub-templates.ts`, import `FORM_SOCKET_FIELD` alongside the existing contract imports, and add (mirroring `actionStubSource` exactly, which is at lines 37-47):

```ts
// Source for the `serverSockets` client stub. Each `serverSockets.<name>` read
// returns a descriptor record (module + socket name) that `useSocket` reads to
// build the /__sockets URL. Like actions, the stub is a descriptor, not a
// singleton.
export function socketStubSource(localName: string, moduleKey: string): string {
  return (
    `const ${localName} = new Proxy({}, {\n` +
    `  get(_, name) {\n` +
    `    return { ${FORM_MODULE_FIELD}: ${JSON.stringify(moduleKey)}, ${FORM_SOCKET_FIELD}: String(name) };\n` +
    `  }\n` +
    `});`
  );
}
```

- [ ] **Step 4: Wire the `serverSockets` branch in `server-only.ts`**

In `packages/vite/src/server-only.ts`, where it branches per specifier (`serverLoaders` -> `loaderStubSource`, `serverActions` -> `actionStubSource`), add a `serverSockets` -> `socketStubSource(local, moduleKey)` branch. Import `socketStubSource`. The unknown-specifier `throw` already references `ALLOWED_SPECIFIERS_LIST` (derived from the contract), so adding to the contract in Step 1 keeps the error list correct. No stub-import prepend is needed (the stub is a plain object literal, unlike loaders/actions which import a runtime helper).

- [ ] **Step 5: Write the stub test**

Create `packages/vite/src/__tests__/server-sockets-stub.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin } from '../server-only.js';

function transformClientImport(code: string, id: string) {
  const plugin = serverOnlyPlugin();
  // @ts-expect-error minimal config stub
  plugin.configResolved?.({ root: '/proj' });
  // @ts-expect-error transform signature; ssr=false (client)
  return plugin.transform?.(code, id, { ssr: false }) as
    | { code: string }
    | undefined;
}

describe('serverOnlyPlugin: serverSockets', () => {
  it('rewrites a client import of serverSockets into a descriptor proxy', () => {
    const out = transformClientImport(
      `import { serverSockets } from '/proj/src/pages/chat.server.js';`,
      '/proj/src/app.tsx'
    );
    expect(out?.code).toContain('new Proxy');
    expect(out?.code).toContain('__module');
    expect(out?.code).toContain('__socket');
  });
});
```

(If `serverOnlyPlugin`'s transform signature differs, read `server-only.ts` and match how its existing tests in `packages/vite/src/__tests__/server-only-plugin.test.ts` invoke it; mirror that harness.)

- [ ] **Step 6: Run vite tests, then commit**

Run (from worktree root): `pnpm exec vitest run packages/vite/src/__tests__/server-sockets-stub.test.ts packages/vite/src/__tests__/server-only-plugin.test.ts packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`
Expected: PASS (new test + the two existing suites unchanged).

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/vite/src/server-exports-contract.ts packages/vite/src/server-loader-validation.ts packages/vite/src/stub-templates.ts packages/vite/src/server-only.ts packages/vite/src/__tests__/server-sockets-stub.test.ts
git commit -m "feat(vite): serverSockets .server export recognition + client stub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: server `GET /__sockets` endpoint + socket registry + guards

**Files:**
- Create: `packages/server/src/sockets-handler.ts`
- Modify: `packages/server/src/create-server-entry.ts` (register the endpoint)
- Modify: `packages/vite/src/server-entry.ts` (add `SOCKETS_RPC_PATH` to `RESERVED_PATHS`)
- Test: `packages/server/src/__tests__/sockets-handler.test.ts`

**Interfaces produced:** `buildSocketRegistry(serverImports): Map<string, SocketDef<unknown, unknown, unknown>>` keyed `${moduleKey}::${name}`; `socketsHandler(opts)` -> a Hono `MiddlewareHandler` registered at `SOCKETS_RPC_PATH`.

- [ ] **Step 1: Read the collection + chain patterns**

Read `packages/server/src/loaders-handler.ts` (`buildLoadersMap` at ~48-86, the `composeServerChain` call at ~235, the `${moduleKey}::${name}` keying) and `packages/server/src/compose-server-chain.ts` (signature). Mirror `buildLoadersMap` for sockets (read `mod.__moduleKey` + `mod.serverSockets`).

- [ ] **Step 2: Implement `sockets-handler.ts`**

Create `packages/server/src/sockets-handler.ts`:

```ts
import type { Context, MiddlewareHandler } from 'hono';
import type { WSEvents } from 'hono/ws';
import {
  SOCKET_MODULE_PARAM,
  SOCKET_NAME_PARAM,
  WS_DENY_CODE,
} from '@hono-preact/iso/internal';
import { getWebSocketUpgrader } from '@hono-preact/iso/internal/runtime';
import { composeServerChain } from './compose-server-chain.js';
import type { SocketDef } from '@hono-preact/iso';

type AnySocketDef = SocketDef<unknown, unknown, unknown>;

/** Build the moduleKey::name -> SocketDef registry from the route server modules. */
export function buildSocketRegistry(
  serverImports: ReadonlyArray<() => Promise<Record<string, unknown>>>
): Promise<Map<string, AnySocketDef>> {
  // Mirror buildLoadersMap: import each module, read __moduleKey + serverSockets,
  // key each entry `${moduleKey}::${name}`. (Implement the async glob walk the
  // same way loaders-handler does; see Step 1.)
  // ... (mirror loaders-handler buildLoadersMap structure exactly) ...
}

export interface SocketsHandlerOptions {
  registry: Map<string, AnySocketDef>;
  appConfig?: { use?: ReadonlyArray<unknown> };
  dev?: boolean;
}

/**
 * Handle GET /__sockets. Resolve the socket by module key + name, run its guard
 * chain (app use + the socket's use) before upgrading, and wire the connection
 * handlers through a JSON Serialize boundary. A guard denial upgrades and then
 * immediately closes WS_DENY_CODE (a rejected handshake is opaque in browsers).
 */
export function socketsHandler(opts: SocketsHandlerOptions): MiddlewareHandler {
  return (c, next) => {
    const upgrade = getWebSocketUpgrader(); // lazy: installed by the adapter at boot
    const createEvents = async (ctx: Context): Promise<WSEvents> => {
      const moduleKey = ctx.req.query(SOCKET_MODULE_PARAM);
      const name = ctx.req.query(SOCKET_NAME_PARAM);
      const def =
        moduleKey && name
          ? opts.registry.get(`${moduleKey}::${name}`)
          : undefined;
      if (!def) {
        return { onOpen: (_e, ws) => ws.close(WS_DENY_CODE, 'unknown socket') };
      }

      // Run guards (app use + socket.use) before the connection goes live.
      const chain = await composeServerChain({
        requestSignal: ctx.req.raw.signal,
        appConfig: opts.appConfig,
        resolvePageUse: () => [],
        path: SOCKETS_RPC_PATH,
        unitUse: def.use ?? [],
        defaultTimeoutMs: false,
      });
      const denied = await runGuards(chain, ctx); // returns a deny outcome or null

      // Build the per-connection socket wrapper + teardown holder.
      let teardown: (() => void) | void;
      const data: Record<string, unknown> = {};
      const wrap = (ws: { send(d: string): void; close(c?: number, r?: string): void; raw?: unknown }) => ({
        send: (m: unknown) => ws.send(JSON.stringify(m)),
        close: (code?: number, reason?: string) => ws.close(code, reason),
        data,
        raw: ws.raw,
      });

      return {
        async onOpen(_e, ws) {
          if (denied) {
            ws.close(WS_DENY_CODE, 'forbidden');
            return;
          }
          teardown = (await def.open?.(wrap(ws), { c: ctx, params: ctx.req.param() })) ?? undefined;
        },
        async onMessage(ev, ws) {
          if (denied) return;
          const raw = typeof ev.data === 'string' ? ev.data : await blobToText(ev.data);
          const msg = JSON.parse(raw); // sanctioned untrusted-JSON boundary
          await def.message?.(wrap(ws), msg);
        },
        onClose(ev, ws) {
          teardown?.();
          def.close?.(wrap(ws), { code: ev.code, reason: ev.reason });
        },
        onError(_e, ws) {
          def.error?.(wrap(ws), new Error('websocket error'));
        },
      };
    };
    return upgrade(createEvents)(c, next);
  };
}
```

Note: `runGuards`, `blobToText`, and `buildSocketRegistry`'s body must mirror existing helpers, read `loaders-handler.ts` for the chain dispatch (it composes `serverMw` then runs it; reuse `dispatchServer` the same way) and reuse any existing blob/text helper. The `JSON.parse(raw)` is the sanctioned untrusted-JSON boundary (same as `action.ts`/`loader-fetch.ts`); type the parsed value via the def's `Incoming` only at the typed `useSocket` layer, not here. Keep this file focused; if it grows past one responsibility, split the registry builder into `socket-registry.ts`.

- [ ] **Step 3: Register the endpoint in `createServerEntry`**

In `packages/server/src/create-server-entry.ts`: build the socket registry from the same `serverImports` the loader map uses, and register `app.get(SOCKETS_RPC_PATH, socketsHandler({ registry, appConfig, dev }))` BEFORE the SSR `GET *` catch-all (so it is not swallowed). Import `SOCKETS_RPC_PATH` from the contract. Add `SOCKETS_RPC_PATH` to `CreateServerEntryOptions` wiring exactly as `LOADERS_RPC_PATH` is registered.

- [ ] **Step 4: Reserve the path against api.ts shadowing**

In `packages/vite/src/server-entry.ts`, add `SOCKETS_RPC_PATH` to `RESERVED_PATHS` (currently `new Set([LOADERS_RPC_PATH])`).

- [ ] **Step 5: Test the handler**

Create `packages/server/src/__tests__/sockets-handler.test.ts`: install a fake upgrader (via `installWebSocketUpgrader`) that synchronously invokes `createEvents` and drives a fake `ws` (capturing `send`/`close`). Assert: (a) an unknown `m`/`s` closes `WS_DENY_CODE`; (b) a known socket's `open` runs and `socket.send(obj)` writes `JSON.stringify(obj)` to the fake ws; (c) `onMessage` JSON-parses and reaches `def.message`; (d) `onClose` runs the teardown returned by `open`. Mirror the fake-driver style of an existing handler test. Reset the upgrader in `afterEach`.

- [ ] **Step 6: Run server tests, then commit**

Run (root): `pnpm exec vitest run packages/server/src/__tests__/sockets-handler.test.ts`
Expected: PASS.

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/server/src/sockets-handler.ts packages/server/src/create-server-entry.ts packages/vite/src/server-entry.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "feat(server): GET /__sockets endpoint + socket registry + guard-before-upgrade

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Node adapter WS wiring + public `upgradeWebSocket`

**Files:**
- Modify: `packages/vite/src/adapter-node.ts` (`wrapEntry`)
- Modify: `packages/vite/src/node-dev-server.ts` (the `'upgrade'` hook still reads the wrapper's `injectWebSocket`, now the framework's)
- Create: `packages/iso/src/upgrade-websocket.ts` (public `upgradeWebSocket` delegating to the seam) + export it
- Test: update `packages/vite/src/__tests__/adapter-node.test.ts` and `packages/vite/src/__tests__/websocket-dev.test.ts`

- [ ] **Step 1: Rewrite the Node `wrapEntry`**

In `packages/vite/src/adapter-node.ts`, replace the `wrapEntry` body so the framework owns the WS upgrade. The new emitted source:

```ts
      return (
        `import { serve } from '@hono/node-server';\n` +
        `import { serveStatic } from '@hono/node-server/serve-static';\n` +
        `import { Hono } from 'hono';\n` +
        `import { createNodeWebSocket } from '@hono/node-ws';\n` +
        `import { installWebSocketUpgrader } from 'hono-preact/internal/runtime';\n` +
        `import coreApp from ${JSON.stringify(ctx.coreAppModuleId)};\n` +
        (hasApi ? `import * as __api from ${JSON.stringify(ctx.apiModuleId)};\n` : '') +
        `\n` +
        `const app = new Hono()\n` +
        `  .use('/static/*', serveStatic({ root: './dist/client' }))\n` +
        `  .route('/', coreApp);\n` +
        `\n` +
        `// The framework owns the single node-ws instance: it powers GET /__sockets\n` +
        `// (via the installed upgrader) and any raw api.ts WS (via the public\n` +
        `// upgradeWebSocket, which reads the same installed upgrader).\n` +
        `const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });\n` +
        `installWebSocketUpgrader(upgradeWebSocket);\n` +
        `\n` +
        `export { app, injectWebSocket };\n` +
        `export default app;\n` +
        `\n` +
        `if (import.meta.env.PROD) {\n` +
        `  const port = Number(process.env.PORT) || 3000;\n` +
        `  const server = serve({ fetch: app.fetch, port });\n` +
        `  console.log(\`hono-preact: listening on http://localhost:\${port}\`);\n` +
        `  injectWebSocket(server);\n` +
        `}\n`
      );
```

Remove the old `apiImport`/`injectExport`/`injectBoot` (the user-`api.ts` `injectWebSocket` re-export is gone; `__api` is only imported if some future need arises, drop it entirely if unused). `installWebSocketUpgrader` runs at module load, before any `/__sockets` request, satisfying the lazy resolve in Task 4.

- [ ] **Step 2: Confirm the dev `'upgrade'` hook still works**

Read `packages/vite/src/node-dev-server.ts`. It imports `{ injectWebSocket }` from the entry wrapper and calls it with an `on('upgrade', fn)` shim. The wrapper now exports the framework's `injectWebSocket` (from `createNodeWebSocket`), so the hook is unchanged in shape. Verify the wrapper is imported in dev (it is, to obtain `app`/`injectWebSocket`), so `installWebSocketUpgrader` runs in dev too. If the hook referenced a now-removed export, fix it.

- [ ] **Step 3: Public `upgradeWebSocket` for api.ts**

Create `packages/iso/src/upgrade-websocket.ts`:

```ts
import type { Context } from 'hono';
import type { WSEvents } from 'hono/ws';
import { getWebSocketUpgrader } from './internal/ws-upgrader.js';

/**
 * Upgrade a route to a raw WebSocket using the framework's single connection
 * (the same one that powers serverSockets). Use in `api.ts` for hand-authored
 * WS routes:
 *
 *   app.get('/raw', upgradeWebSocket((c) => ({ onMessage(ev, ws) { ws.send('hi') } })));
 */
export function upgradeWebSocket(
  createEvents: (c: Context) => WSEvents | Promise<WSEvents>
) {
  return getWebSocketUpgrader()(createEvents);
}
```

Export it from `packages/iso/src/index.ts` (Task 7 lists exports).

- [ ] **Step 4: Update adapter tests**

Update `packages/vite/src/__tests__/adapter-node.test.ts`: the emitted wrapper now contains `createNodeWebSocket`, `installWebSocketUpgrader`, and `export { app, injectWebSocket }`, and no longer references `__api.injectWebSocket`. Update assertions accordingly. Update `packages/vite/src/__tests__/websocket-dev.test.ts` if it asserted the old api.ts-sourced `injectWebSocket`; it should now assert the framework-owned wiring. Run them after.

- [ ] **Step 5: Run adapter/dev tests, then commit**

Run (root): `pnpm exec vitest run packages/vite/src/__tests__/adapter-node.test.ts packages/vite/src/__tests__/websocket-dev.test.ts`
Expected: PASS.

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/vite/src/adapter-node.ts packages/vite/src/node-dev-server.ts packages/iso/src/upgrade-websocket.ts packages/vite/src/__tests__/adapter-node.test.ts packages/vite/src/__tests__/websocket-dev.test.ts
git commit -m "feat(vite): framework-owned node-ws wiring + public upgradeWebSocket for api.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: client `useSocket` hook

**Files:**
- Create: `packages/iso/src/use-socket.ts`
- Test: `packages/iso/src/__tests__/use-socket.test.tsx`

**Interfaces produced:** `useSocket<R extends SocketRef<unknown, unknown>>(ref: R, opts?): { send(msg: Incoming<R>): void; status: SocketStatus; close(code?, reason?): void; closeInfo?: { code; reason; wasClean }; lastMessage?: Serialize<Outgoing<R>> }` where `SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed'`.

- [ ] **Step 1: Read the client patterns**

Read `packages/iso/src/action.ts` `useAction` (hook state shape, the `isBrowser()` guard, building the URL from `window.location`) and `packages/iso/src/internal/contract.ts` (`SOCKETS_RPC_PATH`, `SOCKET_MODULE_PARAM`, `SOCKET_NAME_PARAM`, `FORM_MODULE_FIELD`, `FORM_SOCKET_FIELD`). Mirror the action hook's structure.

- [ ] **Step 2: Write the hook test**

Create `packages/iso/src/__tests__/use-socket.test.tsx` using a fake global `WebSocket`. Assert (driving the fake socket's events via `act`): (a) `status` goes `connecting` -> `open` on `onopen`; (b) `send(obj)` before open queues, then flushes `JSON.stringify(obj)` on open; (c) `onmessage` with JSON invokes `opts.onMessage` with the parsed object; (d) a `close` with code `4403` sets `closeInfo.code === 4403` and does NOT reconnect (default `shouldReconnect`); (e) a `1006` close schedules a reconnect (`status === 'reconnecting'`). Use a minimal fake `WebSocket` class assigned to `globalThis.WebSocket` in the test, restored after. Mirror how existing browser-ish hook tests (`*.test.tsx`) set up `act` from `preact/test-utils`.

- [ ] **Step 3: Implement `use-socket.ts`**

Create `packages/iso/src/use-socket.ts` with the hook. Author it with: a `status` state (`connecting|open|reconnecting|closing|closed`), a stable `send` (bounded queue while not open, flush on open), a `close`, `closeInfo` state, optional `lastMessage` state (only set when `opts.lastMessage`), per-message delivery via `opts.onMessage` (no re-render), reconnection with capped exponential backoff + finite `maxRetries` + a `shouldReconnect(closeEvent)` predicate defaulting to false on code `1000` and `4000-4999` and true otherwise, and cleanup (close socket, clear timers) on unmount. Build the URL:

```ts
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const url = `${proto}//${location.host}${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent(ref[FORM_MODULE_FIELD])}&${SOCKET_NAME_PARAM}=${encodeURIComponent(ref[FORM_SOCKET_FIELD])}`;
```

Guard the whole effect with `isBrowser()` (no-op on the server; `useSocket` returns `status: 'connecting'` with a no-op `send` during SSR, then connects post-hydration, matching the live-loader SSR posture). Type `send` as the ref's `Incoming` and `onMessage`/`lastMessage` as `Serialize<Outgoing>`. The only cast is `JSON.parse(ev.data) as Serialize<Outgoing>` (sanctioned wire boundary).

- [ ] **Step 4: Run the hook test, then commit**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/use-socket.test.tsx` -> PASS.

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/use-socket.ts packages/iso/src/__tests__/use-socket.test.tsx
git commit -m "feat(iso): useSocket client hook (typed duplex, reconnect, close codes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: public exports + docs

**Files:**
- Modify: `packages/iso/src/index.ts`
- Modify: `packages/iso/src/__tests__/public-exports.test.ts`
- Create: a docs page (follow `.claude/skills/add-docs-page.md`)

- [ ] **Step 1: Read the local docs skill** (`.claude/skills/add-docs-page.md`) and follow it.

- [ ] **Step 2: Add exports** to `packages/iso/src/index.ts`:

```ts
export { defineSocket } from './define-socket.js';
export type { SocketRef, SocketHandler, ServerSocket } from './define-socket.js';
export { useSocket } from './use-socket.js';
export { upgradeWebSocket } from './upgrade-websocket.js';
```

(`route.socket` is already public via the exported `serverRoute`/`RouteServer`.)

- [ ] **Step 3: Update `public-exports.test.ts`** with `expect(typeof iso.defineSocket).toBe('function')`, `useSocket`, `upgradeWebSocket`.

- [ ] **Step 4: Write the docs page** per the local skill, documenting `defineSocket`/`route.socket` (server `serverSockets` map, open/message/close, teardown), `useSocket` (status, send, onMessage, reconnect, close codes), and `upgradeWebSocket` (raw api.ts WS). Note the dividing line: a socket is for the same-connection client to server leg (vs SSE live loaders for reactive reads), Node fans out a single connection in-process, cross-connection rooms come later. No em-dashes; no migration breadcrumbs. There is an existing `websockets.mdx`, reconcile (extend it or add a focused `sockets.mdx`) per the skill and nav.

- [ ] **Step 5: Run gates, then commit**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build` then `pnpm --filter @hono-preact/iso exec vitest run src/__tests__/public-exports.test.ts` then `pnpm --filter site build` (llms must pass with the new symbols documented). Then:

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add -A
git commit -m "feat(iso): export defineSocket/useSocket/upgradeWebSocket + sockets docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: example-node dogfood + Node integration test

**Files:**
- Create: `apps/example-node/src/pages/chat.server.ts`
- Modify: `apps/example-node/src/pages/home.tsx` (mount the socket demo) and `apps/example-node/src/routes.ts` if a new route is needed
- Create: `packages/server/src/__tests__/sockets-integration.test.ts`

- [ ] **Step 1: Dogfood, a duplex echo + per-connection server tick**

Create `apps/example-node/src/pages/chat.server.ts`:

```ts
import { defineSocket } from 'hono-preact';

type Incoming = { kind: 'say'; text: string };
type Outgoing = { kind: 'echo'; text: string } | { kind: 'tick'; n: number };

export const serverSockets = {
  // Per-connection: echoes client messages and pushes a tick every second.
  // The interval is per-connection state (no cross-connection fan-out, so it
  // works in-process on Node); the teardown returned by open clears it.
  chat: defineSocket<Incoming, Outgoing, { n: number }>({
    open(socket) {
      socket.data.n = 0;
      const id = setInterval(() => {
        socket.data.n += 1;
        socket.send({ kind: 'tick', n: socket.data.n });
      }, 1000);
      return () => clearInterval(id);
    },
    message(socket, msg) {
      if (msg.kind === 'say') socket.send({ kind: 'echo', text: msg.text });
    },
  }),
};
```

- [ ] **Step 2: Consume it in the home page**

In `apps/example-node/src/pages/home.tsx`, add a `ChatDemo` component using `useSocket(serverSockets.chat, { onMessage })` from `./chat.server.js`: render `status`, the latest tick, an input + button calling `sock.send({ kind: 'say', text })`, and an echo log. Confirm `useSocket`'s returned field names against the implementation (Task 6). The home route's server module is `home.server.ts`; importing `serverSockets` from `chat.server.js` is fine (sockets are not route-bound here, bare `defineSocket`). If `routes.ts` needs the `.server` module registered for the socket registry to pick it up, add `chat.server` to the relevant route's `server` thunk OR confirm the registry collects all `.server` modules; read how `serverImports` is assembled (Task 4 Step 1) and wire accordingly.

- [ ] **Step 3: Node integration test**

Create `packages/server/src/__tests__/sockets-integration.test.ts`: boot the framework app with `@hono/node-server` + `createNodeWebSocket` (install the upgrader), register a `serverSockets` def via a synthetic registry, then open a real `ws` client to `/__sockets?m=...&s=...`, send a message, and assert the echo comes back and the connection tears down (interval cleared) on close. If a full server boot is too heavy, drive `socketsHandler` with `@hono/node-ws` against an ephemeral `@hono/node-server` instance (mirror `websocket-dev.test.ts`'s harness). This is the end-to-end proof the Node path works.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build` then `pnpm typecheck` then `pnpm exec vitest run packages/server/src/__tests__/sockets-integration.test.ts`. Optionally `pnpm --filter example-node dev`, open `/`, type a message, see the echo + ticking counter.

```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add apps/example-node/src/pages/chat.server.ts apps/example-node/src/pages/home.tsx apps/example-node/src/routes.ts packages/server/src/__tests__/sockets-integration.test.ts
git commit -m "feat(example-node): dogfood a duplex socket (echo + per-connection tick)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: pre-merge gate

- [ ] **Step 1:** `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` -> all build.
- [ ] **Step 2:** `pnpm format:check` -> PASS (else `pnpm format` + amend).
- [ ] **Step 3:** `pnpm typecheck` -> PASS.
- [ ] **Step 4:** `pnpm test:types` -> PASS (incl. `define-socket.test-d.ts`).
- [ ] **Step 5:** `pnpm test:coverage` -> PASS (the `measure-client-size` sandbox failure, if any, passes with resources allowed; confirm by re-running that one file with the sandbox disabled).
- [ ] **Step 6:** `pnpm test:integration` -> PASS.
- [ ] **Step 7:** `pnpm --filter site build` -> PASS (llms incl. the new socket exports).
- [ ] **Step 8:** `git status` clean; `git log --oneline main..HEAD` shows the task commits. Open the PR; run the deep PR review immediately (replacement parity: the removed api.ts `injectWebSocket` re-export, enumerate that the WS-in-api.ts capability survives via the new public `upgradeWebSocket`; cross-cutting: the `/__sockets` guard chain vs the loader/action chains).

---

## Self-Review

**Spec coverage (PR 3 row):** `serverSockets`/`defineSocket`/`route.socket` (Tasks 2-3); single `GET /__sockets` endpoint + registry + guard-before-upgrade + 4403 (Task 4); WS adapter seam, Node-only, framework-owned wiring + public `upgradeWebSocket` (Tasks 1, 5); `useSocket` with status/reconnect/close-codes (Task 6); discriminated-union messages + `Serialize<T>` types-only (Tasks 2, 4, 6); `open()` returns teardown (Tasks 2, 4); public surface + docs (Task 7); dogfood + integration on Node (Task 8). CF upgrader deferred to PR 5 (decided), documented in Task 5.

**Placeholder check:** the load-bearing new logic (seam, `defineSocket`, `/__sockets` handler skeleton, `useSocket` contract) has full code; the codegen/adapter/registry steps cite the exact symbol to mirror with the target shape (the established way to edit those files, since they require reading current source). Tasks 4 Step 2 and 6 Step 3 leave some helper bodies as "mirror X", flagged because they genuinely depend on current `loaders-handler`/`action.ts` internals; the implementer reads those (cited) and matches them.

**Type consistency:** `SocketRef<Incoming, Outgoing>`, `SocketHandler`, `ServerSocket`, `SocketDef`, the `FORM_MODULE_FIELD`/`FORM_SOCKET_FIELD` descriptor, `SOCKETS_RPC_PATH`/`SOCKET_MODULE_PARAM`/`SOCKET_NAME_PARAM`, `WS_DENY_CODE`, and `installWebSocketUpgrader`/`getWebSocketUpgrader` are used identically where defined (Tasks 1-2) and consumed (Tasks 3-6).

## Known risk to confirm during implementation

The `socketsHandler` (Task 4) leans on Hono's `upgradeWebSocket(createEvents)` accepting an **async** `createEvents` (so guards can run before returning the events). Confirm `@hono/node-ws`'s `upgradeWebSocket` supports an async factory (the Hono helper signature allows `WSEvents | Promise<WSEvents>`); if it does not, run guards inside `onOpen` instead (upgrade first, then deny-close 4403), which the handler already does for the denied path.
