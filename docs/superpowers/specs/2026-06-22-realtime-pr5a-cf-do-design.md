# Realtime PR 5a: Cloudflare Durable Object backend for rooms + presence

**Status:** Design approved 2026-06-22. Next: implementation plan.

**Goal:** Make rooms and presence work on Cloudflare Workers (workerd) with real cross-isolate fan-out, by backing them with one hibernating Durable Object per topic. This closes the "site dogfoods wait for PR 5 DO" constraint carried since PR 2: live cursors finally run on the workerd-deployed `apps/site`, two tabs fanning out through the DO.

**Program context:** This is PR 5a of the five-PR first-class-realtime program (spec: `docs/superpowers/specs/2026-06-20-first-class-realtime-design.md`). PRs 1-4 are merged (typed channels, the in-process pub/sub backend, the duplex WS socket primitive, rooms + presence on Node). PR 5 was split into:

- **PR 5a (this spec):** the DO class + WS-to-DO routing + the room runtime moved into the DO + presence-in-DO + the binding/migration wiring. Dogfood: live cursors on the site. Scope: **rooms + presence only.**
- **PR 5b (follow-up):** the DO-backed `PubSubBackend` for live loaders + the `publish()` API cross-isolate. Reuses the same DO read-only. Dogfood: the live board on the site.

This document covers PR 5a only.

## Why the DO model (not a backend swap)

PR 4 routes room fan-out through `getPubSubBackend().publish`, anticipating that a DO-backed `PubSubBackend` would make rooms work on Cloudflare. That is not sufficient. WebSocket **hibernation** (idle connections that do not keep an isolate or a billed wall-clock alive) is a Durable Object feature: the socket must terminate **at the DO**, not at the worker. So the room runtime that currently runs in the Node worker (`packages/server/src/rooms-handler.ts`) must run **inside the DO** on Cloudflare. The worker becomes a thin authenticating router.

Consequently, on Cloudflare **room fan-out is intra-DO** (the DO holds every connection for its topic and iterates them), not via a pub/sub backend. The pub/sub backend swap is PR 5b's concern (cross-isolate publish/subscribe for live loaders), a genuinely different delivery path.

## Architecture: edge / DO split

### Worker (edge, per `/__sockets` upgrade)

The wire is unchanged from PR 4: `GET /__sockets?m=<moduleKey>&s=<roomName>&r=<JSON key params>`.

1. Resolve the room def from the room registry (`moduleKey::name`).
2. Compute the topic server-side via `resolveRoomKey(channel, r)` (reused verbatim from PR 4): parse + string-validate the key params, interpolate `topic = channel.key(params)`. A bad key denies. The client never supplies a topic.
3. Run the guard chain **at the edge** with the live Hono `Context`: app `use` -> route-node `use` -> the room's own `use` (PR 4's `resolveGuardDenied`, unchanged). The room-key params are available to the guards as `ctx.location.pathParams` (PR 4 ultrareview fix). A deny closes `WS_DENY_CODE` (4403) at the worker without ever touching a DO.
4. Run the room def's edge-capture factory `data: (c) => Data` (see "Public API change") with the live `Context` to produce the serializable initial connection data.
5. On allow: get the DO stub for `idFromName(topic)` from the bound namespace (`env.HONO_PREACT_REALTIME`) and forward the upgrade request to it via `stub.fetch(request)`, carrying `{ topic, moduleKey, name, params, data }` on forwarded request headers. The DO returns the `101` response (with the client end of the `WebSocketPair`), which the worker relays to the client.

Auth, key validation, and edge-capture all happen at the edge with the full request context. The DO only ever sees an already-authorized connection plus serializable data.

### Durable Object (one per topic, hibernating)

The framework provides a single DO class, `HonoPreactRealtimeDO`, re-exported automatically from the generated worker entry.

