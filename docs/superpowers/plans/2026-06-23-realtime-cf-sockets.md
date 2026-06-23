# Plain sockets on Cloudflare (#169) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make the plain duplex socket primitive (`defineSocket` / `route.socket`, consumed with `useSocket`) work end to end on a `cloudflareAdapter()` deploy by forwarding each guarded upgrade to a fresh per-connection Durable Object.

**Architecture:** the CF worker stays a guard-and-forward edge. `socketsHandler` resolves the def and runs the guard chain at the edge, then (with a connector installed) forwards a plain socket to a brand-new DO (`ns.get(ns.newUniqueId())`) via the existing `RealtimeConnector` seam, carrying edge-derived `data` as `x-hp-*` headers; the DO accepts the socket under the Hibernation API and runs `socketDef.open/message/close/error`. This mirrors the room forward path (PR5a), minus the topic/room-engine, plus a new `x-hp-kind: socket` request kind on the same DO.

**Tech Stack:** TypeScript, Hono, Preact, Cloudflare Durable Objects (Hibernation API), `@cloudflare/vite-plugin` (workerd dev), vitest.

**Spec:** `docs/superpowers/specs/2026-06-23-realtime-cf-sockets-design.md`.

## Global Constraints

- **Door isolation:** the `cloudflare:workers` value-import stays confined to `packages/server/src/cf/realtime-do.ts`. All new platform glue (`makeServerSocketHandle`, `isSocketConnection`, the `socket-forward` connector branch) goes in `packages/server/src/cf/realtime-do-glue.ts`, which uses `@cloudflare/workers-types` for TYPES only (`WebSocketPair` / `newUniqueId` are workerd globals, not imports).
- **Security:** the server controls DO dispatch. The guard chain (`app use -> route-node use -> def.use`) runs at the edge BEFORE any forward; a denied or unknown-def connection closes 4403 via the connector deny path and NEVER reaches the DO.
- **Pre-release API change:** the socket API change (`open` drops its `{ c }` argument; new `data?: (c) => Data` factory) is free but export-diff-invisible, so it MUST be recorded in the v0.8 release notes (Task 9).
- **No casts the type can avoid.** The sanctioned cast boundaries here are: reading `deserializeAttachment()` (untrusted hibernation payload) and `JSON.parse` of a wire frame. Do not add others.
- **No em-dashes** in prose, code comments, or commit messages. Use a comma, colon, semicolon, parentheses, or two sentences.
- **Commit trailer:** every commit message ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Unchanged:** the client (`useSocket`) and the `/__sockets` wire. A plain socket carries only `m` (module key) and `s` (socket name) on the query string; it has no `r` room-key param.
- **Run the gate before pushing** (CLAUDE.md, eight steps); `pnpm format:check` (step 3) is the most-missed.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/iso/src/define-socket.ts` | socket type contract: add `data?: (c) => Data`; `open(socket)` drops `{ c }` | 1 |
| `packages/iso/src/__tests__/define-socket.test-d.ts` | type-level contract for the new shape | 1 |
| `packages/server/src/sockets-handler.ts` | Node: seed `socket.data` from `data(c)`; CF: forward plain socket via connector | 1, 7 |
| `packages/iso/src/internal/realtime-connector.ts` | add `SocketForwardContext`; rename room-only union/deny types | 2 |
| `packages/iso/src/internal-runtime.ts` | re-export the renamed + new connector types | 2 |
| `packages/server/src/cf/socket-registry.ts` (new) | `installSocketRegistry` / `getSocketRegistry` install seam for the DO | 3 |
| `packages/server/src/internal-cloudflare.ts` | CF door: re-export the socket registry seam + `buildSocketRegistry` | 3 |
| `packages/server/src/cf/realtime-do-glue.ts` | `makeServerSocketHandle`, `isSocketConnection`, `SocketConnAttachment`, connector `socket-forward` branch | 4 |
| `packages/server/src/cf/realtime-do.ts` | DO: `x-hp-kind: socket` accept + socket dispatch in message/close/error | 5 |
| `packages/vite/src/adapter-cloudflare.ts` | generated entry installs the socket registry | 6 |
| `packages/vite/src/__tests__/fixtures/cf-socket/**` (new) | workerd integration fixture | 8 |
| `packages/vite/src/__tests__/cf-socket.test.ts` (new) | end-to-end CF socket round-trip + guard-at-edge | 8 |
| `apps/site/src/pages/docs/websockets.mdx` | drop the Node-only framing; document `data` / `open` / cleanup hook | 9 |
| `docs/superpowers/specs/2026-06-21-v0.8-release-notes.md` | record the socket API change | 9 |

---

### Task 1: Socket API change (`data` factory, drop `c` from `open`) + Node parity

**Files:**
- Modify: `packages/iso/src/define-socket.ts`
- Modify: `packages/iso/src/__tests__/define-socket.test-d.ts`
- Modify: `packages/server/src/sockets-handler.ts` (the plain-socket branch of `createEvents`, around lines 348-369)
- Test: `packages/server/src/__tests__/sockets-handler.test.ts`

**Interfaces:**
- Produces: `SocketHandler<Incoming, Outgoing, Data>.data?: (c: Context) => Data` and `SocketHandler.open?(socket: ServerSocket<Outgoing, Data>): void | (() => void) | Promise<void | (() => void)>` (no second argument). `route.socket` inherits both via the shared `SocketHandler` type (no edit to `server-route.ts`).
- Consumes: nothing from later tasks. The `example-node` dogfood (`apps/example-node/src/pages/chat.server.ts`) already calls `open(socket)` with no `c`, so it needs no change.

- [ ] **Step 1: Write the failing test (Node seeds `socket.data` from `data(c)`)**

In `packages/server/src/__tests__/sockets-handler.test.ts`, add to the `describe('socketsHandler: known socket - open, send, message, close teardown', ...)` block. The file already defines `makeFakeUpgrader`, `makeApp`, and the module-level `app`; reuse them.

```ts
it('runs def.data(c) at the edge and seeds socket.data (Node parity)', async () => {
  const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
  installWebSocketUpgrader(upgrader);

  const seen: string[] = [];
  const def = defineSocket<{ ping: true }, { who: string }, { who: string }>({
    data: (c) => ({ who: c.req.query('u') ?? 'anon' }),
    open(socket) {
      // open no longer receives a Context; it reads the data factory result.
      socket.send({ who: socket.data.who });
    },
    message(socket) {
      seen.push(socket.data.who);
    },
  }) as unknown as SocketDef<{ ping: true }, { who: string }, { who: string }>;

  const registry = new Map([['pages/chat::chatSocket', def]]);
  app = makeApp(registry);

  // getRequest has no query hook, so issue the request inline with `?u=alice`.
  await app.request(
    `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket&u=alice`
  );

  const events = lastEvents();
  const ws = lastWs();
  await events.onOpen?.(new Event('open'), ws as never);
  expect(ws.sends[0]).toBe(JSON.stringify({ who: 'alice' }));

  await events.onMessage?.(
    { data: JSON.stringify({ ping: true }) } as MessageEvent,
    ws as never
  );
  expect(seen).toEqual(['alice']);
});
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sockets-handler.test.ts -t "seeds socket.data"`
Expected: FAIL. Before the source change `def.data` is not run (`socket.data.who` is `undefined`), so the first `expect` mismatches; the type also rejects `data:` on the handler.

- [ ] **Step 3: Add `data` and drop `c` from `open` in `define-socket.ts`**

In `packages/iso/src/define-socket.ts`, replace the `use` / `open` portion of `SocketHandler` (lines 19-34) with:

```ts
export interface SocketHandler<Incoming, Outgoing, Data> {
  /** Guard/middleware chain run before the upgrade; a deny closes 4403. */
  use?: ReadonlyArray<Middleware>;
  /**
   * Edge factory run once at the upgrade with the live Hono Context; its
   * result seeds `socket.data`. This is the ONLY place a socket handler sees a
   * Context: on Cloudflare the connection runs inside a Durable Object with no
   * live Context, so read cookies, headers, query, and middleware-set values
   * here and stash them on `socket.data`. Runs on both Node and Cloudflare.
   */
  data?: (c: Context) => Data;
  /**
   * Per-connection setup. Receives only the socket (its `data` is the `data`
   * factory result). May return a teardown fn.
   *
   * On Cloudflare the connection is hibernatable, so a returned teardown
   * cannot survive a hibernation cycle; it is a Node-only convenience. Use
   * `close` for cleanup that must run on both runtimes.
   */
  open?(
    socket: ServerSocket<Outgoing, Data>
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
```

- [ ] **Step 4: Seed `socket.data` and drop `{ c }` in `sockets-handler.ts`**

In `packages/server/src/sockets-handler.ts`, in the plain-socket branch of `createEvents` (the block beginning `// --- Plain duplex socket wiring`), replace `const data: Record<string, unknown> = {};` with the edge-factory seed, and drop the `{ c: ctx }` argument from the `open` call:

```ts
// --- Plain duplex socket wiring. ---
let teardown: (() => void) | void;
// Seed socket.data from the edge `data` factory (run with the live Context),
// so Node and Cloudflare seed socket.data identically. The bag stays mutable
// for the handler to write to across open/message/close.
const data = (await socketDef!.data?.(ctx)) ?? {};
const makeSocket = (ws: {
  send(d: string): void;
  close(c?: number, r?: string): void;
}) => ({
  send: (msg: unknown) => ws.send(JSON.stringify(msg)),
  close: (code?: number, reason?: string) => ws.close(code, reason),
  data,
  raw: ws,
});

return {
  async onOpen(_e, ws) {
    if (denied) {
      ws.close(WS_DENY_CODE, 'forbidden');
      return;
    }
    const result = await socketDef!.open?.(makeSocket(ws));
    teardown = typeof result === 'function' ? result : undefined;
  },
  // onMessage / onClose / onError below are unchanged.
```

(Leave `onMessage`, `onClose`, `onError` as they are.)

- [ ] **Step 5: Run the new test + the full server socket suite; confirm green**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sockets-handler.test.ts src/__tests__/sockets-integration.test.ts`
Expected: PASS. The existing socket tests use `open(socket)` / `open()` / `open: openSpy` and none read a second argument, so they stay green.

- [ ] **Step 6: Migrate the type-level contract in `define-socket.test-d.ts`**

In `packages/iso/src/__tests__/define-socket.test-d.ts`:

Add `SocketHandler` to the import on line 3:

```ts
import {
  defineSocket,
  type SocketRef,
  type SocketHandler,
} from '../define-socket.js';
```

Replace `_routeSocketProbe` (lines 28-40) with a probe for the new shape:

```ts
// route.socket's `data` factory receives the Hono Context; `open` receives
// ONLY the socket (no Context), so a socket handler is portable to Cloudflare
// where it runs inside a Durable Object with no live Context.
function _routeSocketProbe() {
  const route = serverRoute('/movies/:id');
  const ref = route.socket<In, Out, { joinedAt: number }>({
    data(c) {
      // c is the Hono Context for the upgrade request.
      expectTypeOf(c).not.toBeNever();
      return { joinedAt: 1 };
    },
    open(socket) {
      // open's only argument is the socket; its data is the factory result.
      expectTypeOf(socket.data).toEqualTypeOf<{ joinedAt: number }>();
    },
  });
  expectTypeOf(ref).toEqualTypeOf<SocketRef<In, Out>>();
}

// `open` takes only the socket now: a two-argument open does not type-check.
function _openArityProbe() {
  // @ts-expect-error open no longer receives a Context as a second argument
  const _bad: SocketHandler<In, Out, undefined> = { open: (_socket, _c) => {} };
  void _bad;
}
```

Add `void _openArityProbe;` next to the other `void _probe;` lines at the bottom of the file.

- [ ] **Step 7: Run the type-level suite; confirm green**

Run: `pnpm exec vitest run --typecheck.only packages/iso/src/__tests__/define-socket.test-d.ts`
Expected: PASS. The `@ts-expect-error` on the two-arg `open` is satisfied (TS rejects a 2-param function where a 1-param one is expected: "Target signature provides too few arguments").

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/define-socket.ts packages/iso/src/__tests__/define-socket.test-d.ts packages/server/src/sockets-handler.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "$(cat <<'EOF'
feat(realtime): socket data() edge factory; open() drops live Context

A socket handler's open() no longer receives the Hono Context; a new
data?: (c) => Data factory runs at the upgrade and seeds socket.data on
both Node and Cloudflare. This mirrors the room API and makes a socket
handler portable to a Durable Object, which has no live Context.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Connector seam: `SocketForwardContext` + room-type renames

**Files:**
- Modify: `packages/iso/src/internal/realtime-connector.ts`
- Modify: `packages/iso/src/internal-runtime.ts` (the connector-type re-export block, lines 43-49)
- Modify: `packages/server/src/__tests__/sockets-handler.test.ts` (the `RoomConnectContext` import + the two usages in `makeFakeConnector`)

**Interfaces:**
- Produces: `SocketForwardContext { kind: 'socket-forward'; c: Context; moduleKey: string; name: string; data: unknown }`; the union `RealtimeConnectContext = RoomForwardContext | SocketForwardContext | DenyContext`; renamed `DenyContext` (was `RoomDenyContext`). `RoomForwardContext` keeps its name. `RealtimeConnector` keeps its name; its parameter is now `RealtimeConnectContext`.
- Consumes: nothing. (`realtime-do.test.ts` imports `RoomForwardContext`, which is unchanged.)

- [ ] **Step 1: Write the failing test (the connector accepts a socket-forward context)**

In `packages/server/src/__tests__/sockets-handler.test.ts`, inside `describe('socketsHandler: realtime connector forwarding', ...)`, add a type-and-runtime probe asserting the new variant flows through a connector:

```ts
it('the connector context union includes a socket-forward variant', () => {
  const { connector, calls } = makeFakeConnector();
  // A socket-forward context is assignable to the connector parameter (the new
  // union member) and is recorded with its discriminant + fields. The fake
  // connector never reads `c`, so a sanctioned single test cast stands in for
  // the live Context the real edge path supplies in Task 7.
  void connector({
    c: undefined as never,
    kind: 'socket-forward',
    moduleKey: 'pages/chat',
    name: 'chatSocket',
    data: { who: 'alice' },
  });
  const recorded = calls();
  expect(recorded[0]?.kind).toBe('socket-forward');
});
```

This test fails to type-check until Task 2's source change, because `kind: 'socket-forward'` is not assignable to the old room-only union; that is the intended failing state.

- [ ] **Step 2: Run it; confirm it fails to type-check**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sockets-handler.test.ts -t "socket-forward variant"`
Expected: FAIL. `kind: 'socket-forward'` is not assignable to `RoomConnectContext` yet, and `recorded[0].kind` cannot be `'socket-forward'`.

- [ ] **Step 3: Add `SocketForwardContext` and rename in `realtime-connector.ts`**

In `packages/iso/src/internal/realtime-connector.ts`, after `RoomForwardContext` (line 43) add the socket variant, rename `RoomDenyContext` -> `DenyContext`, and rename the union:

```ts
/**
 * An allowed plain duplex socket to forward. A plain socket has no topic
 * identity (no fan-out), so the connector mints a fresh per-connection Durable
 * Object. `data` is the already-run `socketDef.data?.(c)` result (run at the
 * edge with the live Context, since the socket callbacks run inside the DO with
 * no live Context).
 */
export interface SocketForwardContext extends RoomConnectBase {
  kind: 'socket-forward';
  moduleKey: string;
  name: string;
  data: unknown; // result of socketDef.data?.(c), already run at the edge
}

/**
 * A denied or key-failed connection (room or socket). The connector performs a
 * transport-native deny close (WS_DENY_CODE) without contacting the runtime, so
 * a denied connection never reaches a Durable Object.
 */
export interface DenyContext extends RoomConnectBase {
  kind: 'deny';
}

/**
 * The resolved context handed to a realtime connector. The `kind` discriminant
 * selects forward-to-room-DO, forward-to-socket-DO, or transport-native deny.
 */
export type RealtimeConnectContext =
  | RoomForwardContext
  | SocketForwardContext
  | DenyContext;
```

Delete the old `RoomDenyContext` interface and the old `RoomConnectContext` type alias. Update `RealtimeConnector` to use the renamed union:

```ts
export type RealtimeConnector = (
  ctx: RealtimeConnectContext
) => Response | Promise<Response>;
```

- [ ] **Step 4: Update the iso runtime re-export**

In `packages/iso/src/internal-runtime.ts`, replace the connector-type export block (lines 43-49) with:

```ts
export type {
  RealtimeConnector,
  RealtimeConnectContext,
  RoomForwardContext,
  SocketForwardContext,
  DenyContext,
} from './internal/realtime-connector.js';
```

- [ ] **Step 5: Update the handler test's import + fake connector**

In `packages/server/src/__tests__/sockets-handler.test.ts`:
- In the `import type { ... } from '@hono-preact/iso/internal/runtime'` block (the one containing `WebSocketUpgrader`, `RealtimeConnector`, `RoomConnectContext`), replace `RoomConnectContext` with `RealtimeConnectContext`.
- In `makeFakeConnector`, change `calls: () => RoomConnectContext[]` and `const calls: RoomConnectContext[] = []` to `RealtimeConnectContext[]`.

- [ ] **Step 6: Run the handler suite + iso type suite; confirm green**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sockets-handler.test.ts && pnpm exec vitest run --typecheck.only packages/iso/src/__tests__/define-socket.test-d.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/internal/realtime-connector.ts packages/iso/src/internal-runtime.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "$(cat <<'EOF'
feat(realtime): add SocketForwardContext to the connector seam

The realtime connector now handles a plain socket forward (no topic, a
fresh per-connection DO) alongside room forward and deny. Renames the
room-only RoomConnectContext/RoomDenyContext to RealtimeConnectContext/
DenyContext (internal, pre-release).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: CF socket registry seam

**Files:**
- Create: `packages/server/src/cf/socket-registry.ts`
- Create: `packages/server/src/cf/__tests__/socket-registry.test.ts`
- Modify: `packages/server/src/internal-cloudflare.ts`

**Interfaces:**
- Produces: `installSocketRegistry(getter)`, `getSocketRegistry(): SocketRegistryGetter | undefined`, `__resetSocketRegistryForTesting()`, where `SocketRegistryGetter = () => Promise<Map<string, AnySocketDef>> | Map<string, AnySocketDef>` and `AnySocketDef = SocketDef<unknown, unknown, unknown>`. Re-exported through the CF door alongside `buildSocketRegistry` (which already lives in `sockets-handler.ts`).
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/cf/__tests__/socket-registry.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import type { SocketDef } from '@hono-preact/iso/internal';
import {
  installSocketRegistry,
  getSocketRegistry,
  __resetSocketRegistryForTesting,
} from '../socket-registry.js';

type AnySocketDef = SocketDef<unknown, unknown, unknown>;

afterEach(() => __resetSocketRegistryForTesting());

describe('socket registry seam', () => {
  it('returns undefined when nothing is installed', () => {
    expect(getSocketRegistry()).toBeUndefined();
  });

  it('returns the installed getter', async () => {
    const map = new Map<string, AnySocketDef>([
      ['m::s', {} as AnySocketDef],
    ]);
    installSocketRegistry(() => map);
    const getter = getSocketRegistry();
    expect(getter).toBeDefined();
    expect(await getter!()).toBe(map);
  });

  it('reset clears the installed getter', () => {
    installSocketRegistry(() => new Map());
    __resetSocketRegistryForTesting();
    expect(getSocketRegistry()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `pnpm --filter @hono-preact/server exec vitest run src/cf/__tests__/socket-registry.test.ts`
Expected: FAIL (module `../socket-registry.js` does not exist).

- [ ] **Step 3: Create `socket-registry.ts`**

Create `packages/server/src/cf/socket-registry.ts` (mirror `room-registry.ts`):

```ts
import type { SocketDef } from '@hono-preact/iso/internal';

type AnySocketDef = SocketDef<unknown, unknown, unknown>;

/** A resolver that produces (or has already produced) the socket registry map. */
type SocketRegistryGetter = () =>
  | Promise<Map<string, AnySocketDef>>
  | Map<string, AnySocketDef>;

// The socket-registry install seam for the Cloudflare Durable Object runtime.
//
// On Node a plain socket runs in the worker, where the route server modules are
// already loaded, so the registry is built inline (sockets-handler's
// buildSocketRegistry). On Cloudflare a plain socket runs INSIDE a Durable
// Object, which never sees the worker's request-time wiring. The generated CF
// worker entry installs the getter at module top level:
//
//   installSocketRegistry(() => buildSocketRegistry(serverImports));
//
// The DO's getSocketDef resolves the installed getter (once, then caches the
// Map) and looks up `${moduleKey}::${name}`. Mirrors installRoomRegistry.

let current: SocketRegistryGetter | undefined;

/**
 * Install the socket-registry getter the Durable Object resolves. Called once
 * at module top level by the generated Cloudflare worker entry.
 */
export function installSocketRegistry(getter: SocketRegistryGetter): void {
  current = getter;
}

/**
 * The installed socket-registry getter, or `undefined` if none was installed
 * (on Cloudflare that is a misconfiguration). The DO calls this and caches the
 * resolved Map.
 */
export function getSocketRegistry(): SocketRegistryGetter | undefined {
  return current;
}

/** Test-only reset. */
export function __resetSocketRegistryForTesting(): void {
  current = undefined;
}
```

- [ ] **Step 4: Re-export through the CF door**

In `packages/server/src/internal-cloudflare.ts`, after the `room-registry.js` export block add:

```ts
export {
  installSocketRegistry,
  getSocketRegistry,
  __resetSocketRegistryForTesting,
} from './cf/socket-registry.js';
export { buildSocketRegistry } from './sockets-handler.js';
```

- [ ] **Step 5: Run the test; confirm green**

Run: `pnpm --filter @hono-preact/server exec vitest run src/cf/__tests__/socket-registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/cf/socket-registry.ts packages/server/src/cf/__tests__/socket-registry.test.ts packages/server/src/internal-cloudflare.ts
git commit -m "$(cat <<'EOF'
feat(realtime): socket registry install seam for the Durable Object

installSocketRegistry/getSocketRegistry mirror the room registry seam so
the per-connection socket DO can resolve a socket def by moduleKey::name.
Re-exported through the Cloudflare server door with buildSocketRegistry.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: CF glue: socket handle, predicate, and the `socket-forward` connector branch

**Files:**
- Modify: `packages/server/src/cf/realtime-do-glue.ts`
- Modify: `packages/server/src/cf/__tests__/realtime-do.test.ts` (add glue unit tests; the file already imports from `../realtime-do-glue.js`)

**Interfaces:**
- Produces:
  - `SocketConnAttachment { kind: 'socket'; moduleKey: string; name: string; data: unknown }`
  - `isSocketConnection(attachment: unknown): boolean`
  - `makeServerSocketHandle(ws, data): { send(msg): void; close(code?, reason?): void; data: unknown; raw: unknown }` where `ws` has `send(d: string)` + `close(code?, reason?)`
  - `makeCfForwardConnector` now also handles `ctx.kind === 'socket-forward'`.
- Consumes: `SocketForwardContext` + `RealtimeConnector` from `@hono-preact/iso/internal/runtime` (Task 2).

- [ ] **Step 1: Write failing unit tests**

In `packages/server/src/cf/__tests__/realtime-do.test.ts`, add a new describe block. Extend the existing `../realtime-do-glue.js` import to also pull `isSocketConnection` and `makeServerSocketHandle`, and use this self-contained fake namespace (do not depend on any existing helper in the file):

```ts
import {
  makeCfForwardConnector,
  isSocketConnection,
  makeServerSocketHandle,
} from '../realtime-do-glue.js';

describe('makeServerSocketHandle', () => {
  it('JSON-stringifies sends, forwards close, exposes data + raw', () => {
    const sends: string[] = [];
    const closes: Array<{ c?: number; r?: string }> = [];
    const ws = {
      send: (d: string) => sends.push(d),
      close: (c?: number, r?: string) => closes.push({ c, r }),
    };
    const socket = makeServerSocketHandle(ws, { who: 'alice' });
    socket.send({ hello: 1 });
    socket.close(4000, 'bye');
    expect(sends).toEqual([JSON.stringify({ hello: 1 })]);
    expect(closes).toEqual([{ c: 4000, r: 'bye' }]);
    expect(socket.data).toEqual({ who: 'alice' });
    expect(socket.raw).toBe(ws);
  });
});

describe('isSocketConnection', () => {
  it('is true only for a {kind:"socket"} attachment', () => {
    expect(isSocketConnection({ kind: 'socket', moduleKey: 'm', name: 's', data: null })).toBe(true);
    expect(isSocketConnection({ kind: 'topic' })).toBe(false);
    expect(isSocketConnection({ connId: 'x' })).toBe(false); // room attachment
    expect(isSocketConnection(null)).toBe(false);
  });
});

describe('makeCfForwardConnector: socket-forward', () => {
  function fakeNamespace() {
    const calls: { idArg: unknown; fetched: Request[] }[] = [];
    let uniqueCount = 0;
    const ns = {
      newUniqueId: () => ({ __unique: ++uniqueCount }) as unknown,
      idFromName: (n: string) => ({ __named: n }) as unknown,
      get: (id: unknown) => {
        const rec = { idArg: id, fetched: [] as Request[] };
        calls.push(rec);
        return {
          fetch: (req: Request) => {
            rec.fetched.push(req);
            return Promise.resolve(new Response('forwarded'));
          },
        };
      },
    };
    return { ns: ns as never, calls };
  }

  it('mints a fresh DO (newUniqueId) and stamps x-hp-kind: socket + headers', async () => {
    const { ns, calls } = fakeNamespace();
    const connector = makeCfForwardConnector(() => ns);
    const c = {
      req: { raw: new Request('https://x/__sockets?m=pages/chat&s=echo') },
    } as never;
    const res = await connector({
      c,
      kind: 'socket-forward',
      moduleKey: 'pages/chat',
      name: 'echo',
      data: { who: 'alice' },
    });
    expect(await res.text()).toBe('forwarded');
    expect(calls).toHaveLength(1);
    expect((calls[0]!.idArg as { __unique?: number }).__unique).toBe(1); // newUniqueId, not idFromName
    const fwd = calls[0]!.fetched[0]!;
    expect(fwd.headers.get('x-hp-kind')).toBe('socket');
    expect(fwd.headers.get('x-hp-module')).toBe('pages/chat');
    expect(fwd.headers.get('x-hp-name')).toBe('echo');
    expect(fwd.headers.get('x-hp-data')).toBe(JSON.stringify({ who: 'alice' }));
  });

  it('rejects an over-budget data bag', async () => {
    const { ns } = fakeNamespace();
    const connector = makeCfForwardConnector(() => ns);
    const c = { req: { raw: new Request('https://x/__sockets') } } as never;
    await expect(
      connector({
        c,
        kind: 'socket-forward',
        moduleKey: 'm',
        name: 's',
        data: { big: 'x'.repeat(7 * 1024) },
      })
    ).rejects.toThrow(/forward limit/);
  });
});
```

- [ ] **Step 2: Run; confirm it fails**

Run: `pnpm --filter @hono-preact/server exec vitest run src/cf/__tests__/realtime-do.test.ts -t "socket"`
Expected: FAIL (`isSocketConnection` / `makeServerSocketHandle` not exported; connector throws on the unknown `socket-forward` kind).

- [ ] **Step 3: Add the glue helpers + connector branch**

In `packages/server/src/cf/realtime-do-glue.ts`:

Add to the iso import (it already imports `WS_DENY_CODE, type RealtimeConnector`): `type SocketForwardContext` is not needed by name; the connector parameter is typed by `RealtimeConnector`. Add the attachment type, predicate, and handle near `isTopicSubscriber`:

```ts
/**
 * The per-connection attachment for a plain duplex socket on Cloudflare. Unlike
 * a room (RoomConnAttachment) it has no presence/params; unlike a topic
 * subscriber ({ kind: 'topic' }) it runs the socket handler. Carried via
 * serializeAttachment so the message/close/error handlers rebuild context
 * across hibernation cycles.
 */
export interface SocketConnAttachment {
  kind: 'socket';
  moduleKey: string;
  name: string;
  data: unknown;
}

/** True when a hibernation socket's attachment marks it as a plain duplex socket. */
export function isSocketConnection(attachment: unknown): boolean {
  return (
    typeof attachment === 'object' &&
    attachment !== null &&
    (attachment as { kind?: unknown }).kind === 'socket'
  );
}

/**
 * Build the ServerSocket handle the socket handlers receive, over a single
 * runtime socket (the DO hibernation WebSocket). `send` JSON-encodes; `data` is
 * the edge-captured bag read off the attachment. Platform-free so it is unit
 * testable without workerd.
 */
export function makeServerSocketHandle(
  ws: { send(d: string): void; close(code?: number, reason?: string): void },
  data: unknown
): {
  send(msg: unknown): void;
  close(code?: number, reason?: string): void;
  data: unknown;
  raw: unknown;
} {
  return {
    send: (msg: unknown) => ws.send(JSON.stringify(msg)),
    close: (code?: number, reason?: string) => ws.close(code, reason),
    data,
    raw: ws,
  };
}
```

In `makeCfForwardConnector`, immediately after the `if (ctx.kind === 'deny') { ... }` block and before the room-forward destructure, add the socket-forward branch:

```ts
if (ctx.kind === 'socket-forward') {
  const { c, moduleKey, name, data } = ctx;
  const ns = getNamespace(c);
  if (!ns) {
    throw new Error(
      `hono-preact: sockets on Cloudflare require the ${bindingName} ` +
        'Durable Object binding. Add it to wrangler.jsonc (see the WebSockets docs).'
    );
  }
  const dataJson = JSON.stringify(data ?? null);
  if (byteLength(dataJson) > MAX_FORWARD_HEADER_BYTES) {
    throw new Error(
      'hono-preact: socket connection data exceeds the ' +
        `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. Keep the socket data ` +
        'factory result small (it rides a request header to the Durable Object).'
    );
  }
  // A plain socket has no topic identity; mint a fresh DO per connection.
  const stub = ns.get(ns.newUniqueId());
  const fwd = new Request(c.req.raw, {
    headers: new Headers(c.req.raw.headers),
  });
  fwd.headers.set('x-hp-kind', 'socket');
  fwd.headers.set('x-hp-module', moduleKey);
  fwd.headers.set('x-hp-name', name);
  fwd.headers.set('x-hp-data', dataJson);
  return stub.fetch(fwd);
}
```

(The existing room-forward destructure `const { c, topic, moduleKey, name, params, data } = ctx;` that follows now sees `ctx` narrowed to `RoomForwardContext`, since both the `deny` and `socket-forward` branches return. No other change to the room path.)

- [ ] **Step 4: Run the glue tests + the whole cf test file; confirm green**

Run: `pnpm --filter @hono-preact/server exec vitest run src/cf/__tests__/realtime-do.test.ts`
Expected: PASS (the existing room-forward/fan-out tests stay green; the new socket tests pass).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cf/realtime-do-glue.ts packages/server/src/cf/__tests__/realtime-do.test.ts
git commit -m "$(cat <<'EOF'
feat(realtime): CF glue for plain sockets (handle, predicate, forward)

makeServerSocketHandle + isSocketConnection (platform-free, unit-tested)
and a socket-forward branch in makeCfForwardConnector that mints a fresh
per-connection DO (newUniqueId) and stamps x-hp-kind: socket. Door
isolation preserved: workers-types only, no cloudflare:workers import.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: DO socket handling (`x-hp-kind: socket` accept + dispatch)

**Files:**
- Modify: `packages/server/src/cf/realtime-do.ts`

**Interfaces:**
- Consumes: `getSocketRegistry` (Task 3); `isSocketConnection`, `makeServerSocketHandle`, `SocketConnAttachment` (Task 4); `SocketDef` from `@hono-preact/iso/internal`.
- Produces: the DO accepts a `x-hp-kind: socket` upgrade into a hibernatable socket and runs `socketDef.open/message/close/error`. Verified end to end by Task 8 (the DO class imports `cloudflare:workers` and is not unit-testable in plain vitest; its pure helpers are unit-tested in Task 4).

- [ ] **Step 1: Add the socket import surface**

In `packages/server/src/cf/realtime-do.ts`:
- Extend the `@hono-preact/iso/internal` type import to add `SocketDef`:
  ```ts
  import type { RoomDef, SocketDef } from '@hono-preact/iso/internal';
  ```
- Extend the `./realtime-do-glue.js` import to add the socket helpers:
  ```ts
  import {
    makeCfRoomTransport,
    makeDOConnState,
    parseHeaderJson,
    isTopicSubscriber,
    isSocketConnection,
    makeServerSocketHandle,
    fanOutToTopicSubscribers,
  } from './realtime-do-glue.js';
  import type { DOConnState, SocketConnAttachment } from './realtime-do-glue.js';
  ```
- Add the socket registry getter import next to the existing `getRoomRegistry` import (both modules sit in the same `cf/` directory as `realtime-do.ts`):
  ```ts
  import { getRoomRegistry } from './room-registry.js';
  import { getSocketRegistry } from './socket-registry.js';
  ```
- Add the type alias near `type AnyRoomDef`:
  ```ts
  type AnySocketDef = SocketDef<unknown, unknown, unknown>;
  ```

- [ ] **Step 2: Add `getSocketDef` + a cached registry field**

Add a private field and resolver to the class (mirror `getDef` / `#registry`):

```ts
/** Cached `${moduleKey}::${name}` -> SocketDef map (resolved on first use). */
#socketRegistry: Map<string, AnySocketDef> | undefined;

/** Resolve a socket def by module key + socket name from the installed registry. */
async getSocketDef(moduleKey: string, name: string): Promise<AnySocketDef> {
  if (!this.#socketRegistry) {
    const getter = getSocketRegistry();
    if (!getter) {
      throw new Error(
        'hono-preact: no socket registry installed in the Durable Object. The ' +
          'generated Cloudflare worker entry must call installSocketRegistry() ' +
          'at module top level.'
      );
    }
    this.#socketRegistry = await getter();
  }
  const def = this.#socketRegistry.get(`${moduleKey}::${name}`);
  if (!def) {
    throw new Error(
      `hono-preact: no socket registered for "${moduleKey}::${name}".`
    );
  }
  return def;
}
```

- [ ] **Step 3: Add the `kind === 'socket'` accept branch in `fetch`**

In `fetch()`, after the `if (kind === 'topic') { ... }` block and before the `// kind === 'room'` section, insert:

```ts
// A plain duplex socket (issue #169). Accept it for hibernation (NOT tagged
// 'topic', so publish never selects it), seed a socket attachment, and run the
// socket handler's open(). The connection runs in this fresh per-connection DO
// (ns.newUniqueId at the edge); there is no fan-out and no room engine.
if (kind === 'socket') {
  const moduleKey = request.headers.get('x-hp-module') ?? '';
  const name = request.headers.get('x-hp-name') ?? '';
  const data = parseHeaderJson(request.headers.get('x-hp-data'));
  const def = await this.getSocketDef(moduleKey, name);

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  this.ctx.acceptWebSocket(server);
  const attachment: SocketConnAttachment = {
    kind: 'socket',
    moduleKey,
    name,
    data,
  };
  server.serializeAttachment(attachment);

  // open's teardown return cannot survive a hibernation cycle, so it is not
  // captured here; `close` is the portable cleanup hook (see define-socket).
  await def.open?.(makeServerSocketHandle(server, data));
  return new Response(null, { status: 101, webSocket: client });
}
```

- [ ] **Step 4: Add the socket dispatch in the three hibernation handlers**

In each of `webSocketMessage`, `webSocketClose`, `webSocketError`, add the socket branch right after the existing `isTopicSubscriber` skip and before the room path. Widen `webSocketClose` to capture the close code/reason (the room path ignores them, so this is safe).

`webSocketMessage` (after `if (isTopicSubscriber(...)) return;`):

```ts
const attachment = ws.deserializeAttachment();
if (isSocketConnection(attachment)) {
  // Sanctioned cast: we wrote this attachment in fetch(); read it back at the
  // untrusted-shaped hibernation boundary.
  const att = attachment as SocketConnAttachment;
  const def = await this.getSocketDef(att.moduleKey, att.name);
  const raw =
    typeof message === 'string' ? message : new TextDecoder().decode(message);
  // Sanctioned untrusted-wire JSON.parse of the client frame.
  await def.message?.(makeServerSocketHandle(ws, att.data), JSON.parse(raw));
  return;
}
```

`webSocketClose` (change the signature to `async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void>` and add, after the topic skip):

```ts
const attachment = ws.deserializeAttachment();
if (isSocketConnection(attachment)) {
  const att = attachment as SocketConnAttachment;
  const def = await this.getSocketDef(att.moduleKey, att.name);
  def.close?.(makeServerSocketHandle(ws, att.data), { code, reason });
  return;
}
```

`webSocketError` (after the topic skip):

```ts
const attachment = ws.deserializeAttachment();
if (isSocketConnection(attachment)) {
  const att = attachment as SocketConnAttachment;
  const def = await this.getSocketDef(att.moduleKey, att.name);
  def.error?.(makeServerSocketHandle(ws, att.data), err);
  return;
}
```

(In each handler the existing room code that follows already reads `ws.deserializeAttachment()` into its own `att`; leave that as is. Reuse the `attachment` local you just read if the existing room code re-reads it, to avoid a double `deserializeAttachment` call, but a second read is harmless if you prefer the smaller diff.)

- [ ] **Step 5: Build + typecheck (the DO is workerd-only, proven end to end in Task 8)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: PASS. The full runtime proof is Task 8's workerd integration test.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/cf/realtime-do.ts
git commit -m "$(cat <<'EOF'
feat(realtime): run plain sockets in the per-connection Durable Object

The DO gains an x-hp-kind: socket accept (hibernatable, untagged) that
seeds a socket attachment and runs open(), plus a socket dispatch in
webSocketMessage/Close/Error resolving the def from the socket registry.
Room and topic paths are byte-unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: CF adapter emits the socket registry install

**Files:**
- Modify: `packages/vite/src/adapter-cloudflare.ts`
- Modify: `packages/vite/src/__tests__/adapter-cloudflare.test.ts`

**Interfaces:**
- Consumes: `installSocketRegistry` + `buildSocketRegistry` from the CF door (Task 3).
- Produces: the generated worker entry installs the socket registry at module top level.

- [ ] **Step 1: Write the failing test**

In `packages/vite/src/__tests__/adapter-cloudflare.test.ts`, add:

```ts
it('wrapEntry installs the socket registry from the core module serverImports', () => {
  const tail = cloudflareAdapter().wrapEntry(ctx);
  expect(tail).toContain('buildSocketRegistry');
  expect(tail).toContain(
    'installSocketRegistry(() => buildSocketRegistry(__hpServerImports));'
  );
});
```

- [ ] **Step 2: Run it; confirm it fails**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/adapter-cloudflare.test.ts -t "socket registry"`
Expected: FAIL (the emit does not yet mention `installSocketRegistry`).

- [ ] **Step 3: Add the import + install to the emitted entry**

In `packages/vite/src/adapter-cloudflare.ts`, in `wrapEntry`, add `installSocketRegistry` and `buildSocketRegistry` to the `from 'hono-preact/server/internal/cloudflare'` import block (next to `installRoomRegistry` / `buildRoomRegistry`):

```ts
        `  installRoomRegistry,\n` +
        `  buildRoomRegistry,\n` +
        `  installSocketRegistry,\n` +
        `  buildSocketRegistry,\n` +
```

And add the install line right after the existing `installRoomRegistry(...)` line:

```ts
        `installRoomRegistry(() => buildRoomRegistry(__hpServerImports));\n` +
        `installSocketRegistry(() => buildSocketRegistry(__hpServerImports));\n` +
```

- [ ] **Step 4: Run the adapter suite; confirm green**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/adapter-cloudflare.test.ts`
Expected: PASS (the new test plus all existing emit assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/adapter-cloudflare.ts packages/vite/src/__tests__/adapter-cloudflare.test.ts
git commit -m "$(cat <<'EOF'
feat(realtime): generated CF entry installs the socket registry

The worker entry now installs installSocketRegistry(() =>
buildSocketRegistry(serverImports)) at module top level so the
per-connection socket DO can resolve socket defs cross-isolate, the same
way it installs the room registry.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `socketsHandler` forwards a plain socket on the CF path

**Files:**
- Modify: `packages/server/src/sockets-handler.ts` (the CF dispatch tail, lines 444-452)
- Modify: `packages/server/src/__tests__/sockets-handler.test.ts` (add to `describe('socketsHandler: realtime connector forwarding', ...)`)

**Interfaces:**
- Consumes: the connector `socket-forward` / `deny` kinds (Tasks 2, 4); `socketDef.data` (Task 1).
- Produces: on a forwarding adapter, a plain socket forwards via `connector({ kind: 'socket-forward', ... })`; a denied or unknown-def connection closes via `connector({ kind: 'deny' })`. `getWebSocketUpgrader()` is no longer reached on the CF path.

- [ ] **Step 1: Write the failing tests**

In `packages/server/src/__tests__/sockets-handler.test.ts`, inside the connector-forwarding describe block (which already defines `makeFakeConnector`), add:

```ts
it('forwards a plain socket through the connector as socket-forward (CF path)', async () => {
  const { connector, calls } = makeFakeConnector();
  installRealtimeConnector(connector);

  const def = defineSocket<{ text: string }, { reply: string }, { who: string }>(
    { data: (c) => ({ who: c.req.query('u') ?? 'anon' }) }
  ) as unknown as SocketDef<{ text: string }, { reply: string }, { who: string }>;
  const registry = new Map([['pages/chat::chatSocket', def]]);
  app = makeApp(registry);

  const res = await app.request(
    `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket&u=alice`
  );
  // The handler returns the connector's Response identity (the sentinel).
  expect(await res.text()).toBe('forwarded-to-DO');

  const recorded = calls();
  expect(recorded).toHaveLength(1);
  const fwd = recorded[0]!;
  expect(fwd.kind).toBe('socket-forward');
  if (fwd.kind === 'socket-forward') {
    expect(fwd.moduleKey).toBe('pages/chat');
    expect(fwd.name).toBe('chatSocket');
    expect(fwd.data).toEqual({ who: 'alice' });
  }
});

it('a denied plain socket closes via the connector deny, never the upgrader (CF path)', async () => {
  const { connector, calls } = makeFakeConnector();
  installRealtimeConnector(connector);
  // No upgrader is installed: a fall-through to getWebSocketUpgrader() would
  // throw. A clean deny via the connector proves the CF path never touches it.
  const def = defineSocket<never, never>({
    use: [
      defineServerMiddleware(async () => {
        const { deny } = await import('@hono-preact/iso');
        throw deny('forbidden', 403);
      }),
    ],
  }) as unknown as SocketDef<never, never, undefined>;
  const registry = new Map([['pages/chat::chatSocket', def]]);
  app = makeApp(registry);

  await app.request(
    `http://localhost${SOCKETS_RPC_PATH}?m=pages/chat&s=chatSocket`
  );
  const recorded = calls();
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.kind).toBe('deny');
});

it('an unknown def on the CF path denies via the connector (no upgrader)', async () => {
  const { connector, calls } = makeFakeConnector();
  installRealtimeConnector(connector);
  app = makeApp(new Map()); // empty registry: unknown def
  await app.request(
    `http://localhost${SOCKETS_RPC_PATH}?m=missing/module&s=nope`
  );
  const recorded = calls();
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.kind).toBe('deny');
});
```

- [ ] **Step 2: Run; confirm they fail**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sockets-handler.test.ts -t "CF path"`
Expected: FAIL. Today a plain socket on the connector path falls to `getWebSocketUpgrader()` (throws, no upgrader installed); the connector is never called for sockets.

- [ ] **Step 3: Replace the CF dispatch tail in `sockets-handler.ts`**

In `packages/server/src/sockets-handler.ts`, the `socketsHandler` CF branch currently destructures `const { roomDef, roomKey, denied, moduleKey, name } = resolved;` and ends (lines 444-452) with the unknown/plain-socket fall-through that calls `getWebSocketUpgrader()`. Add `socketDef` to the destructure and replace that trailing fall-through:

```ts
    const resolved = await resolveConnection(c, opts);
    const { socketDef, roomDef, roomKey, denied, moduleKey, name } = resolved;

    if (roomDef) {
      // KEEP the existing room forward / deny block exactly as it is today
      // (the connector deny + roomDef.data(c) + connector forward). Only the
      // destructure above gains `socketDef`, and the tail below is replaced.
    }

    // Not a room. A connector is installed (CF), so a plain socket forwards to
    // a fresh per-connection Durable Object; the guard already ran at the edge.
    // A denied connection OR an unknown def (no socket, no room) closes 4403 via
    // the connector's transport-native deny, with no DO contact. The in-worker
    // getWebSocketUpgrader() is therefore never reached on a forwarding adapter.
    if (denied || !socketDef) {
      return connector({ c, kind: 'deny' });
    }
    const data = (await socketDef.data?.(c)) ?? {};
    return connector({
      c,
      kind: 'socket-forward',
      moduleKey: moduleKey ?? '',
      name: name ?? '',
      data,
    });
```

Delete the old final two lines (`const upgrade = getWebSocketUpgrader();` / `return upgrade((ctx) => createEvents(ctx, resolved))(c, next);`) from the CF branch. The Node (no-connector) branch above still uses `getWebSocketUpgrader()`, so keep its import.

- [ ] **Step 4: Run the handler suite; confirm green**

Run: `pnpm --filter @hono-preact/server exec vitest run src/__tests__/sockets-handler.test.ts`
Expected: PASS (the three new CF-path tests plus all existing tests, including the Node-path and room-forward ones).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/sockets-handler.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "$(cat <<'EOF'
feat(realtime): forward plain sockets to a per-connection DO on Cloudflare

On a forwarding adapter socketsHandler now forwards an allowed plain
socket via connector({ kind: 'socket-forward' }) and closes a denied or
unknown def via the connector deny, after the edge guard. The CF path no
longer reaches getWebSocketUpgrader(); Node (no connector) is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: workerd integration test (end-to-end CF socket)

**Files:**
- Create: `packages/vite/src/__tests__/fixtures/cf-socket/vite.config.ts`
- Create: `packages/vite/src/__tests__/fixtures/cf-socket/wrangler.jsonc`
- Create: `packages/vite/src/__tests__/fixtures/cf-socket/src/routes.ts`
- Create: `packages/vite/src/__tests__/fixtures/cf-socket/src/socket.server.ts`
- Create: `packages/vite/src/__tests__/fixtures/cf-socket/src/Layout.tsx`
- Create: `packages/vite/src/__tests__/fixtures/cf-socket/src/pages/home.tsx`
- Create: `packages/vite/src/__tests__/cf-socket.test.ts`

**Interfaces:**
- Consumes: the entire chain (Tasks 1-7). This is the runtime proof of acceptance criteria #1 (works end to end on CF) and #2 (guard at the edge).

- [ ] **Step 1: Author the fixture**

Copy `packages/vite/src/__tests__/fixtures/cf-room/vite.config.ts` verbatim to `cf-socket/vite.config.ts` (the alias block is identical and path-relative; it does not reference the fixture name).

`cf-socket/wrangler.jsonc` (same as cf-room but `name: "cf-socket"`):

```jsonc
{
  "name": "cf-socket",
  "main": "node_modules/.vite/hono-preact/server-entry.tsx",
  "compatibility_date": "2026-02-22",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "HONO_PREACT_REALTIME", "class_name": "HonoPreactRealtimeDO" }
    ]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["HonoPreactRealtimeDO"] }]
}
```

`cf-socket/src/routes.ts`:

```ts
import { defineRoutes } from 'hono-preact';

// socket.server.ts is not route-bound, but its `serverSockets` map must be
// discoverable by buildSocketRegistry, which reads from serverImports (the
// `server` thunks in the route tree). A single leaf carrying `server`
// contributes the module; the home view gives SSR something to render.
export default defineRoutes([
  {
    path: '/',
    view: () => import('./pages/home.js'),
    server: () => import('./socket.server.js'),
  },
]);
```

`cf-socket/src/socket.server.ts`:

```ts
import { defineSocket, defineServerMiddleware, deny } from 'hono-preact';

type Incoming = { kind: 'say'; text: string };
type Outgoing = { kind: 'echo'; text: string; who: string };

// A guard that always denies (the canonical auth-deny shape). On Cloudflare the
// worker must close 4403 via the connector deny WITHOUT contacting the DO.
const denyAll = defineServerMiddleware(async () => {
  throw deny('forbidden', 403);
});

export const serverSockets = {
  // Echoes each client message back on the SAME connection, tagged with the
  // edge-captured `who`. `who` proves the data factory ran at the edge and rode
  // to the DO; the echo proves the full duplex round-trip through the DO. One
  // DO per connection, no fan-out.
  echo: defineSocket<Incoming, Outgoing, { who: string }>({
    data: (c) => ({ who: c.req.query('u') ?? 'anon' }),
    message(socket, msg) {
      if (msg.kind === 'say') {
        socket.send({ kind: 'echo', text: msg.text, who: socket.data.who });
      }
    },
  }),
  // A socket whose guard always denies; on CF must close 4403 with no DO contact.
  deniedSocket: defineSocket<Incoming, Outgoing, undefined>({
    use: [denyAll],
    message() {},
  }),
};
```

`cf-socket/src/Layout.tsx` (same as cf-room, title changed):

```tsx
import { ClientScript, Head } from 'hono-preact';
import type { ComponentChildren } from 'preact';

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="cf-socket" />
      <body>
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
```

`cf-socket/src/pages/home.tsx`:

```tsx
export default function Home() {
  return <h1>cf-socket fixture</h1>;
}
```

- [ ] **Step 2: Write the integration test**

Create `packages/vite/src/__tests__/cf-socket.test.ts`. Reuse the helper shapes from `cf-room.test.ts` (`serverPort`, `connectWs`, `waitForOpen`, `waitForClose`, `drainUntil`); copy the ones you use into this file (the tests are independent files):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { WebSocket } from 'ws';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end Cloudflare DO plain-socket integration test (issue #169). A fixture
// hono-preact app using cloudflareAdapter() is served through the
// @cloudflare/vite-plugin workerd dev server (same mechanism as cf-room.test.ts).
// A real `ws` client connects to /__sockets for a plain `defineSocket`; the
// worker guards at the edge then forwards the upgrade to a fresh per-connection
// Durable Object, where the socket handler runs. We assert the full duplex
// round-trip (client say -> server echo) carrying the edge-captured `who`, and
// that a guard-denied socket closes 4403 with no DO contact.

const here = dirname(fileURLToPath(import.meta.url));
const cfSocketRoot = resolve(here, 'fixtures/cf-socket');

// deriveModuleKey(src/socket.server.ts, viteRoot=fixtureDir) = 'src/socket';
// the socket NAME is the serverSockets property name.
const MODULE_KEY = 'src/socket';
const SOCKET_NAME = 'echo';
const DENIED_NAME = 'deniedSocket';
const WS_DENY_CODE = 4403;
const SOCKETS_RPC_PATH = '/__sockets';

function serverPort(server: ViteDevServer): number {
  const addr = server.httpServer!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

function socketUrl(port: number, name: string, user?: string): string {
  return (
    `ws://localhost:${port}${SOCKETS_RPC_PATH}` +
    `?m=${encodeURIComponent(MODULE_KEY)}` +
    `&s=${encodeURIComponent(name)}` +
    (user ? `&u=${encodeURIComponent(user)}` : '')
  );
}

function waitForOpen(ws: WebSocket, timeout = 10_000): Promise<void> {
  return new Promise((res, rej) => {
    if (ws.readyState === WebSocket.OPEN) return res();
    const t = setTimeout(() => rej(new Error('ws open timeout')), timeout);
    ws.once('open', () => {
      clearTimeout(t);
      res();
    });
    ws.once('error', (err) => {
      clearTimeout(t);
      rej(err);
    });
  });
}

function waitForMessage(ws: WebSocket, timeout = 8_000): Promise<string> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws message timeout')), timeout);
    ws.once('message', (data) => {
      clearTimeout(t);
      res(data.toString());
    });
  });
}

function waitForClose(ws: WebSocket, timeout = 10_000): Promise<number> {
  return new Promise((res, rej) => {
    let closed = false;
    const t = setTimeout(() => rej(new Error('ws close timeout')), timeout);
    ws.once('close', (code) => {
      closed = true;
      clearTimeout(t);
      res(code);
    });
    ws.once('error', (err) => {
      if (!closed) {
        clearTimeout(t);
        rej(err);
      }
    });
  });
}

describe('Cloudflare adapter: plain socket (per-connection DO, duplex round-trip)', () => {
  let server: ViteDevServer;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(cfSocketRoot);
    server = await createServer({ root: cfSocketRoot, server: { port: 0 } });
    await server.listen();
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    process.chdir(originalCwd);
  });

  it('client say -> server echo through the DO, carrying the edge data factory result', async () => {
    const port = serverPort(server);
    const ws = new WebSocket(socketUrl(port, SOCKET_NAME, 'alice'));
    await waitForOpen(ws);

    ws.send(JSON.stringify({ kind: 'say', text: 'hi there' }));
    const raw = await waitForMessage(ws);
    const env = JSON.parse(raw) as { kind: string; text: string; who: string };
    expect(env).toEqual({ kind: 'echo', text: 'hi there', who: 'alice' });

    ws.close(1000);
  }, 60_000);

  it('a guard-denied socket closes WS_DENY_CODE (4403), not a worker 500', async () => {
    const port = serverPort(server);
    const denied = new WebSocket(socketUrl(port, DENIED_NAME));
    const code = await waitForClose(denied);
    expect(code).toBe(WS_DENY_CODE);
  }, 60_000);
});
```

- [ ] **Step 3: Run the integration test; confirm green**

Run: `pnpm --filter @hono-preact/vite exec vitest run src/__tests__/cf-socket.test.ts`
Expected: PASS (2 tests). This boots workerd via `@cloudflare/vite-plugin`; the first run compiles the worker and can take up to ~2 minutes (the `beforeAll` timeout is 120s).

- [ ] **Step 4: Confirm `.wrangler/` is not staged**

Run: `git status --porcelain packages/vite/src/__tests__/fixtures/cf-socket`
Expected: only the authored source files appear, never `.wrangler/` or `node_modules/` (they are gitignored local emulation/build state). If any appear, do not `git add` them.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/__tests__/cf-socket.test.ts packages/vite/src/__tests__/fixtures/cf-socket/src packages/vite/src/__tests__/fixtures/cf-socket/vite.config.ts packages/vite/src/__tests__/fixtures/cf-socket/wrangler.jsonc
git commit -m "$(cat <<'EOF'
test(realtime): end-to-end plain socket on Cloudflare (workerd)

A real ws client drives a defineSocket through the cloudflareAdapter
workerd dev server: the worker guards at the edge, forwards to a
per-connection DO, and the duplex echo round-trips carrying the edge
data factory result. A guard-denied socket closes 4403 with no DO
contact.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Docs + release notes

**Files:**
- Modify: `apps/site/src/pages/docs/websockets.mdx`
- Modify: `docs/superpowers/specs/2026-06-21-v0.8-release-notes.md`

**Interfaces:**
- Consumes: the final API shape (Task 1) + the CF support (Tasks 5-8).

- [ ] **Step 1: Update the server-module example (`websockets.mdx`)**

Replace the `open(socket, { c })` usage in the example (lines 41-49) with the `data` factory:

```ts
    // Edge factory: runs at the upgrade with the live Context; its result seeds
    // socket.data. Read cookies, headers, and middleware values here.
    data: (c) => ({ name: c.get('user').name }),

    open(socket) {
      // Return a teardown fn to run on close (Node only; see the note below).
      return () => {
        console.log(`${socket.data.name} disconnected`);
      };
    },
