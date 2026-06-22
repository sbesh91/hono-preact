# Realtime PR 4: rooms + presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add broadcasting **rooms** (`defineRoom`/`route.room` + a `useRoom` client hook) and **presence** (live membership + per-member state) on top of the merged socket primitive (PR 3), pub/sub backend (PR 2), and channels (PR 1). Node-only fan-out (cross-process is PR 5's Durable Object).

**Architecture:** A room is a `defineSocket`-shaped server handler bound to a typed `Channel` (the channel name carries the room-key params, e.g. `room/:roomId`; the channel topic is the broadcast key). It rides the existing `/__sockets` WS transport and guard chain. On connect: resolve `channel.key(roomKey)` from a new room-key URL param, `getPubSubBackend().subscribe(topic, cb)`, register the connection in a process-global presence map, send the joining client a member snapshot, publish a join delta, run `onJoin`. `message` runs `onMessage(conn, msg)`; `conn.broadcast(msg)` publishes a sender-tagged envelope to the topic (each connection's subscribe cb skips its own `from` id, so broadcast excludes the sender by default). `close` publishes a leave delta, unsubscribes, runs `onLeave`. Reconnect re-joins + re-syncs presence (no replay; that is PR 5). Two PR-3-deferred seams are resolved here: the room key rides one new query param, and route-node `use` inheritance is wired (and retrofitted onto sockets). This is PR 4 of the 5-PR program (spec: `docs/superpowers/specs/2026-06-20-first-class-realtime-design.md`); PRs 1-3 are merged.

**Tech Stack:** TypeScript, Hono + `@hono/node-ws`, the in-process `PubSubBackend`, Preact hooks, Vitest.

## Global Constraints

- **No em-dashes** anywhere. No new `as` casts beyond the sanctioned boundaries already used (JSON.parse of untrusted wire; the def-doubles-as-ref pattern mirroring `defineSocket`/`defineAction`). Reshape otherwise; tests may use a documented stub cast for a field the code under test does not read.
- **Discriminated-union messages, types-only validation; `Serialize<T>` on the wire** (match sockets/actions/loaders).
- **Reuse, do not fork.** Rooms ride the existing `/__sockets` transport, the `socketsHandler` upgrade/guard machinery, the `PubSubBackend` (`getPubSubBackend().subscribe`/`publish`), and `defineChannel`. Do not add a second WS endpoint or a second pub/sub.
- **Decided behavior:** reconnect-replay is OUT (deferred to PR 5); `conn.broadcast(msg)` excludes the sender by default (`broadcast(msg, { self: true })` to include); route-node `use` inheritance is wired for rooms AND retrofitted onto sockets (shared resolver).
- **Presence is tracked above pub/sub** in a process-global `Map` (the per-topic subscriber Set is NOT a safe presence source: no enumerate API on `PubSubBackend`, opaque callbacks, auto-deletes when empty, would not port to the DO backend).
- **Node-only.** In-process fan-out (one process). Cross-process rooms/presence are PR 5's DO backend, installed through the existing `installPubSubBackend` seam.
- **Pre-merge gate** (mirror CI): build, `format:check`, `typecheck`, `test:types`, `test:coverage`, `test:integration`, `pnpm --filter site build`.
- Commits land on `realtime-pr4-rooms-presence` (based on `main` with PRs 1-3 merged).

---

### Task 1: room wire contract + envelope + presence types

**Files:**
- Modify: `packages/iso/src/internal/contract.ts` (add `SOCKET_ROOM_PARAM = 'r'`, `FORM_ROOM_FIELD = '__room'`)
- Create: `packages/iso/src/internal/room-envelope.ts` (the on-topic envelope + presence delta types + encode/decode)
- Test: `packages/iso/src/internal/__tests__/room-envelope.test.ts`

**Interfaces produced:**
- contract: `SOCKET_ROOM_PARAM = 'r'` (the URL query carrying the interpolated room key/topic), `FORM_ROOM_FIELD = '__room'` (the client room-stub descriptor field).
- `room-envelope.ts`: `type RoomEnvelope<Msg, State>` = a discriminated union `{ from: string; t: 'msg'; msg: Msg } | { from: string; t: 'presence'; op: 'join' | 'update' | 'leave'; state?: State } | { t: 'snapshot'; members: Array<{ id: string; state: State }> }`; pure `encodeEnvelope`/`decodeEnvelope` is just `JSON.stringify`/`JSON.parse` typed at the one wire boundary (mirror how loaders/actions treat the wire). Provide `type PresenceMember<State> = { id: string; state: State }`.

- [ ] **Step 1: Add the contract constants** (next to `SOCKET_MODULE_PARAM`/`SOCKET_NAME_PARAM` in `contract.ts`):

```ts
/** Query param carrying the interpolated room key (channel.key(params)) for a room connection. */
export const SOCKET_ROOM_PARAM = 'r';
/** Client room-stub descriptor field (the channel name pattern). */
export const FORM_ROOM_FIELD = '__room';
```

- [ ] **Step 2: Write the failing envelope test** then implement `room-envelope.ts`.

Create `packages/iso/src/internal/__tests__/room-envelope.test.ts` asserting: a `'msg'` envelope round-trips with its `from`; a `'presence'` `join`/`update`/`leave` carries `from` + optional `state`; a `'snapshot'` carries `members`. Keep it pure (no I/O). Then implement `room-envelope.ts` with the union type + `encodeEnvelope(e): string` (`JSON.stringify(e)`) and `decodeEnvelope(raw): RoomEnvelope<...>` (`JSON.parse(raw)` as the single sanctioned wire cast, comment it).

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @hono-preact/iso exec vitest run src/internal/__tests__/room-envelope.test.ts` -> PASS.
```bash
cd /Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/first-class-realtime
pnpm format
git add packages/iso/src/internal/contract.ts packages/iso/src/internal/room-envelope.ts packages/iso/src/internal/__tests__/room-envelope.test.ts
git commit -m "feat(iso): room wire contract + presence/message envelope

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: wire route-node `use` inheritance into the socket/room handler (shared seam)

**Files:**
- Modify: `packages/server/src/sockets-handler.ts` (`SocketsHandlerOptions` gains `resolvePageUse`; use it + the route path instead of `() => []` / `/__sockets`)
- Modify: `packages/server/src/create-server-entry.ts` (pass `pageUseResolver.byPath`)
- Test: extend `packages/server/src/__tests__/sockets-handler.test.ts`

**Interfaces:**
- Consumes: `pageUseResolver` (already built in `create-server-entry.ts`; `makePageUseResolver` in `route-server-modules.ts`), `composeServerChain` (accepts async `resolvePageUse(path)`).
- Produces: `SocketsHandlerOptions.resolvePageUse?: (path: string) => ... ` + `routePath` per registry entry (so a socket/room resolves its node `use`).

- [ ] **Step 1: Read** `packages/server/src/create-server-entry.ts` (how `loadersHandler`/`pageActionHandler` get `pageUseResolver.byPath`), `route-server-modules.ts` `makePageUseResolver`, and `compose-server-chain.ts`. Mirror exactly.

- [ ] **Step 2:** Add `resolvePageUse?: (path: string) => ReadonlyArray<Middleware> | Promise<...>` to `SocketsHandlerOptions`; replace `resolvePageUse: () => []` (sockets-handler.ts ~line 99) with `opts.resolvePageUse ?? (() => [])`, and the `path: SOCKETS_RPC_PATH` (~line 100) with the unit's **route path** when known. A socket/room registry entry must carry its route path (the `route.socket`/`route.room` routeId, or the def's module route). If sockets currently lack a route path on the registry entry, add it to `buildSocketRegistry` (read `route.socket`'s routeId; for bare `defineSocket` with no route, fall back to `SOCKETS_RPC_PATH` and no page-use). Document that bare (non-route) sockets get app-use + def-use only.

- [ ] **Step 3:** In `create-server-entry.ts`, pass `resolvePageUse: pageUseResolver.byPath` to `socketsHandler({ ... })`.

- [ ] **Step 4:** Extend `sockets-handler.test.ts`: a socket/room whose route node has a `use` that denies closes `WS_DENY_CODE` (proving route-node `use` now runs); a route node with allow `use` lets `open` run. Mirror the existing deny test.

- [ ] **Step 5: Run + commit**

Run: `pnpm exec vitest run packages/server/src/__tests__/sockets-handler.test.ts` -> PASS.
```bash
pnpm format
git add packages/server/src/sockets-handler.ts packages/server/src/create-server-entry.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "feat(server): route-node use inheritance for sockets/rooms (shared resolvePageUse)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(This retrofits route-node `use` onto sockets too; update the PR 3 docs note in `websockets.mdx` in Task 7.)

---

### Task 3: `defineRoom` / `route.room` + the room connection API

**Files:**
- Create: `packages/iso/src/define-room.ts`
- Modify: `packages/iso/src/server-route.ts` (add `room` to `RouteServer`)
- Test: `packages/iso/src/__tests__/define-room.test-d.ts`, `define-room.test.ts`

**Interfaces produced:**
- `RoomConnection<Msg, State, Data>`: `{ readonly id: string; send(msg: Msg): void; broadcast(msg: Msg, opts?: { self?: boolean }): void; setPresence(state: State): void; data: Data; close(code?: number, reason?: string): void }`.
- `RoomHandler<Incoming, Outgoing, State, Data, Params>`: `{ use?; presence?: () => State /* initial self state */; onJoin?(conn, ctx: { c; params: Params }): void | (() => void) | Promise<...>; onMessage?(conn, msg: Incoming): void | Promise<void>; onLeave?(conn): void; onError?(conn, err): void }`.
- `RoomRef<Incoming, Outgoing, State>`: client descriptor `{ [FORM_MODULE_FIELD]?, [FORM_ROOM_FIELD]?, ... }` + a `key(params): RoomHandle` + a `useRoom(opts?)` method (Task 6 supplies the hook type).
- `defineRoom(channel, handler): RoomRef`; `RouteServer.room(channel, handler): RoomRef` (route form types `params`).

- [ ] **Step 1: Read** `packages/iso/src/define-socket.ts` (mirror the def-doubles-as-ref shape + the `SocketRef` stub-field pattern), `packages/iso/src/server-route.ts` (the `socket` method to parallel), and `define-channel.ts` (`Channel`/`Topic`/`.key`). The room binds to a `Channel<Name, Payload>`; the channel's `RouteParams<Name>` type the room key.

- [ ] **Step 2: Type contract test** (`define-room.test-d.ts`): `route.room(roomChannel, { onMessage(conn, msg) { conn.broadcast(msg) }, ... })` infers `msg: Incoming`, `conn.send`/`broadcast` accept `Outgoing`, `conn.setPresence` accepts `State`, and `ctx.params` from the CHANNEL name (rooms get the typed params sockets deferred, because the room key is on the wire). `@ts-expect-error` on a wrong outgoing/state shape.

- [ ] **Step 3: Implement `define-room.ts`.** `defineRoom(channel, handler)` returns a `RoomRef` whose runtime value carries the channel + handler (the def the server reads), typed as the client `RoomRef` (one sanctioned def-doubles-as-ref cast, mirror `defineSocket`). Add `room` to `RouteServer` + the `serverRoute` factory (`room: (channel, handler) => defineRoom(channel, handler)`), with `ctx.params` typed `RouteParams<RouteId>` (the route binds the params; verify with the type test).

- [ ] **Step 4: Run + commit** (type test + a small runtime test that `defineRoom` returns the handler/channel). 
```bash
pnpm exec vitest run --typecheck.only packages/iso/src/__tests__/define-room.test-d.ts
pnpm --filter @hono-preact/iso exec vitest run src/__tests__/define-room.test.ts
pnpm format && git add packages/iso/src/define-room.ts packages/iso/src/server-route.ts packages/iso/src/__tests__/define-room.test-d.ts packages/iso/src/__tests__/define-room.test.ts
git commit -m "feat(iso): defineRoom + route.room typed room definition + connection API

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: presence subsystem + the room runtime (server)

**Files:**
- Create: `packages/iso/src/internal/presence.ts` (process-global membership registry)
- Create: `packages/server/src/rooms-handler.ts` (the room runtime: subscribe + broadcast + presence, served via the socket transport) OR extend `sockets-handler.ts` to serve room defs
- Modify: `packages/server/src/create-server-entry.ts` (collect `serverRooms` into the registry the `/__sockets` handler resolves)
- Test: `packages/iso/src/internal/__tests__/presence.test.ts`, `packages/server/src/__tests__/rooms-handler.test.ts`

**Interfaces produced:**
- `presence.ts`: `joinRoom(topic, connId, state): void`, `leaveRoom(topic, connId): void`, `updatePresence(topic, connId, state): void`, `roomMembers(topic): PresenceMember[]` over a process-global `Map<topic, Map<connId, state>>` keyed by `Symbol.for('@hono-preact/presence')` (mirror `inProcessBackend`'s globalThis pattern). Pure of transport.
- `rooms-handler` (or socketsHandler extension): given a resolved `RoomDef` + the room key (from `SOCKET_ROOM_PARAM`), build a connection: assign `connId` (`crypto.randomUUID()`), `subscribe(topic, env => { ... })` filtering `env.from !== connId` for broadcast and applying presence deltas locally is the CLIENT's job; the server's subscribe cb forwards `env` to `socket.send` EXCEPT skips an envelope whose `from === connId` when it is a `'msg'` (sender-exclude) ... see Step 2 for the exact fan-out rule.

- [ ] **Step 1: Implement + test `presence.ts`** (join/leave/update/members over the globalThis `Map`, mirroring `pubsub.ts`'s accessor). Test fan: join two conns, members lists both; update changes state; leave removes; empty topic prunes.

- [ ] **Step 2: Implement the room runtime.** Decide and document: rooms are served by the existing `/__sockets` handler by registering room defs into the same registry the handler resolves (the handler detects a room def vs a socket def and applies the room wiring), OR a sibling `roomsHandler` mounted by `create-server-entry`. Either way the room's `open` (server-side):
  1. resolve `topic = ctx.c.req.query(SOCKET_ROOM_PARAM)` (the interpolated `channel.key(params)` sent by the client); validate it is non-empty (else close `WS_DENY_CODE`). The room's `use` guard (incl. route-node use from Task 2) has already authorized the connection.
  2. `connId = crypto.randomUUID()`.
  3. `const unsub = getPubSubBackend().subscribe(topic, (raw) => { const env = decodeEnvelope(raw); if (env.t === 'msg' && env.from === connId) return; socket.send(env); })` (sender-exclude for `'msg'`; presence deltas always forwarded; `self:true` broadcasts publish with a flag that bypasses the skip, e.g. a `to: 'all'` marker on the envelope, so the cb does not skip).
  4. `joinRoom(topic, connId, initialState)`; send the joining socket a `'snapshot'` envelope (`roomMembers(topic)`); `publish(topic, { from: connId, t: 'presence', op: 'join', state })`.
  5. build the `RoomConnection` (`broadcast(msg, opts) => publish(topic, { from: connId, t: 'msg', msg, ...(opts?.self ? { self: true } : {}) })`; `setPresence(state) => { updatePresence(topic, connId, state); publish(topic, { from: connId, t: 'presence', op: 'update', state }) }`; `send(msg) => socket.send({ from: connId, t: 'msg', msg })`).
  6. run `handler.onJoin(conn, { c, params })`; return a teardown that: `leaveRoom`, `publish(leave delta)`, `unsub()`, `handler.onLeave(conn)`.
  `message` decodes the client frame to `Incoming` and calls `handler.onMessage(conn, msg)`.

- [ ] **Step 3: Test `rooms-handler`** with a fake upgrader + fake ws (mirror `sockets-handler.test.ts`): two connections to the same room key; conn A `broadcast` reaches B but NOT A (sender-exclude); a join publishes a presence join that B receives; the snapshot is sent to a newly-joined conn; close publishes leave + unsubscribes + removes from presence.

- [ ] **Step 4: Run + commit** (presence test + rooms-handler test).
```bash
pnpm format && git add packages/iso/src/internal/presence.ts packages/server/src/rooms-handler.ts packages/server/src/create-server-entry.ts packages/iso/src/internal/__tests__/presence.test.ts packages/server/src/__tests__/rooms-handler.test.ts
git commit -m "feat: room runtime (subscribe/broadcast/presence) + process-global presence registry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `serverRooms` codegen (vite)

**Files:**
- Modify: `packages/vite/src/server-exports-contract.ts` (add `'serverRooms'`)
- Modify: `packages/vite/src/server-loader-validation.ts` (accept `serverRooms`)
- Modify: `packages/vite/src/stub-templates.ts` (add `roomStubSource`, mirror `socketStubSource`)
- Modify: `packages/vite/src/server-only.ts` (`serverRooms` branch + `needsUseRoomImport` prepend)
- Test: `packages/vite/src/__tests__/server-rooms-stub.test.ts`

- [ ] **Step 1:** Add `'serverRooms'` to `RECOGNIZED_SERVER_EXPORTS`; widen the validation "must export one of" check; mirror the `serverSockets` work in Task 3 of PR 3 exactly. `roomStubSource` builds `{ [FORM_MODULE_FIELD]: moduleKey, [FORM_ROOM_FIELD]: name }` and attaches `.useRoom = (opts) => __$useRoom_hpiso(stub, opts)`; `server-only.ts` prepends `import { useRoom as __$useRoom_hpiso } from 'hono-preact'` when `serverRooms` is imported. Rooms follow the socket registry model (no per-entry module-key threading; `buildRoomRegistry` keys by `moduleKey::name`).

- [ ] **Step 2:** Test (mirror `server-sockets-stub.test.ts`): a client import of `serverRooms` rewrites to the descriptor proxy with `__module`/`__room` + `.useRoom` + the prepended import; a room-only `.server` file passes validation. Run the new test + the existing `server-only-plugin` + `server-loader-validation-plugin` suites.

- [ ] **Step 3: Commit** (`feat(vite): serverRooms .server export recognition + client stub`).

---

### Task 6: `useRoom` client hook (presence-aware)

**Files:**
- Create: `packages/iso/src/use-room.ts`
- Test: `packages/iso/src/__tests__/use-room.test.tsx`

**Interfaces produced:**
- `useRoom<R>(ref, opts?)` -> `{ send(msg: Incoming<R>): void; broadcast(msg, opts?): void; status: SocketStatus; members: ReadonlyArray<PresenceMember<State<R>>>; self?: PresenceMember<State<R>>; setPresence(state: State<R>): void; close() }`. `opts`: `{ key: <channel params>; presence?: State; onMessage?(msg: Serialize<Outgoing<R>>, from: string); reconnect?; enabled? }`.

- [ ] **Step 1: Read** `packages/iso/src/use-socket.ts` (reuse its connection/status/reconnect machinery; `useRoom` is `useSocket` + presence state + the `SOCKET_ROOM_PARAM` and an envelope decoder). Factor the shared connect/reconnect into a small internal helper if it keeps both hooks DRY without over-abstracting; otherwise mirror.

- [ ] **Step 2: Implement `useRoom`.** It opens the same `/__sockets` connection with the extra `&r=<channel.key(opts.key)>` param, decodes each incoming `RoomEnvelope`: `'snapshot'` seeds `members`; `'presence' join/update/leave` mutate `members`; `'msg'` calls `opts.onMessage(env.msg, env.from)`. `members` (+ `self`) is reactive state; per-message data goes to the callback (no per-frame re-render). `send`/`broadcast`/`setPresence` post the corresponding client frames. `isBrowser()` SSR-guard; reconnect re-joins (re-sends presence, re-receives snapshot, the brief membership gap is expected, no replay). The only cast is the JSON.parse wire boundary.

- [ ] **Step 3: Test** with a fake `WebSocket` (mirror `use-socket.test.tsx`): a snapshot seeds `members`; a join/leave delta updates `members`; a `'msg'` envelope hits `onMessage` with `from`; status transitions; reconnect re-joins. Run + commit (`feat(iso): useRoom presence-aware client hook`).

---

### Task 7: public exports + docs

- [ ] Export `defineRoom`, `useRoom`, types (`RoomRef`, `RoomHandler`, `RoomConnection`, `PresenceMember`) from `packages/iso/src/index.ts`; add the `useRoom`/`defineRoom` runtime assertions to `public-exports.test.ts`. Follow `.claude/skills/add-docs-page.md`: add a "Rooms & presence" docs page (or section) documenting `route.room`/`defineRoom`, `conn.broadcast`/`send`/`setPresence` (sender-excluded broadcast), `useRoom` (`members`/`self`/`send`/`broadcast`), the room-key params, and the dividing line (rooms = multi-connection fan-out; in-process on Node, DO for cross-process in a later release; no reconnect-replay yet). Update the PR-3 `websockets.mdx` note now that route-node `use` DOES inherit (Task 2). Run `pnpm --filter site build` (llms). Commit.

---

### Task 8: dogfood, live cursors in apps/example-node

- [ ] Add a `serverRooms` room (e.g. `cursors.server.ts`) keyed by a `defineChannel('cursors/:room')` channel; `onMessage`/`setPresence` carry `{ x, y }` cursor state; `conn.broadcast`/presence fan out. Add a `CursorsDemo` to the example-node home page using `serverRooms.cursors.useRoom({ key: { room: 'demo' }, presence: { x: 0, y: 0 }, onMessage })` that renders other members' cursors from `members` and `setPresence` on pointermove. Wire the room's `.server` module into `routes.ts` for registry discovery (mirror the PR-3 chat dogfood). Verify: `pnpm typecheck`; optionally `pnpm --filter example-node dev`, open two tabs at the page, move the mouse, see the other tab's cursor (in-process fan-out). Add a Node integration test (two real `ws` clients to the same room: A's broadcast reaches B not A; B sees A's presence join). Commit.

---

### Task 9: pre-merge gate

- [ ] build, `format:check`, `typecheck`, `test:types`, `test:coverage` (the `measure-client-size` sandbox failure passes with resources allowed), `test:integration`, `pnpm --filter site build`. `git status` clean; open the PR and run the deep review immediately (replacement parity: route-node `use` now inherits onto sockets, confirm the PR-3 documented behavior is intentionally changed and the docs updated; cross-cutting: the room guard chain + the sender-exclude fan-out correctness).

---

## Self-Review

**Spec coverage (PR 4 row):** rooms (`defineRoom`/`route.room` + connection API): Tasks 3-4; presence (membership + state + join/leave/snapshot): Tasks 1, 4, 6; `serverRooms` codegen: Task 5; `useRoom`: Task 6; route-node `use` inheritance (the deferred seam): Task 2; sender-excluded broadcast (decided): Task 4; live-cursors dogfood: Task 8. Reconnect-replay: deferred to PR 5 (decided), documented in Task 7. CF cross-process: PR 5.

**Placeholder check:** the contract/envelope/presence/guard-wiring have concrete code; the room runtime (Task 4) and `useRoom` (Task 6) specify the exact composition + envelope rules but leave some bodies as "mirror `sockets-handler`/`use-socket`" because they depend on those current internals (cited). The implementer reads the cited files and mirrors.

**Type consistency:** `RoomEnvelope`, `PresenceMember`, `RoomConnection`, `RoomHandler`, `RoomRef`, `SOCKET_ROOM_PARAM`/`FORM_ROOM_FIELD` are used identically where defined (Tasks 1, 3) and consumed (Tasks 4, 5, 6, 8). `broadcast(msg, { self? })` (Task 3 API) matches the publish-with-self-flag fan-out rule (Task 4) and the client decode (Task 6).

## Open risks to confirm during implementation

1. **Sender-exclude needs a stable per-connection id across the publish/subscribe loop** (`connId`); confirm the envelope `from` + the subscribe-cb skip is the right mechanism (the in-process backend delivers to all subscribers including the sender's own cb). The `self: true` opt must bypass the skip, design the envelope flag so the cb can tell.
2. **Rooms-on-/__sockets vs a sibling endpoint** (Task 4 Step 2): pick one; reusing `/__sockets` + a unified registry is leaner but the handler must branch socket-vs-room. Decide early; it shapes Tasks 4-5.
3. **Route-node `use` retrofit onto sockets** (Task 2) changes PR-3-documented behavior (sockets previously did NOT inherit route-node `use`); ensure the docs note is updated (Task 7) and the deep review treats it as an intentional change, not a regression.