1. `fetch(request)`: read the forwarded headers, create a `WebSocketPair`, `this.ctx.acceptWebSocket(server)` (hibernation), assign `connId = crypto.randomUUID()`, and persist per-connection state `{ connId, moduleKey, name, params, data, presence }` via `server.serializeAttachment(...)` so it survives eviction. Then run the engine join sequence (below). Return the `101` response with the client end.
2. `webSocketMessage(ws, message)`: read the attachment, rebuild the `RoomConnection`, decode the client frame, and run the engine message sequence.
3. `webSocketClose(ws)` / `webSocketError(ws)`: run the engine leave sequence.

The DO builds the room registry from the same server modules the worker uses (it is bundled in the same worker), so a connection's `moduleKey::name` resolves back to the user's `defineRoom` handler, whose `onJoin` / `onMessage` / `onLeave` run **inside the DO**.

## The shared room engine + two transports

The protocol that must not drift between Node and Cloudflare is extracted into a transport-agnostic **room engine**: stateless handler functions operating through a thin transport interface.

```ts
interface RoomTransport {
  sendTo(connId: string, env: RoomEnvelope): void;          // one connection
  broadcast(env: RoomEnvelope, excludeConnId?: string): void; // fan out to topic
  joinPresence(connId: string, state: unknown): void;
  leavePresence(connId: string): void;
  updatePresence(connId: string, state: unknown): void;
  roster(): Array<PresenceMember<unknown>>;
  getDef(): AnyRoomDef;
}
```

The engine owns the rules and the sequence (and the `RoomConnection` it hands to user callbacks):

- `engineJoin(t, connId, data, params)`: `joinPresence` -> send the joiner a `snapshot` (`t.roster()`) -> `broadcast` a `presence/join` (others) -> run `def.onJoin(conn, { params })`.
- `engineMessage(t, connId, frame)`: `{t:'msg'}` -> `def.onMessage(conn, frame.msg)`; `{t:'presence'}` -> `updatePresence` + `broadcast` a `presence/update`. (Same try/catch + explicit discriminant as the PR 4 ultrareview fix.)
- `engineClose(t, connId)`: `leavePresence` -> `broadcast` a `presence/leave` -> run `def.onLeave(conn)`.
- The fan-out rules live here: sender-exclude for `'msg'`, `{ self: true }` includes the sender via a direct `sendTo`, presence deltas always broadcast, snapshot sent directly to the joiner.

`RoomConnection.send/broadcast/setPresence/data/close` map onto the transport: `send` -> `sendTo(connId)`, `broadcast` -> `broadcast(env, connId)` (+ a local `sendTo` when `self`), `setPresence` -> `updatePresence` + `broadcast(presence/update)`, `data` -> the connection's edge-captured data, `close` -> the platform close.

**Two transports drive the same engine:**

- **Node transport:** ops backed by the existing in-process pub/sub (`sendTo`/`broadcast` via `getPubSubBackend()`) and the process-global presence module (`presence.ts`). PR 4's `rooms-handler.ts` is **refactored onto the engine behavior-preservingly**: the existing pub/sub + presence calls are reorganized behind the transport, not rewritten. The PR 4 + ultrareview test suites are the contract. If any of those tests needs editing, that signals a behavior change and we back off and fix the refactor instead.
- **Cloudflare transport:** ops backed by the DO's `this.ctx.getWebSockets()` (iterate for `broadcast`/`roster`, match `connId` for `sendTo`) and the per-socket hibernation attachments (presence is the connection set; see below).

This keeps a single source of truth for the fan-out / presence / framing rules while letting each platform own connection holding and delivery.

## Public API change: edge-capture folded into `conn.data`

PR 4's room callbacks receive the live Hono `Context`: `onJoin(conn, { c, params })`. Inside a hibernating DO there is no live `c` (the request is gone after the socket hibernates, and `c` is not serializable across the worker->DO boundary). So the DO-side callbacks (`onJoin`/`onMessage`/`onLeave`) must not depend on `c`.

Resolution (pre-release refinement; the realtime program is unreleased so this is free): an optional **edge-run** `data` factory whose serializable result seeds `conn.data`.