```

Replace the prose paragraph at line 63 with:

```md
`open` runs once per connection after the upgrade. It receives only the `socket`; read request-derived values (cookies, headers, middleware state) in the `data` factory, which runs at the upgrade with the full Hono `Context` and seeds `socket.data`. Returning a function from `open` registers a teardown that runs when the connection closes on Node; on Cloudflare the connection is hibernatable, so use `close` for cleanup that must run on both runtimes.
```

Update line 65 to mention the `data` factory seeds the bag:

```md
`socket.data` is a per-connection bag seeded by the `data` factory and mutable in the handler. Declare its shape with the third type parameter: `defineSocket<Incoming, Outgoing, Data>()`. It is `undefined` by default (no `data` factory).
```

- [ ] **Step 2: Update the `defineSocket` handler table (`websockets.mdx`)**

In the `handler` fields table (lines 220-226), replace the `open` row and add a `data` row directly above it:

```md
| `data`    | `(c: Context) => Data`                                    | Edge factory run once at the upgrade with the live Context; its result seeds `socket.data`. The only place a socket handler sees a Context (on Cloudflare the connection runs inside a Durable Object).               |
| `open`    | `(socket) => void \| (() => void) \| Promise<...>`        | Runs once per connection. Returning a function registers a teardown (Node only; on Cloudflare use `close`). Receives only the socket; its `data` is the `data` factory result.                                       |
```

Update the `socket.data` row (line 234) to:

```md
| `data`                  | `Data`                    | Per-connection bag. Seeded by the `data` factory; mutable in the handler.                |
```

- [ ] **Step 3: State Cloudflare support for typed sockets (`websockets.mdx`)**

Replace the paragraph at line 17 with one that no longer implies sockets are Node-only and points to the DO termination:

```md
On Node, a single HTTP connection is shared across the framework and all sockets. On Cloudflare a typed socket runs end to end: the worker guards the upgrade at the edge and forwards it to a per-connection Durable Object that runs the handler under the Hibernation API, so the same `defineSocket` works on both runtimes. Cross-connection fan-out (broadcasting to every connected client) is a separate concern: use [Rooms](/docs/rooms), which coordinate many connections through one Durable Object per topic.
```

- [ ] **Step 4: Record the API change in the v0.8 release notes**

In `docs/superpowers/specs/2026-06-21-v0.8-release-notes.md`, under the `## Breaking changes` list, add an entry mirroring the existing diff-invisible entries:

