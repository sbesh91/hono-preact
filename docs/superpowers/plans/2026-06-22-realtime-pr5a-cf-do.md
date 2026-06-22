# Realtime PR 5a: Cloudflare DO backend for rooms + presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rooms + presence run on Cloudflare (workerd) with real cross-isolate fan-out by backing them with one hibernating Durable Object per topic, while keeping the Node path behavior-identical.

**Architecture:** The worker authenticates and validates a room upgrade at the edge (PR 4's guard chain + key resolution + a new edge-capture), then forwards the WebSocket to the topic's DO (`idFromName(topic)`). The room runtime (join/message/leave + fan-out + presence) is extracted into a transport-agnostic **room engine** driven by two transports: the existing in-process Node transport, and a new Cloudflare transport backed by the DO's hibernation API (`getWebSockets()` + per-socket attachments). Fan-out on Cloudflare is intra-DO, not via pub/sub (that is PR 5b).

**Tech Stack:** TypeScript, Hono, Cloudflare Durable Objects (WebSocket Hibernation API, `new_sqlite_classes`), `@cloudflare/vite-plugin`, Preact, Vitest, `ws` (Node integration clients).

**Spec:** `docs/superpowers/specs/2026-06-22-realtime-pr5a-cf-do-design.md`.

## Global Constraints

- **No em-dashes** anywhere (prose, comments, commit messages). No new `as` casts beyond sanctioned boundaries (JSON.parse of untrusted wire; the pub/sub `unknown` -> envelope narrowing; the def-doubles-as-ref pattern; structural reads off user modules; reading workerd attachment payloads which are untrusted-shaped). Reshape otherwise.
- **Behavior-preserving Node refactor.** Every PR 4 + ultrareview test must pass **unchanged** through the engine extraction. If a PR 4 test needs editing, that is a regression signal: fix the refactor, not the test. (Exception: the deliberate `data`/`c` API change in Task 1 updates the specific tests that assert the old `onJoin({ c, params })` shape.)
- **Rooms only on Cloudflare.** Plain 1:1 sockets on CF stay deferred (a socket connection on CF fails with PR 3's existing "no WebSocket upgrader installed" error). Reconnect-replay stays deferred (reconnect re-joins + re-snapshots, no replay).
- **Fan-out on CF is intra-DO** (the DO iterates its own connections), never the pub/sub backend.
- **Topic is server-computed.** `topic = channel.key(params)` at the edge; the client never supplies a topic. Preserve this security property end to end.
- **Discriminated-union messages; `Serialize<T>` on the wire** (match PR 4).
- **Fixed DO binding name:** `HONO_PREACT_REALTIME`; DO class name `HonoPreactRealtimeDO`; migration uses `new_sqlite_classes`.
- **Pre-merge gate** (mirror CI, dist rebuilt FIRST since this touches iso/server/vite public types): build, `format:check`, `typecheck`, `test:types`, `test:coverage`, `test:integration`, `pnpm --filter site build`.
- Commits land on `realtime-pr5-cf-do` (based on `main` with PR 4 merged at `9b9b23d`).

---

### Task 1: room handler API refinement (edge `data` capture; drop live `c`)

The room callbacks must not depend on a live Hono `Context` (it does not exist inside a hibernating DO). Replace `onJoin(conn, { c, params })` with an edge-run `data: (c) => Data` factory whose serializable result seeds `conn.data`. This is a pre-release change (the realtime program is unreleased).

**Files:**
- Modify: `packages/iso/src/define-room.ts` (`RoomHandler`: drop `c` from `onJoin` ctx; add `data?: (c: Context) => Data`)
- Modify: `packages/server/src/rooms-handler.ts` (run the `data` factory at the edge to seed `conn.data`; call `onJoin(conn, { params })` without `c`)
- Modify: `packages/iso/src/__tests__/define-room.test-d.ts` (the `onJoin` ctx type; the `data` factory type)
- Modify: `packages/server/src/__tests__/rooms-handler.test.ts` (drop `{ c }` assertions; add a `data`-seeds-`conn.data` test)
- Modify: `apps/example-node/src/pages/cursors.server.ts` (use `data` if it read `c`; the current cursors room does not read `c`, so confirm + leave or add a `data` example)
- Modify: `apps/site/src/pages/docs/rooms.mdx` (the `onJoin`/`data` example; this file may have been adjusted by the user, read it first)

**Interfaces produced:**
- `RoomHandler` gains `data?: (c: Context) => Data` (runs at the edge; serializable). `onJoin?(conn, ctx: { params: Params })` (no `c`). `onMessage`/`onLeave`/`onError` unchanged.
- The edge wiring: the worker runs `roomDef.data?.(c)` once per connection and uses the result as `conn.data`'s initial value.

- [ ] **Step 1: Update `RoomHandler` types** in `define-room.ts`. Drop `c` from `onJoin`'s ctx so it is `{ params: Params }`. Add `data?: (c: Context) => Data` above `onJoin`. Keep `RoomConnection.data: Data`. Import `Context` from `hono` is already present.

```ts
export interface RoomHandler<Incoming, Outgoing, State, Data, Params> {
  use?: ReadonlyArray<Middleware>;
  presence?: () => State;
  /**
   * Runs at the edge (the worker) with the live Hono Context, on both Node and
   * Cloudflare. Its serializable result seeds `conn.data`, which is then
   * available in onJoin and onMessage. Use it to capture request-derived data
   * (the authenticated user, a header) since the room callbacks run without a
   * live Context (inside a Durable Object on Cloudflare).
   */
  data?: (c: Context) => Data;
  onJoin?(
    conn: RoomConnection<Outgoing, State, Data>,
    ctx: { params: Params }
  ): void | (() => void) | Promise<void | (() => void)>;
  onMessage?(conn: RoomConnection<Outgoing, State, Data>, msg: Incoming): void | Promise<void>;
  onLeave?(conn: RoomConnection<Outgoing, State, Data>): void;
  onError?(conn: RoomConnection<Outgoing, State, Data>, err: unknown): void;
}
```

- [ ] **Step 2: Type test** (`define-room.test-d.ts`): assert `onJoin`'s ctx is `{ params }` (no `c`); a `@ts-expect-error` on reading `ctx.c`; assert `data: (c) => Data` infers `Data` and that `conn.data` is that `Data` in `onJoin`/`onMessage`. Run `pnpm exec vitest run --typecheck.only packages/iso/src/__tests__/define-room.test-d.ts`.

- [ ] **Step 3: Wire the edge `data` factory** in `rooms-handler.ts` `createRoomWsEvents`. In `onOpen`, before building `conn`, compute the initial data: `const initialData = (roomDef.data?.(ctx) ?? {}) as Record<string, unknown>;` (sanctioned: the factory result seeds the per-connection bag) and use it as `conn.data`'s starting value (currently `data: {}`). Change the `onJoin` call from `roomDef.onJoin?.(conn, { c: ctx, params })` to `roomDef.onJoin?.(conn, { params })`.

- [ ] **Step 4: Update the Node tests** (`rooms-handler.test.ts`): any test asserting `onJoin` received `c` drops that assertion. Add a test: a room with `data: (c) => ({ tag: c.req.query('tag') ?? 'none' })` connects with `?tag=x`; assert `onJoin`'s `conn.data.tag === 'x'` and that `onMessage` sees the same `conn.data`. Run `npx vitest run packages/server/src/__tests__/rooms-handler.test.ts`.

- [ ] **Step 5: Update the dogfood + docs.** Read `apps/example-node/src/pages/cursors.server.ts`; if `onJoin` read `c`, move that read into `data: (c) => ...`. Read `apps/site/src/pages/docs/rooms.mdx` and update the server-module example to the `data` factory + `onJoin(conn, { params })` shape (the docs example uses `c.get('user')` inside `onJoin` today; move it to `data: (c) => ({ name: c.get('user')?.name ?? 'Guest' })` and read `conn.data.name` in `onJoin`). Re-run the docs-structure gate: `npx vitest run apps/site/scripts/__tests__/page-structure.test.ts apps/site/scripts/__tests__/docs-structure.test.ts`.

- [ ] **Step 6: Run + commit.** `npx vitest run packages/server/src/__tests__/rooms-handler.test.ts packages/iso/src/__tests__/define-room.test.ts` and the type test -> PASS. `pnpm format`, then:
```bash
git add packages/iso/src/define-room.ts packages/server/src/rooms-handler.ts packages/iso/src/__tests__/define-room.test-d.ts packages/server/src/__tests__/rooms-handler.test.ts apps/example-node/src/pages/cursors.server.ts apps/site/src/pages/docs/rooms.mdx
git commit -m "feat(iso): edge data(c) factory seeds conn.data; room callbacks lose live Context

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: extract the transport-agnostic room engine + refactor the Node runtime onto it

Pull the protocol (fan-out rules, snapshot/deltas, frame routing, join/message/leave sequence, the `RoomConnection` shape) out of `rooms-handler.ts` into a transport-agnostic engine. Refactor the Node runtime to drive it behavior-preservingly.

**Files:**
- Create: `packages/server/src/room-engine.ts` (the engine + `RoomTransport` interface + the `RoomConnection` factory)
- Create: `packages/server/src/__tests__/room-engine.test.ts` (drive the engine with a fake transport)
- Modify: `packages/server/src/rooms-handler.ts` (`createRoomWsEvents` builds a Node `RoomTransport` and delegates to the engine)
- Keep: `packages/server/src/__tests__/rooms-handler.test.ts` (must pass UNCHANGED, the contract)

**Interfaces produced:**

```ts
// room-engine.ts
export interface RoomTransport {
  readonly connId: string;            // the calling connection's id (for conn.id / self)
  sendTo(connId: string, env: AnyEnvelope): void;
  broadcast(env: AnyEnvelope, excludeConnId?: string): void;
  joinPresence(connId: string, state: unknown): void;
  leavePresence(connId: string): void;
  updatePresence(connId: string, state: unknown): void;
  roster(): Array<{ id: string; state: unknown }>;
  data(connId: string): unknown;      // the edge-captured conn data
}

// Stateless handlers (each receives the transport for the acting connection):
export function engineJoin(t: RoomTransport, def: AnyRoomDef, params: Record<string, string>): Promise<(() => void) | void>;
export function engineMessage(t: RoomTransport, def: AnyRoomDef, rawFrame: string): Promise<void>;
export function engineClose(t: RoomTransport, def: AnyRoomDef): void;
// Builds the RoomConnection handed to user callbacks from a transport.
export function makeRoomConnection(t: RoomTransport): RoomConnection<unknown, unknown, unknown>;
```

- `engineJoin`: build conn, `joinPresence(connId, def.presence?.())`, `sendTo(connId, snapshot{self:connId, members:roster()})`, `broadcast(presence/join, exclude connId)`, run `def.onJoin(conn, { params })`, return its teardown.
- `engineMessage`: try/catch JSON.parse (return on error); `{t:'presence'}` -> `updatePresence` + `broadcast(presence/update)`; `{t:'msg'}` -> `def.onMessage(conn, frame.msg)`; unknown `t` dropped. (Same as the PR 4 ultrareview hardening, now centralized.)
- `engineClose`: `leavePresence`, `broadcast(presence/leave)`, `def.onLeave(conn)`. (The caller runs the onJoin teardown.)
- `makeRoomConnection`: `id: t.connId`, `send -> sendTo(connId)`, `broadcast(msg, opts) -> broadcast(msgEnv, opts?.self ? undefined-then-also-sendTo : connId)` (sender excluded unless `self`; `self` adds a direct `sendTo(connId)`), `setPresence -> updatePresence + broadcast(presence/update)`, `data: t.data(connId)`, `close` is transport-specific (passed in).

- [ ] **Step 1: Write the engine test first** (`room-engine.test.ts`) against a fake transport that records `sendTo`/`broadcast` calls and holds an in-memory roster. Assert: join sends a `snapshot` with `self` + roster to the joiner and broadcasts a `presence/join` excluding the joiner; `conn.broadcast(msg)` excludes the sender; `conn.broadcast(msg, {self:true})` also `sendTo`s the sender; a `{t:'presence'}` frame updates the roster + broadcasts `presence/update`; a `{t:'msg'}` frame calls `def.onMessage`; a malformed frame is a no-op; an unknown `t` is dropped; close broadcasts `presence/leave` + calls `onLeave`. Run `npx vitest run packages/server/src/__tests__/room-engine.test.ts` -> FAIL (engine not implemented).

- [ ] **Step 2: Implement `room-engine.ts`** to pass the engine test. Move the envelope construction (`envMsg`, `publishPresence`-shaped delta builders) and the fan-out rules out of `rooms-handler.ts` into here, parameterized by `RoomTransport`. No transport/pubsub imports in this file (it is pure of platform). Run the engine test -> PASS.

- [ ] **Step 3: Refactor `rooms-handler.ts`** to build a Node `RoomTransport` and delegate. The Node transport implements: `sendTo`/`broadcast` via `getPubSubBackend()` exactly as today (publish the envelope; the per-connection subscribe callback that forwards + sender-excludes stays, but the exclude is now expressed via `broadcast(env, excludeConnId)` + the subscribe callback's `from !== connId` skip); `joinPresence`/`leavePresence`/`updatePresence`/`roster` via `presence.ts` (`joinRoom`/`leaveRoom`/`updatePresence`/`roomMembers`); `data(connId)` returns the per-connection `initialData` from Task 1. `createRoomWsEvents` keeps its `{ ctx, denied, roomKey }` signature and the deny-before-subscribe ordering; `onOpen` now: deny-early -> set topic/params -> connId -> subscribe -> `await engineJoin(transport, def, params)` (capture teardown) -> store teardown; `onMessage` -> `engineMessage(transport, def, raw)`; `onClose` -> `engineClose(transport, def)` then run the onJoin teardown + `unsub`.

- [ ] **Step 4: Run the Node room suites UNCHANGED.** `npx vitest run packages/server/src/__tests__/rooms-handler.test.ts packages/server/src/__tests__/sockets-handler.test.ts` -> PASS with no test edits. If any assertion fails, the refactor changed behavior: fix the refactor. Then `pnpm test:integration`-equivalent for rooms: `npx vitest run packages/server/src/__tests__/rooms-integration.test.ts` (via the unit config it lives in) -> PASS.

- [ ] **Step 5: Commit.** `pnpm format`, then:
```bash
git add packages/server/src/room-engine.ts packages/server/src/__tests__/room-engine.test.ts packages/server/src/rooms-handler.ts
git commit -m "refactor(server): extract transport-agnostic room engine; Node runtime drives it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: the Cloudflare room transport (over a minimal DO-state interface)

Implement `RoomTransport` backed by the DO hibernation API, isolated behind a tiny interface so it is unit-testable in plain vitest with a fake.

**Files:**
- Create: `packages/server/src/cf/room-do-transport.ts` (the CF transport + a `DOConnState` interface it depends on)
- Create: `packages/server/src/cf/__tests__/room-do-transport.test.ts`

**Interfaces produced:**

```ts
// The minimal slice of the DO connection store the transport needs. The real
// DO provides this from ctx.getWebSockets() + (de)serializeAttachment; the test
// provides a fake. Keeps the transport off the workerd API directly.
export interface DOConnState {
  all(): Array<{ id: string; send(data: string): void; getState(): RoomConnAttachment }>;
  get(connId: string): { send(data: string): void; getState(): RoomConnAttachment; setState(s: RoomConnAttachment): void } | undefined;
}
export interface RoomConnAttachment { connId: string; moduleKey: string; name: string; params: Record<string, string>; data: unknown; presence: unknown; }

export function makeCfRoomTransport(connId: string, store: DOConnState): RoomTransport;
```

- `sendTo(id, env)`: `store.get(id)?.send(JSON.stringify(env))`.
- `broadcast(env, exclude)`: for each `c` in `store.all()` where `c.id !== exclude`, `c.send(JSON.stringify(env))`.
- `roster()`: `store.all().map(c => ({ id: c.id, state: c.getState().presence }))`.
- `joinPresence`/`updatePresence(id, state)`: `const s = store.get(id)!.getState(); store.get(id)!.setState({ ...s, presence: state })`. `leavePresence`: no-op (closing the socket removes it from `store.all()`).
- `data(id)`: `store.get(id)?.getState().data`.

- [ ] **Step 1: Write the test first** with a fake `DOConnState` (an array of fake conns each holding an attachment object + a `send` spy). Assert the same fan-out properties as the engine test but through the CF transport: `broadcast` reaches all but the excluded id; `sendTo` targets one; `roster` reflects attachments; `updatePresence` mutates the attachment. Run -> FAIL.

- [ ] **Step 2: Implement `room-do-transport.ts`** -> PASS. No workerd imports here (only the `DOConnState` interface). Run `npx vitest run packages/server/src/cf/__tests__/room-do-transport.test.ts`.

- [ ] **Step 3: Commit.**
```bash
pnpm format && git add packages/server/src/cf/room-do-transport.ts packages/server/src/cf/__tests__/room-do-transport.test.ts
git commit -m "feat(server): Cloudflare room transport over a fakeable DO-state interface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: the realtime-connector seam (worker dispatch: Node in-process vs forward-to-DO)

`socketsHandler`'s room branch must, on Cloudflare, forward the upgrade to the DO instead of running the runtime in the worker. Add a pluggable connector seam mirroring `installWebSocketUpgrader`. The Node connector preserves today's behavior.

**Files:**
- Create: `packages/iso/src/internal/realtime-connector.ts` (`installRealtimeConnector`/`getRealtimeConnector` + the `RealtimeConnector` type)
- Modify: `packages/iso/src/internal-runtime.ts` (export the new seam on the `/internal/runtime` door)
- Modify: `packages/server/src/sockets-handler.ts` (room branch: if a connector is installed, delegate to it; else run the in-worker `createRoomWsEvents`)
- Modify: `packages/server/src/__tests__/sockets-handler.test.ts` (a connector-installed test: the room branch calls the connector with the resolved context, not `createRoomWsEvents`)

**Interfaces produced:**

```ts
// realtime-connector.ts
export interface RoomConnectContext {
  c: Context;
  topic: string;
  moduleKey: string;
  name: string;
  params: Record<string, string>;
  data: unknown;        // result of roomDef.data?.(c), already run at the edge
}
export type RealtimeConnector = (ctx: RoomConnectContext) => Response | Promise<Response>;
export function installRealtimeConnector(connector: RealtimeConnector): void;
export function getRealtimeConnector(): RealtimeConnector | undefined; // undefined => use the in-worker Node runtime
```

- Default: none installed -> `socketsHandler` runs the existing in-worker `createRoomWsEvents` (Node). When a connector IS installed (CF adapter installs one), the room branch, after the guard ALLOWS, runs `roomDef.data?.(c)` and calls the connector, returning its `Response` (the forwarded `101`). A denied connection still uses the in-worker deny path (close `4403`) without invoking the connector.

- [ ] **Step 1: Implement the seam** (`realtime-connector.ts`) mirroring `ws-upgrader.ts` (module-level `current`, install/get). Export on the `/internal/runtime` door.

- [ ] **Step 2: Wire `sockets-handler.ts` room branch.** After computing `roomKey` + `denied`:
  - If `'channel' in def && roomKey?.ok`: `const connector = getRealtimeConnector();` if `connector && !denied`: run `const data = roomDef.data?.(ctx) ?? {};` and `return connector({ c: ctx, topic: roomKey.topic, moduleKey, name, params: roomKey.params, data });` (the connector returns the upgrade Response). If `denied`, return the existing in-worker deny WSEvents (close 4403) via `upgrade(createRoomWsEvents(...))`. If NO connector: today's path `return upgrade(createRoomWsEvents(def, { ctx, denied, roomKey }))`.
  - Note: the connector returns a `Response`, so the handler returns it directly rather than going through `upgrade(...)`. Keep the Node (no-connector) path byte-identical.

- [ ] **Step 3: Test** (`sockets-handler.test.ts`): install a fake connector; a room connection that passes the guard calls the connector with `{ topic, moduleKey, name, params, data }` and returns its Response; a denied room connection does NOT call the connector and closes 4403; a plain socket never calls the connector. Reset the connector between tests (add `__resetRealtimeConnectorForTesting`). Run `npx vitest run packages/server/src/__tests__/sockets-handler.test.ts` -> PASS.

- [ ] **Step 4: Commit.**
```bash
pnpm format && git add packages/iso/src/internal/realtime-connector.ts packages/iso/src/internal-runtime.ts packages/server/src/sockets-handler.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "feat: pluggable realtime connector seam (Node in-worker vs forward-to-DO)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: the Durable Object class (hibernation glue) + a workerd spike first

This is the one task with genuine workerd-specific unknowns (the spec's open risks 1, 2, 7). De-risk with a tiny spike, then build the real DO.

**Files:**
- Create: `packages/server/src/cf/realtime-do.ts` (`HonoPreactRealtimeDO` + the worker-side connector that forwards to it)
- Create: `packages/server/src/cf/__tests__/realtime-do-spike.md` (a short recorded spike result, committed under docs is fine; or delete after)
- The room-registry-in-DO mechanism (see Step 3)

**Interfaces produced:**
- `class HonoPreactRealtimeDO` with `fetch(request)`, `webSocketMessage(ws, message)`, `webSocketClose(ws, code, reason, wasClean)`, `webSocketError(ws, error)`.
- `makeCfForwardConnector(getNamespace: (c) => DurableObjectNamespace): RealtimeConnector` -> the worker-side connector that does `stub.fetch`.

- [ ] **Step 1: Spike the hibernation + forwarding** in the integration fixture harness (the same mechanism as `packages/vite/src/__tests__/fixtures/cf-ws`, which runs a worker in workerd via `@cloudflare/vite-plugin`). Build a throwaway DO that: in `fetch`, makes a `WebSocketPair`, `this.ctx.acceptWebSocket(server)`, `server.serializeAttachment({ n: 0 })`, returns `new Response(null, { status: 101, webSocket: client })`; in `webSocketMessage`, reads `ws.deserializeAttachment()`, echoes `count`, re-serializes. A worker `fetch` forwards `GET /ws` upgrades to `env.SPIKE_DO.get(env.SPIKE_DO.idFromName('x')).fetch(request)`. Drive it with a `ws` client through the vite-plugin dev server (mirror `websocket-dev.test.ts`'s CF suite). CONFIRM: forwarding a `Upgrade: websocket` request through `stub.fetch` returns the 101 + a working socket; `acceptWebSocket` + attachments survive a message; `getWebSockets()` lists it. Record the exact working shapes in the spike note. If `stub.fetch` upgrade forwarding does not work as expected, STOP and report (this gates the whole CF path).

- [ ] **Step 2: Implement `HonoPreactRealtimeDO`** using the spike's confirmed shapes:
  - `fetch(request)`: read forwarded headers `x-hp-topic`, `x-hp-module`, `x-hp-name`, `x-hp-params` (JSON), `x-hp-data` (JSON). `connId = crypto.randomUUID()`. `WebSocketPair`; `this.ctx.acceptWebSocket(server)`; `server.serializeAttachment({ connId, moduleKey, name, params, data, presence: getDef(moduleKey,name).presence?.() } satisfies RoomConnAttachment)`. Build a `DOConnState` over `this.ctx.getWebSockets()` (map each `ws` to `{ id: ws.deserializeAttachment().connId, send: (d) => ws.send(d), getState/setState via (de)serializeAttachment }`). `const t = makeCfRoomTransport(connId, store);` `await engineJoin(t, def, params);` return `new Response(null, { status: 101, webSocket: client })`. (Note: `engineJoin`'s `onJoin` teardown cannot persist across hibernation; document that room `onJoin` teardowns are not supported on CF, or run leave-side logic in `webSocketClose` only. See Step 4.)
  - `webSocketMessage(ws, message)`: read `ws.deserializeAttachment()` for `connId`/def identity; rebuild the `DOConnState` + transport; `await engineMessage(t, def, typeof message === 'string' ? message : new TextDecoder().decode(message))`.
  - `webSocketClose(ws)`: rebuild transport for the closing `connId`; `engineClose(t, def)`. (The socket is already leaving `getWebSockets()`; ensure `broadcast(presence/leave)` excludes it or runs after removal.)
  - `webSocketError(ws, err)`: `def.onError?.(conn, err)`.

- [ ] **Step 3: The room registry in the DO.** The DO needs `getDef(moduleKey, name)`. Add a framework-generated module the DO imports that exposes `buildRoomRegistry(serverImports)` over the SAME `serverImports` the worker uses. Concretely: the CF adapter's generated worker entry (Task 6) writes a module exporting `serverImports` (from the routes manifest) that both `createServerEntry` and the DO read; the DO builds + caches the room registry on first use. Document the exact generated module path in Task 6.

- [ ] **Step 4: onJoin-teardown semantics on CF.** PR 4's `onJoin` may return a teardown run on leave. Across hibernation the teardown closure cannot survive. Decide + document: room `onJoin` teardowns run only on Node; on CF, put leave-side cleanup in `onLeave`. Add this to `rooms.mdx` (Task 9) and assert it does not break the engine (engineClose already calls `onLeave`; the onJoin teardown is run by the Node caller only).

- [ ] **Step 5: The forward connector** `makeCfForwardConnector`: `({ c, topic, moduleKey, name, params, data }) => { const ns = c.env.HONO_PREACT_REALTIME; if (!ns) throw new Error('hono-preact: rooms on Cloudflare require the HONO_PREACT_REALTIME Durable Object binding. Add it to wrangler.jsonc (see the rooms docs).'); const stub = ns.get(ns.idFromName(topic)); const fwd = new Request(c.req.raw, { headers: new Headers(c.req.raw.headers) }); fwd.headers.set('x-hp-topic', topic); ...set module/name/params(JSON)/data(JSON)...; return stub.fetch(fwd); }`. Size-bound the `x-hp-data`/`x-hp-params` headers; if oversized, deny with a clear error.

- [ ] **Step 6: Verify** what is verifiable in plain vitest now (the DO transport + engine are already covered; the DO glue is covered by the integration test in Task 8). Typecheck against `@cloudflare/workers-types` (added as a devDependency in Task 6). Commit.
```bash
pnpm format && git add packages/server/src/cf/realtime-do.ts
git commit -m "feat(server): HonoPreactRealtimeDO hibernating room runtime + forward connector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Cloudflare adapter codegen (re-export DO, install connector, registry module)

Wire the CF adapter so the generated worker entry exports the DO class and installs the forward connector, and so the DO can reach the room registry.

**Files:**
- Modify: `packages/vite/src/adapter-cloudflare.ts` (`wrapEntry` emits the DO re-export + connector install + the `serverImports` module reference)
- Modify: `packages/vite/package.json` (devDependency `@cloudflare/workers-types`)
- Modify: `packages/server/src/internal-runtime.ts` exports (expose `HonoPreactRealtimeDO`, `makeCfForwardConnector`, `installRealtimeConnector` on the server `/internal/runtime` door)
- Create/confirm: the generated `serverImports` module path the DO imports (coordinate with how `coreAppModuleId` exposes the routes manifest)
- Modify: `packages/vite/src/__tests__/` (a `wrapEntry` output test asserting the emitted source)

**Interfaces produced:**
- `cloudflareAdapter().wrapEntry(ctx)` now emits (concept):
```ts
import coreApp from '<coreAppModuleId>';
import {
  HonoPreactRealtimeDO as __HP_DO,
  makeCfForwardConnector, installRealtimeConnector,
} from 'hono-preact/server/internal/runtime';
installRealtimeConnector(makeCfForwardConnector((c) => c.env.HONO_PREACT_REALTIME));
export class HonoPreactRealtimeDO extends __HP_DO {}
export default coreApp;
```

- [ ] **Step 1: Add `@cloudflare/workers-types`** to `packages/vite` (and `packages/server` if the DO file needs the types) devDependencies; `pnpm install`. Confirm the DO file typechecks (`DurableObject`, `DurableObjectState`, `WebSocketPair`, `DurableObjectNamespace`).

- [ ] **Step 2: Update `wrapEntry`** to emit the source above. The DO subclass re-export is needed so wrangler's `class_name: "HonoPreactRealtimeDO"` resolves against the worker's exports. The connector install runs at module top level (boot). Confirm the DO's `serverImports` source: the simplest is for the DO module to import the same routes-manifest-derived `serverImports` the core app uses; if `coreAppModuleId` does not already export it, add an export there (or a sibling generated module) and import it in `realtime-do.ts`. Document the exact path.

- [ ] **Step 3: Test the emitted entry** (a vite unit test, mirror any existing `wrapEntry` test): assert the output contains the DO re-export class, the `installRealtimeConnector(makeCfForwardConnector(...))` call, and the `export default coreApp`. No workerd needed for this string assertion.

- [ ] **Step 4: Commit.**
```bash
pnpm format && git add packages/vite/src/adapter-cloudflare.ts packages/vite/package.json packages/server/src/internal-runtime.ts packages/vite/src/__tests__/ pnpm-lock.yaml
git commit -m "feat(vite): Cloudflare adapter re-exports the realtime DO + installs the forward connector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: wrangler binding + migration (scaffolder template, apps/site) + setup docs

**Files:**
- Modify: `packages/create-hono-preact/templates/cloudflare/wrangler.jsonc` (add the DO binding + migration)
- Modify: `apps/site/wrangler.jsonc` (add the DO binding + migration)
- Modify: `apps/site/src/pages/docs/rooms.mdx` (a "Running rooms on Cloudflare" section: the ~6-line binding/migration + the fixed binding name + the deferred-sockets/onJoin-teardown notes)
- Modify: `packages/create-hono-preact/__tests__/scaffold-integration.test.ts` if it asserts wrangler contents

- [ ] **Step 1: Add to both wrangler configs:**
```jsonc
"durable_objects": {
  "bindings": [{ "name": "HONO_PREACT_REALTIME", "class_name": "HonoPreactRealtimeDO" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["HonoPreactRealtimeDO"] }]
```

- [ ] **Step 2: Confirm the scaffold-integration build still passes** (`pnpm test:integration` builds the cloudflare template; the binding must not break the build). The DO class must be exported by the generated entry (Task 6) for wrangler to validate `class_name`. Run `pnpm test:integration`.

- [ ] **Step 3: Docs** (`rooms.mdx`): add the Cloudflare setup section (binding + migration, fixed name), the note that plain sockets and `onJoin` teardowns are Node-only, and that the docs site itself now runs the live cursors demo (Task 9). Keep canonical structure (re-run the docs-structure gate). No em-dashes, no historical breadcrumbs.

- [ ] **Step 4: Commit.**
```bash
pnpm format && git add packages/create-hono-preact/templates/cloudflare/wrangler.jsonc apps/site/wrangler.jsonc apps/site/src/pages/docs/rooms.mdx packages/create-hono-preact/__tests__/scaffold-integration.test.ts
git commit -m "feat: wrangler DO binding + migration (scaffolder + site) and Cloudflare rooms setup docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Cloudflare DO integration test (workerd)

The real validation of the hibernation glue + worker->DO forwarding, mirroring the existing `websocket-dev.test.ts` CF pattern.

**Files:**
- Create: `packages/vite/src/__tests__/fixtures/cf-room/` (a minimal app: a `defineChannel('room/:id')` room with `onMessage(conn,msg){conn.broadcast(msg)}`, a `routes.ts`, `vite.config.ts` using `cloudflareAdapter()`, a `wrangler.jsonc` with the DO binding/migration)
- Create: `packages/vite/src/__tests__/cf-room.test.ts` (added to `vitest.integration.config.ts` include)
- Modify: `vitest.integration.config.ts` (include the new test)

- [ ] **Step 1: Build the fixture** room app under `fixtures/cf-room/` (smallest thing that registers a room + the DO binding, served via `@cloudflare/vite-plugin` dev like the `cf-ws` fixture).

- [ ] **Step 2: Write the integration test:** start the fixture (mirror `websocket-dev.test.ts`'s CF dev-server startup), connect two real `ws` clients to `/__sockets?m=&s=&r={"id":"demo"}`. Assert: client B receives client A's `{t:'msg'}` broadcast and A does not (intra-DO sender-exclude); B sees A in the snapshot/presence roster; A's close removes it from B's roster (presence leave). If a hibernation-wake simulation is feasible through the harness, assert the roster survives; if not, document that the dogfood covers wake. Add to `vitest.integration.config.ts`.

- [ ] **Step 3: Run** `pnpm test:integration` -> PASS (or, if workerd cannot run in the executing environment, run it where it can and record the result; the dogfood is the backstop). Commit.
```bash
pnpm format && git add packages/vite/src/__tests__/fixtures/cf-room/ packages/vite/src/__tests__/cf-room.test.ts vitest.integration.config.ts
git commit -m "test(vite): Cloudflare DO room integration test (two ws clients, intra-DO fan-out)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: dogfood live cursors on the workerd site

The payoff: cursors fanning out cross-isolate on the deployed docs site.

**Files:**
- Create: `apps/site/src/pages/<cursors-demo>.server.ts` (a cursors room; reuse the `apps/example-node` shape) and a demo component, or add to the existing `/demo`
- Modify: `apps/site/src/routes.ts` (wire the `.server` module for registry discovery, mirror the PR 4 example-node wiring)
- Confirm: `apps/site/wrangler.jsonc` binding (Task 7) is present

- [ ] **Step 1: Add the cursors room + demo** to the site (the `data: (c) => Data` + `setPresence({x,y})` + render-others-from-roster pattern from PR 4's example-node dogfood). Wire the `.server` module into `routes.ts`.

- [ ] **Step 2: Verify the site builds** (`pnpm --filter site build`) and the client-size/Lighthouse impact is acceptable (update baselines if the gates require). Optionally run the site via `wrangler dev` / the vite CF dev and open two tabs to confirm cursors fan out (note: MCP browser cannot verify; manual or scripted ws is the check).

- [ ] **Step 3: Commit.**
```bash
pnpm format && git add apps/site/src/pages/ apps/site/src/routes.ts apps/site/wrangler.jsonc
git commit -m "feat(site): live cursors room dogfood on the workerd site

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: pre-merge gate + open PR + deep review

- [ ] **Rebuild dist FIRST** (this PR changes iso/server/vite public types; stale dist masks app/test-d failures, as PR 4 learned): `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`.
- [ ] Then the full gate in CI order: `format:check`, `typecheck`, `test:types`, `test:coverage` (the `measure-client-size` sandbox failure passes with resources allowed), `test:integration`, `pnpm --filter site build`. `git status` clean.
- [ ] Merge `origin/main` in (it moves), re-run the docs-structure gate + site build, fix any conformance.
- [ ] Open the PR; run the deep review immediately. **Replacement parity:** the Node room runtime now drives the shared engine, confirm every PR 4 + ultrareview behavior survives (the unchanged PR 4 tests are the evidence; read the room-engine diff against the old `rooms-handler` inline logic). The `onJoin({c})` -> `data(c)` API change is intentional and pre-release. **Cross-cutting:** the guard chain still runs at the edge before any DO forward; the topic is still server-computed (no client-supplied topic reaches the DO); the missing-binding error path; the onJoin-teardown CF semantics are documented.

---

## Self-Review

**Spec coverage (PR 5a):** edge/DO split + data flow: Tasks 4, 5. One DO per topic / `idFromName`: Task 5. Room runtime in the DO: Tasks 2 (engine), 3 (CF transport), 5 (DO glue). Intra-DO fan-out: Tasks 3, 5. `data: (c) => Data` API refinement: Task 1. Attachment-based presence: Tasks 3, 5. Shared engine + behavior-preserving Node refactor: Task 2. Framework DO class + dev-owned binding: Tasks 5, 6, 7. Scaffolder template: Task 7. Testing (engine / Node-unchanged / CF workerd): Tasks 2, 3, 8. Dogfood: Task 9. Deferred sockets-on-CF + reconnect-replay + onJoin-teardown: documented in Tasks 5, 7. Gate + deep review: Task 10.

**Placeholder check:** the genuinely workerd-specific glue (Task 5) is structured as a spike-then-implement against confirmed shapes plus the Task 8 integration test, rather than pre-baked unverified workerd calls; the spike Step 1 gates the path and must report if `stub.fetch` upgrade forwarding does not behave as assumed. The generated `serverImports`-for-DO module path is named as a concrete decision in Tasks 5/6, not left open.

**Type consistency:** `RoomTransport` (Task 2) is the single interface implemented by the Node transport (Task 2) and the CF transport (Task 3) and consumed by the engine (Task 2) and the DO (Task 5). `RoomConnectContext`/`RealtimeConnector` (Task 4) match `makeCfForwardConnector` (Task 5) and the adapter install (Task 6). `RoomConnAttachment` (Task 3) is what the DO serializes (Task 5). `HONO_PREACT_REALTIME` / `HonoPreactRealtimeDO` are identical across Tasks 5, 6, 7.

## Open risks to confirm during implementation

1. **Spike gates everything (Task 5 Step 1).** If forwarding a WS upgrade via `stub.fetch` does not return a working 101 through the worker, or `acceptWebSocket` + attachments do not behave as assumed, stop and escalate before building the full DO.
2. **workerd in the executing environment.** The CF integration test (Task 8) and the spike need workerd; the existing `websocket-dev.test.ts` CF suite runs it, so the harness exists, but confirm it runs where the plan is executed. If not, the dogfood (Task 9) is the validation of record and Task 8 runs in CI.
3. **Behavior-preserving Node refactor (Task 2).** The unchanged PR 4 + ultrareview suites are the contract; any required test edit is a regression signal.
4. **`onJoin` teardown on CF** is unsupported (cannot survive hibernation); documented as Node-only, with `onLeave` the portable cleanup hook.
5. **Header size limits** for forwarded `params`/`data` (Task 5 Step 5); bound them and deny clearly when exceeded.
6. **Site bundle + Lighthouse gates** grow with the DO + room client (Task 9); update baselines if required.
