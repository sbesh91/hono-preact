# Realtime PR 5b: Cloudflare Durable Object PubSubBackend for live loaders + cross-isolate `publish()`

**Status:** Design approved 2026-06-22. Next: implementation plan.

**Goal:** Make channel-driven SSE `live` loaders and the `publish()` API fan out **cross-isolate** on Cloudflare Workers (workerd), by backing the `PubSubBackend` seam with the hibernating Durable Object PR 5a already ships. Today a `publish()` in one worker isolate cannot reach a `live`-loader subscription held in another isolate (the in-process `Map` backend is per-isolate); this closes that gap, the last piece of the five-PR realtime program.

**Program context:** PR 5b of the first-class-realtime program (master spec: `docs/superpowers/specs/2026-06-20-first-class-realtime-design.md`). PRs 1-4 are merged (typed channels, the in-process pub/sub backend, the duplex socket primitive, rooms + presence on Node). PR 5 was split:

- **PR 5a (merged, #166):** the `HonoPreactRealtimeDO` class + worker→DO WS routing + the room runtime in the DO + presence-in-DO + the binding/migration wiring. Scope: **rooms + presence only.** Dogfood: live cursors on the site.
- **PR 5b (this spec):** the DO-backed `PubSubBackend` for `live` loaders + cross-isolate `publish()`. Reuses the same DO **read-only** (subscribe) plus a publish fan-out entrypoint. Dogfood: a small live demo on the site.

This document covers PR 5b only.

## The problem PR 5b solves

The reactive-read consumption layer is shipped (PR #133: `defineLoader(fn, { live: true })` + the accumulating `loader.View`). PR 2 gave it a fan-out *source* on Node: `route.liveLoader({ topic, load })` desugars to an async generator that subscribes to a typed channel via `getPubSubBackend().subscribe(topic, onMessage)` and re-runs `load` on each publish; `publish(topic, msg)` notifies subscribers. On Node this is one process, so a publish reaches every subscription.

On Cloudflare each request may run in a different isolate, and the in-process `Map` backend (`packages/iso/src/internal/pubsub.ts` `inProcessBackend`) is per-isolate. A `publish()` from an action in isolate A never reaches a `live`-loader SSE stream held in isolate B. PR 5b supplies a `PubSubBackend` whose `publish`/`subscribe` route through a single Durable Object per topic (`idFromName(topic)`), which is the one process all isolates can rendezvous at.

## What does NOT change

- **The browser leg.** `live` loaders still deliver over the existing `/__loaders` SSE transport (`packages/server/src/loaders-handler.ts` → `packages/server/src/sse.ts`), consumed by the shipped `loader.View`. No new client wire, no client code change, SSR still skips `live` loaders.
- **The public API.** `defineChannel`, `route.liveLoader`, `publish(topic, msg)`, `subscribeTopic` (`packages/iso/src/internal/subscribe-topic.ts`) are untouched. They already route through `getPubSubBackend()`; PR 5b only supplies a different backend on CF.
- **The Node path.** `getPubSubBackend()` keeps defaulting to `inProcessBackend`; the Node adapter installs nothing. `example-node`'s counter dogfood keeps working in-process.
- **PR 5a rooms.** Room fan-out on CF stays intra-DO (`getWebSockets()`); it does **not** go through the pub/sub backend. The room `fetch`/`webSocketMessage`/`webSocketClose` paths in the DO are unchanged except for the connection-kind discriminator added below (which defaults to the room path when absent).

## Architecture: the CF pub/sub path

```
  Action isolate                         live-loader SSE isolate (browser-facing)
  publish(topic,msg)                     route.liveLoader -> subscribeTopic -> backend.subscribe
        |                                          |  (worker holds an SSE stream to the browser)
        | stub.fetch('/__hp_publish', body=msg)    | stub.fetch(Upgrade: websocket, x-hp-kind: topic)
        v                                          v
   +-------------------------------------------------------------+
   |   HonoPreactRealtimeDO   idFromName(topic)   (hibernating)  |
   |   kind:'publish' POST  ->  send msg to getWebSockets('topic')|
   |   kind:'topic'  WS upgrade -> acceptWebSocket(server,['topic'])|
   +-------------------------------------------------------------+
                                   |  (DO frame: the published msg, verbatim)
                                   v
                        worker subscriber WS.onmessage -> onMessage(msg)
                                   -> wakes the live-loader generator -> re-run load -> SSE push
```

### `subscribe(topic, onMessage): () => void`

Called from the `live`-loader generator (`subscribeTopic`) inside the `/__loaders` SSE request, where the worker already holds the request `env`. The bound namespace is `getRuntime().env[realtimeBinding]` (the configurable binding, default `HONO_PREACT_REALTIME`, threaded from `cloudflareAdapter()` exactly as the room connector threads it); a missing runtime or binding throws the same clear "rooms/live data on Cloudflare require the `<binding>` Durable Object binding" setup error PR 5a uses.

1. Open a worker→DO WebSocket: `ns.get(ns.idFromName(topic)).fetch(new Request('https://do/__hp_sub', { headers: { Upgrade: 'websocket', 'x-hp-kind': 'topic', 'x-hp-topic': topic } }))`.
2. On the `101`, take `response.webSocket`, call `.accept()`, set `ws.onmessage = (e) => onMessage(parse(e.data))`.
3. Return an unsubscribe `() => void` that closes the WS (and aborts a still-pending open). The generator's `finally` (and the request `signal` abort) already call it.

The signature stays synchronous (`subscribe(...): () => void`); the WS open is kicked off async and the unsubscribe is returned immediately, mirroring the in-process backend's contract. A subscriber socket is receive-only: it never sends to the DO.

### `publish(topic, message): void`

Called from a user action; `publish(topic, msg)` keeps its signature. The namespace is `getRuntime().env[realtimeBinding]` (same binding + missing-binding error as `subscribe`).

1. `ns.get(ns.idFromName(topic)).fetch(new Request('https://do/__hp_publish', { method: 'POST', headers: { 'x-hp-kind': 'publish' }, body: JSON.stringify(message) }))`.
2. The fan-out fetch is held open with `getRuntime().ctx.waitUntil(...)` (the captured `ExecutionContext`, see "Env access") so it survives the action's response returning. Fire-and-forget: failures are logged, not surfaced to the action (best-effort fan-out, matching the `void` return).

The publish body is a POST body (not a header), so it is not bound by `MAX_FORWARD_HEADER_BYTES`; payloads are expected to be small (the `live`-loader re-run reads fresh state anyway; the message often just signals "something changed").

## The DO: a topic branch beside the room branch (same class)

`HonoPreactRealtimeDO` (`packages/server/src/cf/realtime-do.ts`) gains an `x-hp-kind` discriminator in `fetch`, **defaulting to `'room'` when the header is absent** so PR 5a's forward connector keeps working with zero change:

- **`kind: 'room'` (absent header):** the existing PR 5a path (read room headers, `acceptWebSocket`, seed the room attachment, `engineJoin`). Unchanged.
- **`kind: 'topic'` (WS upgrade):** `const { 0: client, 1: server } = new WebSocketPair(); this.ctx.acceptWebSocket(server, ['topic']); server.serializeAttachment({ kind: 'topic' }); return new Response(null, { status: 101, webSocket: client })`. No engine, no presence, no snapshot. A pure subscriber.
- **`kind: 'publish'` (POST, no upgrade):** read the body, `for (const ws of this.ctx.getWebSockets('topic')) ws.send(body)`, return `204`. The published bytes are forwarded verbatim.

`webSocketMessage`/`webSocketClose`/`webSocketError` branch on the connection kind (read from the attachment / `getTags(ws)`):

- **topic kind:** `webSocketMessage` is ignored (subscribers are receive-only); `webSocketClose`/`webSocketError` are no-ops (the hibernation API removes the socket from `getWebSockets()` automatically, and a subscriber has no engine state to tear down).
- **room kind:** the existing PR 5a engine sequence, unchanged.

One DO per topic (`idFromName(topic)`). In practice a given topic string is either a `live`-loader channel or a room, so a DO holds one kind; the tag keeps the two cleanly separated if a channel is ever used both ways. Topic subscribers hibernate when idle and wake on the next publish fetch.

## Env access: capture at the worker fetch boundary

`publish(topic, msg)` has no `c`, but the CF backend needs the DO namespace binding, which on workerd is per-request (`c.env.HONO_PREACT_REALTIME`), not global. **Chosen mechanism:** the generated worker entry captures `{ env, ctx }` at the fetch boundary on every request and stashes it in a module-scoped holder the CF backend reads.

`export default coreApp` becomes a thin wrapper:

```ts
export default {
  fetch(request, env, ctx) {
    captureRealtimeRuntime(env, ctx);   // stashes { env, ctx } for the CF backend
    return coreApp.fetch(request, env, ctx);
  },
};
```

- Runs before any routing/middleware, so `env` (for `subscribe`/`publish`) and `ctx` (for `publish`'s `waitUntil`) are always available by the time a loader or action runs. The binding object is stable per isolate, so capturing on every request is a single cheap assignment.
- No `node:async_hooks`/`nodejs_compat` dependency (rejected alternative: AsyncLocalStorage, more machinery and a hard compat requirement). Rejected alternative: threading `env` into `publish` — breaks the master spec's locked "developer API is identical" decision.
- Additive to PR 5a's `wrapEntry`: the room connector still reads `env` from the per-request Hono `Context`; this capture is parallel and does not change the room path.

## Components and files

New:

- **`packages/server/src/cf/cf-pubsub.ts`** (platform-free, types-only `@cloudflare/workers-types`, no `cloudflare:workers` runtime import): `makeCfPubSubBackend(getRuntime: () => { env, ctx } | undefined, realtimeBinding = 'HONO_PREACT_REALTIME'): PubSubBackend`. Implements `subscribe` (worker→DO topic WS) and `publish` (DO publish fetch + `waitUntil`); throws the shared missing-binding error when `getRuntime()` or `env[realtimeBinding]` is absent. Unit-testable in plain vitest with a fake namespace/stub.
- **`captureRealtimeRuntime` / `getRealtimeRuntime`**: the module-scoped `{ env, ctx }` holder the backend reads, exported from the Cloudflare door.

Changed:

- **`packages/server/src/cf/realtime-do.ts`**: add the `x-hp-kind` branch in `fetch` (`topic`/`publish`) and the kind guard in `webSocketMessage`/`webSocketClose`/`webSocketError`. Room path unchanged.
- **`packages/server/src/internal-cloudflare.ts`** (the `hono-preact/server/internal/cloudflare` door): export `makeCfPubSubBackend`, `captureRealtimeRuntime`, `getRealtimeRuntime`.
- **`packages/vite/src/adapter-cloudflare.ts`** `wrapEntry`: import `installPubSubBackend` from `hono-preact/internal/runtime` and `makeCfPubSubBackend`/`captureRealtimeRuntime` from the CF door; emit `installPubSubBackend(makeCfPubSubBackend(getRealtimeRuntime, <realtimeBinding>))` (the same configured binding the room connector already receives) and wrap `export default coreApp` in the env-capture fetch handler.

Unchanged seams reused: `installPubSubBackend`/`getPubSubBackend`/`PubSubBackend` (`packages/iso/src/internal/pubsub.ts`, re-exported on the iso runtime door), `subscribeTopic` (`packages/iso/src/internal/subscribe-topic.ts`), `route.liveLoader` (`packages/iso/src/server-route.ts`), `publish` (`packages/iso/src/pubsub.ts`), the SSE pump (`loaders-handler.ts` + `sse.ts`).

## Dogfood: a small live demo on the site

A net-new, small channel-driven `live` element on `apps/site` proving cross-isolate reactive reads on the deployed workerd site (the reactive-read analog of PR 5a's live cursors):

- A `defineChannel` (e.g. `defineChannel('demo-tally')()`), a `route.liveLoader` that reads a shared count and re-pushes on publish, and an action that mutates the count and `publish()`es the channel.
- A small component (a shared **live counter / tally**: a button bumps the count; every connected tab sees the new value live). Two browser tabs on the deployed site update each other cross-isolate through the DO.
- The site's `wrangler.jsonc` already has the `HONO_PREACT_REALTIME` binding (added in PR 5a), so the dogfood needs **no new deploy config**.
- The `example-node` counter stays the Node example (proving portability). The site's activity bar stays on its site-local `activity-stream.ts` bus, untouched (it is not the framework `publish()`; per the master spec it is left alone).

The exact UI is plan-level; the requirement is one small, real, framework-`publish()`-driven `live` loader that demonstrably fans out cross-isolate on workerd.

## Testing

- **CF DO (workerd integration test):** reuse the PR 5a workerd harness. Open two worker→DO topic subscriber sockets to the same `idFromName(topic)`, issue a publish (the `/__hp_publish` POST), and assert both subscribers receive the message verbatim (cross-isolate fan-out), and that closing one subscriber removes it (a later publish reaches only the survivor). Assert a `kind: 'topic'` connection never triggers room engine behavior (no snapshot/presence frames) and survives a simulated hibernation wake.
- **CF PubSubBackend (plain vitest):** drive `makeCfPubSubBackend` with a fake namespace/stub: `subscribe` opens the upgrade with `x-hp-kind: topic`; `publish` issues the `x-hp-kind: publish` POST and calls `ctx.waitUntil`; the returned unsubscribe closes the WS.
- **Node path:** the PR 2 `pubsub`/`subscribe-topic`/`liveLoader` suites run unchanged (the regression net for "Node behavior preserved"). `getPubSubBackend()` still defaults to `inProcessBackend`.
- **Adapter:** extend `packages/vite/src/__tests__/adapter-cloudflare.test.ts` to assert the generated entry installs the CF pub/sub backend and wraps the default export in the env-capture fetch handler.

## Scope, non-goals, deferred

- **In scope:** the DO-backed `PubSubBackend` (subscribe via worker→DO topic WS, publish via DO fan-out POST); the DO topic/publish branch + kind guards; the env-capture fetch wrapper; the adapter wiring; a small cross-isolate `live` dogfood on `apps/site`; the workerd + unit tests.
- **Out of scope (unchanged from PR 5a):** plain 1:1 sockets on CF; reconnect-replay.
- **Out of scope (master spec non-goals):** delta/CRDT `live`-loader payloads (coarse re-run v1); request/reply on the channel; runtime schema validation; wildcard channel subscription.
- **No public API changes.** `publish`, `route.liveLoader`, `defineChannel`, `loader.View` keep their signatures. The realtime program is unreleased, so any internal seam shape (e.g. the `getRealtimeRuntime` holder) is free to choose.

## Decisions locked

1. Reuse the `HonoPreactRealtimeDO` class read-only for topics; one DO per topic (`idFromName(topic)`), hibernating. No separate topic-DO class.
2. CF `subscribe` = a worker→DO topic-mode WebSocket; CF `publish` = a DO `/__hp_publish` POST that fans out to `getWebSockets('topic')`. The browser leg stays SSE; the client is unchanged.
3. DO connection kind via `x-hp-kind` (default `'room'` when absent, so PR 5a is untouched); `'topic'` subscribers are receive-only with no engine/presence.
4. Env + `ExecutionContext` captured at the worker fetch boundary (the generated entry wraps `coreApp.fetch`); the CF backend reads the holder. No ALS, no `publish` signature change.
5. `publish` fan-out held with `ctx.waitUntil`; best-effort, errors logged.
6. `installPubSubBackend` is the install seam, emitted in `wrapEntry`; Node defaults to `inProcessBackend` (no change).
7. Dogfood = one small framework-`publish()`-driven `live` loader on `apps/site` (cross-isolate on workerd); `example-node` counter stays; activity bar untouched.

## Open risks / implementation checks

1. **SSE + WS coexistence on a single worker invocation.** Confirm a worker fetch handler can hold a streaming SSE `Response` to the browser **and** an open worker→DO WebSocket subscription for the stream's lifetime, and that closing the SSE stream (client disconnect / `signal` abort) reliably triggers the unsubscribe that closes the WS. Verify against CF subrequest/duration limits for long-lived streams.
2. **`waitUntil` availability at publish time.** Confirm the captured `ExecutionContext` is valid when the action calls `publish` (same request), and that `waitUntil` keeps the DO fan-out fetch alive after the action response returns.
3. **Worker→DO upgrade through `stub.fetch`.** Confirm `stub.fetch(Upgrade: websocket)` returns a `101` whose `response.webSocket` the worker can `.accept()` and read (the subscriber direction; PR 5a confirmed the forward direction for browser clients).
4. **DO kind discrimination after hibernation wake.** Confirm `getTags(ws)` / the attachment `kind` is readable in `webSocketMessage`/`Close`/`Error` after a wake, so a topic subscriber is never run through the room engine.
5. **`getWebSockets('topic')` fan-out.** Confirm the tag filter returns exactly the topic subscribers and excludes any room sockets if a DO ever holds both.
6. **Env capture vs. the DO isolate.** The capture runs in the worker fetch path; the DO runs in its own isolate and does not use the holder (it reaches subscribers via `getWebSockets`). Confirm no code path expects the holder inside the DO.
7. **Site bundle + gates.** The CF backend is small, but confirm the client-size/Lighthouse gates tolerate the new dogfood component (or update baselines).
