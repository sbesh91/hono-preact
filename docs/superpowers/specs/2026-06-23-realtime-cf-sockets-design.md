# Plain duplex sockets on Cloudflare (#169) — design

**Status:** approved 2026-06-23, ready for implementation plan.

**Issue:** [#169](https://github.com/sbesh91/hono-preact/issues/169) "Support plain duplex sockets (useSocket) on Cloudflare (deferred from PR5a)".

**Goal:** make the plain duplex socket primitive (`defineSocket` / `route.socket`, consumed with `useSocket`) work end to end on a `cloudflareAdapter()` deploy. Today it is Node-only: on a forwarding (Cloudflare) adapter a plain socket falls through to `getWebSocketUpgrader()`, which is not installed on CF, so it surfaces the documented "no upgrader installed" error. Rooms and live loaders already work on Cloudflare (PR5a #166, PR5b #168); this closes the last gap.

## Decision (locked during brainstorming)

A plain socket on Cloudflare **terminates in a fresh per-connection Durable Object**, not in the worker isolate.

The CF worker stays a pure guard-and-forward edge. After the guard chain allows the upgrade, the worker forwards it to a brand-new ephemeral DO (`ns.get(ns.newUniqueId())`); the socket handler runs inside that DO under the WebSocket Hibernation API. This keeps ONE model for live WebSocket handling on Cloudflare (everything runs in a DO; the worker only guards, then forwards or denies), which is Cloudflare's documented rule for long-lived connections, and it reuses the PR5a forward + DO machinery almost entirely.

The rejected alternative (terminate the socket in the worker via `WebSocketPair` + `accept`) was smaller but ships a primitive with production caveats Cloudflare explicitly warns against: the connection is bound to the isolate (dropped on eviction), gets no hibernation, and bills for the whole connection duration. A plain socket is reconnect-tolerant by design, but "long-lived WebSocket connections that survive across requests" is the canonical Durable Object use case, so the DO path is the correct design on merit.

**Dogfood / proof:** a workerd integration test mirroring `cf-room.test.ts` is the required proof; no site demo (plain sockets were already dogfooded in `apps/example-node` in PR3, and every compelling realtime surface on the docs site is better served by a room or a live loader, so a 1:1 socket demo would be a contrived echo/ping toy).

## Architecture

```
client useSocket  ──GET /__sockets?m=&s=──►  CF worker (socketsHandler)
                                              │
                                              │ resolveConnection: guard chain
                                              │   (app use → route-node use → def.use)
                                              ▼
                                       allowed?  ──no──►  connector({kind:'deny'})
                                              │              (WebSocketPair close 4403,
                                              │               no DO contact)
                                             yes
                                              │  run socketDef.data?.(c)  (edge factory)
                                              ▼
                            connector({kind:'socket-forward', moduleKey, name, data})
                                              │  ns.get(ns.newUniqueId())
                                              │  x-hp-kind: socket + x-hp-module/name/data
                                              ▼
                            HonoPreactRealtimeDO.fetch  (per-connection DO)
                                              │  acceptWebSocket(server)  (hibernation)
                                              │  attachment {kind:'socket', moduleKey, name, data}
                                              │  socketDef.open(socket)
                                              ▼
              webSocketMessage / Close / Error  ──►  socketDef.message / close / error
```

The client and the `/__sockets` wire are unchanged. A plain socket carries only `m` (module key) and `s` (socket name) on the query string; it has no `r` room-key param. The DO is keyed per connection (`newUniqueId`), so there is one DO per socket, no fan-out, no topic, no presence, no room engine.

## Components and changes

### 1. Socket API change (the one breaking change; pre-release, export-diff-invisible)

`packages/iso/src/define-socket.ts`. A DO callback runs with no live `Context`, so the socket API mirrors the PR5a room change exactly:

- **Add** `data?: (c: Context) => Data` to `SocketHandler` — an edge factory run once at the upgrade with the live Context; its result seeds `socket.data`. Portable: it runs on BOTH Node and Cloudflare.
- **Drop** the `{ c: Context }` argument from `open`: the signature becomes
  `open?(socket: ServerSocket<Outgoing, Data>): void | (() => void) | Promise<void | (() => void)>`.
  Everything a handler previously read from `ctx.c` in `open` (cookies, headers, query, middleware-set values) it now reads in `data(c)` and stashes in `socket.data`; `open` then reads `socket.data`.
- `message` / `close` / `error` are unchanged (they never took `c`).

After this change `SocketHandler` and `RoomHandler` are consistent: both expose `data?: (c) => Data` and neither passes a live `Context` to its per-connection callbacks.

The doc comment on `open` that today describes `ctx.c` is replaced with one describing the `data` factory and the `socket.data` contract.

### 2. Node parity (keep one behavior on both runtimes)

`packages/server/src/sockets-handler.ts`, the plain-socket branch of `createEvents`. Today it does `const data: Record<string, unknown> = {}` and calls `socketDef.open(makeSocket(ws), { c: ctx })`. Change it to run the edge factory before open and seed `data` from it, then call `open` with no context:

```ts
const data = (await socketDef!.data?.(ctx)) ?? {};
// ... makeSocket closes over `data` as before ...
const result = await socketDef!.open?.(makeSocket(ws));
```

(`ctx` here is the Hono `Context`; `data?.(ctx)` matches the `data?: (c: Context) => Data` factory.) Node and CF now seed `socket.data` identically. `socket.data` stays a mutable per-connection bag the handler can also write to across `open`/`message`/`close`.

`apps/example-node`'s socket dogfood and the existing socket tests get the mechanical migration: any `open(socket, { c })` that read `c` moves that read into a `data(c)` factory; `open` loses its second argument.

### 3. CF forward path

**`packages/iso/src/internal/realtime-connector.ts` (the connector seam).** Add a socket-forward variant to the connector union and broaden the now-misnamed room-only types:

- Add `SocketForwardContext { kind: 'socket-forward'; c: Context; moduleKey: string; name: string; data: unknown }`.
- Rename `RoomConnectContext` → `RealtimeConnectContext` (union now `RoomForwardContext | SocketForwardContext | DenyContext`).
- Rename `RoomDenyContext` → `DenyContext` (its content is already room-agnostic; a denied socket reuses `kind: 'deny'`).

These are internal (`@hono-preact/iso/internal/runtime`) and pre-release, so the renames are free. `installRealtimeConnector` / `getRealtimeConnector` / `RealtimeConnector` keep their names.

**`packages/server/src/cf/realtime-do-glue.ts` (`makeCfForwardConnector`).** Add a `kind === 'socket-forward'` branch:

- `const ns = getNamespace(c)`; same missing-binding error as the room path.
- Bound `data` with the existing `MAX_FORWARD_HEADER_BYTES` check (the same guard the room path applies to `params`/`data`).
- `const stub = ns.get(ns.newUniqueId())` — a brand-new DO per connection (no `idFromName`, because a plain socket has no topic identity).
- Rebuild the request with a cloned mutable `Headers` (as today), stamp `x-hp-kind: socket` + `x-hp-module` + `x-hp-name` + `x-hp-data`, `return stub.fetch(fwd)`.

The existing `x-hp-kind` strip on the ROOM forward path stays; the socket-forward branch sets `x-hp-kind: socket` itself. The deny branch is unchanged and shared.

**`packages/server/src/cf/socket-registry.ts` (new).** Mirror `room-registry.ts`: `installSocketRegistry(getter)` / `getSocketRegistry()` / `__resetSocketRegistryForTesting()`, a module-global getter producing `Map<string, AnySocketDef>`. The getter wraps the existing `buildSocketRegistry` (already in `sockets-handler.ts`, platform-free). The DO resolves it once and caches the Map, exactly like rooms.

**`packages/server/src/cf/realtime-do.ts` (the DO).** Three additions, all guarded behind `x-hp-kind` / attachment-kind so the room and topic paths are byte-untouched:

- `fetch()`: add a `kind === 'socket'` branch (after `publish` and `topic`, before the `room` default). Read `x-hp-module` / `x-hp-name` / `x-hp-data`; `acceptWebSocket(server)` (hibernation, NOT tagged `'topic'`); `server.serializeAttachment({ kind: 'socket', moduleKey, name, data })`; resolve the socket def via the socket registry; build a `ServerSocket` over the server ws (`send` = `ws.send(JSON.stringify(msg))`, `close` = `ws.close`, `data`, `raw: ws`); run `await socketDef.open?.(socket)`; return the 101 with the client socket. The teardown return is discarded on CF (see Lifecycle below).
- A `isSocketConnection(att)` helper in `realtime-do-glue.ts` (`att.kind === 'socket'`), mirroring `isTopicSubscriber`.
- `webSocketMessage` / `webSocketClose` / `webSocketError`: add a socket dispatch. The order is: `isTopicSubscriber` → skip (receive-only); `isSocketConnection` → run the socket handler; else → the existing room path. The socket handlers build the `ServerSocket` from the hibernation ws + `att.data`, `JSON.parse` the frame (message), and call `socketDef.message(socket, parsed)` / `socketDef.close(socket, { code, reason })` / `socketDef.error(socket, err)`. Use the `webSocketClose(ws, code, reason, wasClean)` arguments to populate the close event.

A small `makeSocketDO` / `makeServerSocket(ws, data)` helper factors the `ServerSocket` construction so `fetch` (open) and the three event handlers share one socket shape. Keep it in `realtime-do-glue.ts` (platform-free, unit-testable) where possible; only the `acceptWebSocket` call and the registry resolve need the DO instance.

**`packages/vite/src/adapter-cloudflare.ts` (`wrapEntry`).** Add to the emitted entry, alongside the room registry install:

```js
installSocketRegistry(() => buildSocketRegistry(__hpServerImports));
```

`buildSocketRegistry` and `installSocketRegistry` are imported from `hono-preact/server/internal/cloudflare` (the CF door), like `buildRoomRegistry` / `installRoomRegistry` today. The CF door (`packages/server/src/internal-cloudflare.ts`) must add these re-exports: `installSocketRegistry` / `getSocketRegistry` / `__resetSocketRegistryForTesting` from `./cf/socket-registry.js`, and `buildSocketRegistry` from `./sockets-handler.js` (it currently re-exports only the room equivalents).

**`packages/server/src/sockets-handler.ts` (the CF dispatch).** Replace the plain-socket fall-through (today: `getWebSocketUpgrader()` which throws on CF). After `resolveConnection`, with a connector installed:

- room → the existing forward / deny branch (unchanged);
- plain socket (`socketDef` present, not a room): if `denied` → `connector({ c, kind: 'deny' })`; else run `const data = socketDef.data?.(c) ?? {}` and `connector({ c, kind: 'socket-forward', moduleKey, name, data })`, returning the Response directly;
- unknown def → the existing unknown-def deny (createEvents' unknown-socket close).

With NO connector installed (Node) the in-worker upgrader path is untouched.

### 4. Lifecycle, guard, door isolation

- **Guard at the edge (acceptance #2):** unchanged. `resolveConnection` runs the full chain (app use → route-node `use` inheritance → `def.use`) before the connector is called, so no unauthorized connection reaches the DO. The `deny` path closes 4403 in the worker with no DO contact.
- **`data` factory and the edge:** `socketDef.data?.(c)` runs at the edge with the live Context (the only place a live Context exists on CF), and its result rides `x-hp-data` to the DO. Same model as `roomDef.data?.(c)`.
- **Teardown asymmetry (documented, mirrors rooms):** the DO uses the Hibernation API, so the closure `open` may return cannot survive a hibernation cycle. `open`'s returned teardown is therefore a **Node-only** convenience; `close` is the portable cleanup hook on both runtimes. This is the exact asymmetry rooms already document for `onJoin` (teardown Node-only) vs `onLeave` (portable). `webSocketClose` in the DO calls `socketDef.close` directly.
- **Reconnect / durability:** a plain socket has no durable identity. `useSocket`'s existing finite reconnect mints a fresh DO (`newUniqueId`) and re-runs `data` + `open`; there is no replay (consistent with rooms' deferred replay). A socket that hibernates and is later closed runs `close` (the registry + attachment are rebuilt from `getWebSockets()` like the room path), so cleanup is reliable via `close`.
- **Door isolation (acceptance #3):** `WebSocketPair` and `newUniqueId` are used only in `realtime-do-glue.ts` (workers-types-only, exactly like today's deny path) and the DO. The `cloudflare:workers` value-import stays confined to `realtime-do.ts`. No workerd runtime import reaches the Node path.

### 5. Testing

- **New workerd integration test** (vite `__tests__`, `@cloudflare/vite-plugin`, mirroring `cf-room.test.ts`): a fixture `defineSocket` consumed over `/__sockets`. Assert (a) guard-at-edge — a `use`-denied socket closes 4403 with no DO contact; (b) forward — an allowed socket reaches a per-connection DO; (c) full duplex round-trip — client `send` → server `message` → server `send` → client receives. Optionally assert the per-connection DO isolation (two clients get independent `socket.data`).
- **Unit tests (plain vitest, no workerd):**
  - `socket-registry.ts` — install/get/reset (mirror the room-registry tests).
  - DO socket dispatch + `isSocketConnection` — fake `getWebSockets()` + fake attachments; assert the message/close/error handlers route a socket attachment to the socket handler and skip topic/room.
  - `makeCfForwardConnector` socket-forward branch — fake namespace; assert `newUniqueId` (not `idFromName`), `x-hp-kind: socket`, and the stamped headers; assert the over-budget `data` throws.
  - `sockets-handler` Node parity — `data(c)` is run and seeds `socket.data`; `open` is called with no second argument.
- **Node unchanged:** the existing socket suites stay green after the mechanical `open(socket, {c})` → `data(c)` + `open(socket)` migration.

### 6. Docs and release notes

- `apps/site/src/pages/docs/websockets.mdx`: drop the "Node-only on Cloudflare" caveat for plain sockets; document the `data` edge factory, the no-`c`-in-`open` rule, and the "`close` is the portable cleanup hook; an `open` teardown return is Node-only" caveat. Update the support table so sockets read "supported (Node + Cloudflare)".
- Release notes (the v0.8 draft, `docs/superpowers/specs/2026-06-21-v0.8-release-notes.md`): record the pre-release socket API change (`open` drops its `{ c }` argument; new `data: (c) => Data` factory). It is invisible in the public-export-surface diff, so it must be listed explicitly, exactly as the room `onJoin {c}` → `data` change was.

## Non-goals

- No fan-out, presence, or replay on plain sockets (those are rooms; a plain socket is the 1:1 leg).
- No site demo (integration test is the proof; see Decision).
- No change to the client (`useSocket`) or the `/__sockets` wire.
- No change to the Node in-worker upgrader path beyond the `data`/`open` API migration.

## File map

| File | Change |
|---|---|
| `packages/iso/src/define-socket.ts` | add `data?: (c) => Data`; drop `{ c }` from `open`; doc update |
| `packages/server/src/sockets-handler.ts` | Node: run `data(c)` + seed `socket.data`, `open(socket)`; CF: forward plain socket via connector (socket-forward / deny) instead of throwing |
| `packages/iso/src/internal/realtime-connector.ts` | add `SocketForwardContext`; rename `RoomConnectContext`→`RealtimeConnectContext`, `RoomDenyContext`→`DenyContext` |
| `packages/server/src/cf/realtime-do-glue.ts` | `makeCfForwardConnector` socket-forward branch (`newUniqueId`, `x-hp-kind: socket`); `isSocketConnection`; `makeServerSocket` helper |
| `packages/server/src/cf/socket-registry.ts` | NEW: `installSocketRegistry` / `getSocketRegistry` / reset (mirror `room-registry.ts`) |
| `packages/server/src/cf/realtime-do.ts` | `fetch` `kind: 'socket'` branch (accept + attachment + `open`); socket dispatch in `webSocketMessage`/`Close`/`Error` |
| `packages/vite/src/adapter-cloudflare.ts` | emit `installSocketRegistry(() => buildSocketRegistry(__hpServerImports))` |
| `packages/server/src/internal-cloudflare.ts` | re-export `installSocketRegistry` / `getSocketRegistry` / `__resetSocketRegistryForTesting` (from `./cf/socket-registry.js`) and `buildSocketRegistry` (from `./sockets-handler.js`) through the CF door |
| `packages/vite/src/__tests__/` (+ fixture) | NEW workerd integration test mirroring `cf-room.test.ts` |
| `apps/site/src/pages/docs/websockets.mdx` | drop Node-only socket caveat; document `data` / `open` / cleanup-hook |
| `docs/superpowers/specs/2026-06-21-v0.8-release-notes.md` | record the socket API change |