```md
- **`defineSocket` / `route.socket`: `open` no longer receives the Hono `Context`; a new `data?: (c) => Data` factory seeds `socket.data`.** Move any `open(socket, { c })` context reads into `data(c)`. This makes a socket handler portable to Cloudflare (where it runs inside a Durable Object with no live Context) and matches the room API.
  Diff-invisible: the `SocketHandler` / `defineSocket` export names persist; only `open`'s parameter list and the new optional `data` field change the type shape. (Issue #169: plain sockets now work on Cloudflare.)
```

- [ ] **Step 5: Build the site to confirm the MDX still compiles**

Run: `pnpm --filter site build`
Expected: PASS (MDX tables and code fences compile; no broken links introduced).

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/docs/websockets.mdx docs/superpowers/specs/2026-06-21-v0.8-release-notes.md
git commit -m "$(cat <<'EOF'
docs(realtime): typed sockets work on Cloudflare; document data() factory

websockets.mdx drops the Node-only framing (a typed socket now runs in a
per-connection DO on Cloudflare), documents the data() edge factory and
the open()-takes-only-socket / close-is-the-portable-cleanup rules, and
the v0.8 notes record the export-diff-invisible socket API change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all tasks)

Run the full CLAUDE.md pre-push gate in order (the realtime DO + workerd integration tests make steps 6-7 the long poles):

1. `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
2. `pnpm gen:agents-corpus`
3. `pnpm format:check` (if it fails, `pnpm format` then re-commit)
4. `pnpm typecheck`
5. `pnpm test:types`
6. `pnpm test:coverage`
7. `pnpm test:integration`
8. `pnpm --filter site build`

Then the whole-branch review (subagent-driven-development's final step) before opening the PR.