```ts
defineRoom(cursorsChannel, {
  // Runs at the EDGE with the live Context (both Node and CF). Must return
  // serializable data. Seeds conn.data, which rides to the DO and is available
  // in onJoin and onMessage.
  data: (c) => ({ name: c.get('user')?.name ?? 'Guest' }),
  presence: () => ({ x: 0, y: 0 }),
  onJoin(conn, { params }) {          // no `c`
    conn.setPresence({ x: 0, y: 0, name: conn.data.name });
  },
  onMessage(conn, msg) { conn.broadcast(msg); },
});
```

Changes to PR 4's `RoomHandler`:
- Remove `c` from `onJoin`'s ctx (`onJoin(conn, { params })`). `onMessage`/`onLeave` never had `c`.
- Add optional `data?: (c: Context) => Data` (runs at the edge; default seeds `conn.data` to `{}`). `RoomConnection.data` already exists; this is now its initial value.
- The guard chain (`use`) is unchanged and keeps full live `Context` access (it runs at the edge). Only the room *def callbacks* lose `c`.

This runs identically on Node and Cloudflare, so the same room handler is portable. The example-node dogfood and the rooms docs update to the new shape.

## Presence storage

Presence is the connection set itself, not a separate store. Each hibernated WebSocket carries `{ connId, ..., presence }` as its serialized attachment. `roster()` is `getWebSockets()` mapped over their attachments. Therefore:

- No separate durable storage for presence.
- Presence survives DO eviction automatically: the hibernated sockets and their attachments persist, and the DO rebuilds the roster on wake.
- `setPresence` updates the calling socket's attachment and broadcasts a `presence/update`.

This replaces PR 4's process-global presence Map on the Cloudflare side. (The Node side keeps `presence.ts` via the Node transport.)

## Adapter, binding, and codegen

### Cloudflare adapter

`cloudflareAdapter()`'s `wrapEntry` (currently a bare re-export of the core app) grows to:

- Re-export the framework DO class: `export { HonoPreactRealtimeDO } from 'hono-preact/internal/runtime'` (or the appropriate door), so wrangler discovers the class without the developer hand-writing it.
- Install the Cloudflare realtime transport at boot, so the `/__sockets` room branch forwards to `env.HONO_PREACT_REALTIME.get(idFromName(topic))` after the edge guard. This supersedes PR 4's worker-side `WebSocketUpgrader` for the room path on CF (the exact seam shape, for example a new `installRealtimeTransport`, is plan-level detail). The Node adapter's worker-side runtime is unchanged.

The DO needs the bound namespace from `env`, which on workerd is per-request; the transport reads it from the Hono `Context` (`c.env.HONO_PREACT_REALTIME`).

### Developer-owned binding (the chosen DX)

Fixed binding name convention `HONO_PREACT_REALTIME`. The developer adds, once, to their `wrangler.jsonc`:

```jsonc
"durable_objects": {
  "bindings": [{ "name": "HONO_PREACT_REALTIME", "class_name": "HonoPreactRealtimeDO" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["HonoPreactRealtimeDO"] }]
```

- The scaffolder's Cloudflare template (`packages/create-hono-preact/templates/cloudflare/wrangler.jsonc`) ships this pre-wired, so new apps work out of the box.
- Existing apps add these ~6 lines per a short docs page. A clear error fires if a room is used on CF without the binding present (the transport detects a missing `env.HONO_PREACT_REALTIME`).
- `new_sqlite_classes` (the current DO storage backend) even though PR 5a stores presence in attachments, the SQLite backend is the modern default and keeps room for PR 5b.

## Scope, non-goals, deferred

- **In scope:** rooms + presence on Cloudflare via the DO; the edge/DO split; the `data: (c) => Data` API refinement; the shared room engine + behavior-preserving Node refactor; the binding/migration wiring + scaffolder template; live cursors on `apps/site`.
- **Out of scope (PR 5b):** the DO-backed `PubSubBackend` for live loaders and the `publish()` API cross-isolate.
- **Out of scope (deferred, documented):** plain 1:1 sockets on Cloudflare (no fan-out, so no DO need beyond hibernation; the worker still serves sockets on Node). A socket connection on CF fails with PR 3's existing "no WebSocket upgrader installed" error (no CF worker-side upgrader is installed in PR 5a); the rooms path does not use that upgrader. A room used on CF without the DO binding fails with a clear setup error.
- **Still deferred (unchanged from PR 4):** reconnect-replay. Reconnect re-joins + re-snapshots, no message replay.
- The Node path is unchanged in behavior; the `example-node` cursors demo keeps working in-process.

## Testing

- **Room engine (transport-agnostic):** unit tests driving the engine with a fake transport. Assert the fan-out rules (sender-exclude, `self`, presence-forward), snapshot + deltas, frame routing (incl. malformed/unknown-`t`), and the join/message/leave sequence. This is the single home of protocol-correctness tests.
- **Node path:** the existing PR 4 + ultrareview suites, run **unchanged** through the refactor. These are the regression net for "behavior-preserving."
- **Cloudflare DO:** a workerd-based test (the repo already produces a CF integration build, so the harness exists). Two real `ws` clients to the same room on the DO: A's broadcast reaches B not A (intra-DO fan-out), B sees A's presence join/leave in the roster, and the snapshot/attachment roster survives a simulated hibernation wake.

## Dogfood

Live cursors on `apps/site` (the workerd-deployed docs site): a `cursors` room keyed by a `defineChannel('cursors/:room')`, a `CursorsDemo` that `setPresence({x,y})` on pointermove and renders other members from the roster, and the `HONO_PREACT_REALTIME` binding in the site's `wrangler.jsonc`. Two browser tabs show each other's cursors, fanning out cross-isolate through the DO. The `example-node` cursors demo (Node, in-process) keeps working, proving portability.

## Decisions locked

1. One DO per topic, `idFromName(topic)`, hibernating. Rooms only.
2. Auth + key validation + edge-capture at the worker; the room runtime (onJoin/onMessage/onLeave + fan-out + presence) in the DO.
3. Fan-out on CF is intra-DO, not via the pub/sub backend (that is PR 5b).
4. `data: (c) => Data` edge factory seeds `conn.data`; the room callbacks lose live `c` (pre-release refinement).
5. Presence is the attachment-carrying connection set; no separate durable store.
6. One shared room engine; the Node `rooms-handler` is refactored onto it behavior-preservingly (existing tests are the contract).
7. Framework-provided DO class (auto re-exported) + a developer-owned `HONO_PREACT_REALTIME` binding/migration; scaffolder template pre-wires it.
8. Plain sockets on CF and reconnect-replay remain deferred.

## Open risks / implementation checks

1. **Hibernation API details.** Confirm `acceptWebSocket` + `serializeAttachment`/`deserializeAttachment` + `getWebSockets()` semantics, attachment size limits, and that `webSocketMessage`/`webSocketClose` reliably fire after a wake. Confirm `onJoin` runs in `fetch` (pre-hibernation) and is not re-run on wake.
2. **Worker -> DO forwarding.** Confirm `stub.fetch(request)` with an `Upgrade: websocket` request returns the `101` + client socket through the worker correctly, and that the forwarded headers (params, edge-data) survive. Decide the header encoding for `data`/`params` (JSON, size-bounded).
3. **Behavior-preserving Node refactor.** The engine extraction must keep every PR 4 + ultrareview test green unchanged. Treat any required test edit as a regression signal.
4. **CF test harness.** Confirm the workerd test path (vitest workers pool or wrangler-dev + real `ws`) can drive the DO with two clients and simulate a hibernation wake.
5. **Site bundle + gates.** The DO class + room client grow the site bundle; confirm the client-size and Lighthouse gates tolerate it (or update baselines).
6. **`new_sqlite_classes` migration.** Confirm the migration tag/versioning is correct for a first-time DO and that the scaffolder template + the existing `apps/site` wrangler config both validate under `@cloudflare/vite-plugin`.
7. **How the DO obtains the room registry.** workerd instantiates the DO class from the binding, so it cannot easily take the user's room defs as constructor arguments. Decide the mechanism: the DO imports a framework-generated module that exposes the room registry (built from the same `serverImports` the worker uses), so a connection's `moduleKey::name` resolves to the user's `defineRoom` handler inside the DO. Confirm this generated registry module is included in the worker bundle and is reachable from the DO class.
