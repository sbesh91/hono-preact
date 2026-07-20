# Raw `upgradeWebSocket` on the Cloudflare adapter (#291)

**Issue:** [#291](https://github.com/sbesh91/hono-preact/issues/291) — "upgradeWebSocket is Node-adapter-only; the Cloudflare adapter throws at request time" (v0.12, P1, `framework-api`).

**Status:** design approved 2026-07-19.

## Problem

`upgradeWebSocket` (the public raw-WS helper, `packages/iso/src/upgrade-websocket.ts`) resolves its upgrader lazily at request time via `getWebSocketUpgrader()`. Only the **Node** adapter installs one (`createNodeWebSocket({ app }).upgradeWebSocket`, in `packages/vite/src/adapter-node.ts`). The **Cloudflare** adapter's generated worker entry (`packages/vite/src/adapter-cloudflare.ts` `wrapEntry`) installs a realtime *connector* and a pub/sub backend for `/__sockets` (which serve `defineSocket` / rooms via a Durable Object), but it **never installs a WebSocket upgrader**. So every hand-authored `upgradeWebSocket` route in `api.ts` throws at request time under CF:

```
hono-preact: no WebSocket upgrader installed. serverSockets require a
WS-capable adapter (the Node adapter installs one at boot).
```

The docs-half of this issue already shipped in PR #296 (the v0.11 caveat). This PR closes the framework half: **Direction #1** from the issue — implement a CF upgrader.

## Key facts established during exploration

- The upgrader seam (`packages/iso/src/internal/ws-upgrader.ts`: `installWebSocketUpgrader` / `getWebSocketUpgrader`) and the realtime **connector** seam (`packages/iso/src/internal/realtime-connector.ts`) are **independent**. On CF, `socketsHandler` sees a connector installed (`getRealtimeConnector()` truthy) and routes `/__sockets` through it, **never calling `getWebSocketUpgrader()`**. So installing an upgrader on CF changes *only* the raw `upgradeWebSocket` path; `/__sockets` (sockets/rooms) is untouched.
- A raw per-connection WS on CF needs a bare `WebSocketPair` in the worker — **no Durable Object** (the DO exists for fan-out / hibernation state, which a per-connection echo does not need). The framework already uses the `new WebSocketPair()` + `server.accept()` + `server.close()` pattern in `packages/server/src/cf/realtime-do-glue.ts` (`makeCfForwardConnector`).
- **The onOpen divergence (confirmed from source).** Node's `@hono/node-ws` fires `events.onOpen?.(new Event('open'), ctx)` after the upgrade. Hono's `hono/cloudflare-workers` `upgradeWebSocket` (`node_modules/.pnpm/hono@4.12.14/.../adapter/cloudflare-workers/websocket.js`) wires `onMessage`/`onClose`/`onError` and calls `server.accept()` itself, but **never wires `onOpen`**. Using hono's helper directly would make an `onOpen` handler silently no-op on CF.

## Decision: full parity (framework-owned CF upgrader)

Rather than install hono's CF helper and paper over the gap with a dev-time warning, ship a **framework-owned** CF upgrader that also fires `onOpen`, giving byte-for-byte behavioral parity with Node. The framework's thesis is runtime parity ("the same code works on both runtimes"); parity eliminates the footgun outright instead of documenting it, and removes the need for any warning code or "onOpen is Node-only" caveat.

## Architecture

One new unit, mirroring how the Node adapter fills the same seam.

### New unit: `makeCfWebSocketUpgrader()`

**File:** `packages/server/src/cf/ws-upgrader-cf.ts` (new)

**Responsibility:** produce a `WebSocketUpgrader` (`(createEvents) => MiddlewareHandler`) for Cloudflare with Node parity.

**Behavior**, per connection:
1. If the request is not a WebSocket upgrade (`c.req.header('Upgrade') !== 'websocket'`), call `next()` and return (mirrors both hono adapters).
2. `const events = await createEvents(c)`.
3. `const pair = new WebSocketPair(); const client = pair[0]; const server = pair[1];`
4. Build a `WSContext` (from `hono/ws`) wrapping `server` (`send`/`close`/`readyState`/`protocol`/`url`/`raw`), identical to hono's CF helper.
5. Attach `server.addEventListener('message' | 'close' | 'error', ...)` **only when** the corresponding handler is present (parity with hono's conditional wiring).
6. `server.accept()`.
7. **`events.onOpen?.(new Event('open'), ws)`** — the parity fix.
8. Return `new Response(null, { status: 101, webSocket: client })`.

**Dependencies:** `WSContext` from `hono/ws` (platform-neutral); the `WebSocketPair` workerd global (already ambiently typed in this package — `realtime-do-glue.ts` uses it and typechecks); the `WebSocketUpgrader` type from `@hono-preact/iso/internal/runtime`.

**No Durable Object**, no realtime binding.

**Type hygiene (per CLAUDE.md "Type casts"):** the workerd-only `webSocket` init field is not on the standard `ResponseInit`. Model it with a local reshape, not a raw cast:

```ts
interface CfResponseInit extends ResponseInit {
  webSocket?: WebSocket;
}
```

and build the `Response` with a `CfResponseInit`. (Hono's own code uses `// @ts-expect-error` here; the reshape is the cleaner boundary for this repo.) If the `WebSocketPair` global needs a local ambient declaration to typecheck in this file, add a minimal one rather than pulling a cast.

### Export

Add `makeCfWebSocketUpgrader` to the Cloudflare-only server door:

- `packages/server/src/internal-cloudflare.ts` → `export { makeCfWebSocketUpgrader } from './cf/ws-upgrader-cf.js';`

This flows automatically to the umbrella `hono-preact/server/internal/cloudflare` (`packages/hono-preact/src/server-internal-cloudflare.ts` is `export *`). The door is guarded only by `toContain` assertions in `adapter-cloudflare.test.ts`, **not** by an exhaustive export-set drift guard (that guard covers only the iso `internal/runtime` door, which is unchanged). No allowlist edit needed for the export itself.

**Why the CF-only door, not the neutral server door:** conceptually CF-only (`WebSocketPair` is a workerd global; undefined on Node), and it keeps the Node generated entry from ever importing it. Matches `makeCfForwardConnector`'s home. It does **not** import `cloudflare:workers`, so it is safe to sit behind that door.

## Wiring: CF adapter `wrapEntry` codegen

In `packages/vite/src/adapter-cloudflare.ts` `wrapEntry`, extend the generated worker entry:

- Add `makeCfWebSocketUpgrader` to the existing `from 'hono-preact/server/internal/cloudflare'` import block.
- Add `installWebSocketUpgrader` to the existing `from 'hono-preact/internal/runtime'` import block (which already imports `installRealtimeConnector`, `installPubSubBackend`).
- Add one install line near the other `install*` calls:
  ```js
  installWebSocketUpgrader(makeCfWebSocketUpgrader());
  ```
- Add a short comment explaining that this enables raw `api.ts` `upgradeWebSocket` routes on CF (independent of the realtime connector; no DO needed), symmetric to the Node adapter's `installWebSocketUpgrader(createNodeWebSocket(...).upgradeWebSocket)`.

## Docs-site demo (approved: restore)

`apps/site/src/api.ts`: replace the "No raw WebSocket route here …" comment with the restored echo route. `onOpen` sends `'ready'` (proving parity on the live CF worker), `onMessage` echoes:

```ts
app.get(
  '/api/demo/echo',
  upgradeWebSocket(() => ({
    onOpen(_e, ws) {
      ws.send('ready');
    },
    onMessage(ev, ws) {
      ws.send(`echo: ${ev.data}`);
    },
  }))
);
```

This gives real end-to-end proof on `framework.sbesh.com` and restores the demo the issue removed.

## Docs: `apps/site/src/pages/docs/websockets.mdx`

Reverse the Node-only claims (per repo docs style: describe current behavior, no "used to throw" breadcrumb). Spots to rewrite:

1. **Intro paragraph** (line ~3): drop "it requires the Node adapter (see below)".
2. **The "resolves lazily … Cloudflare throws" paragraph** (line ~236): rewrite to state it works on both runtimes; on CF each raw route is its own `WebSocketPair` connection and needs no Durable Object binding.
3. **`### Node.js` / `### Cloudflare Workers` subsections** (lines ~238–265): rewrite the Cloudflare subsection to describe the working behavior (echo example works; `onOpen` fires on both runtimes; each CF raw route is its own connection, in contrast to Node's shared node-ws instance and to `defineSocket`, which does need the DO binding).
4. **API-reference line** for `### upgradeWebSocket(createEvents)` (line ~335): drop "so this is a Node-adapter API".
5. **Cloudflare-setup note** (line ~180): update "the raw `upgradeWebSocket` path below is separate and Node-only" to note it now works on both and needs no DO binding.
6. **Intro "on the same connection"** wording (line ~3): soften so it is accurate for CF (per-`WebSocketPair`), not just Node.

## Tests

1. **Unit** — `packages/server/src/cf/__tests__/ws-upgrader-cf.test.ts` (new). With a fake `WebSocketPair` / `server` (stub `accept`, `addEventListener`, `send`, `close`) installed as a global for the test:
   - non-upgrade request (no `Upgrade: websocket`) calls `next()` and does not create a pair;
   - listeners are attached only for handlers that are present (e.g. `onMessage` only → no `close`/`error` listeners);
   - **`onOpen` fires after `accept()`** with a `WSContext`;
   - returns a `101` whose `webSocket` is the client end.

2. **wrapEntry** — extend `packages/vite/src/__tests__/adapter-cloudflare.test.ts` with `toContain` assertions for the new CF-door import of `makeCfWebSocketUpgrader`, the `installWebSocketUpgrader` import from the runtime door, and the `installWebSocketUpgrader(makeCfWebSocketUpgrader())` install line.

3. **Real workerd (integration)** — extend `packages/vite/src/__tests__/websocket-dev.test.ts`:
   - New minimal fixture `packages/vite/src/__tests__/fixtures/cf-fw-ws/` using the **framework** plugin (`honoPreact({ adapter: cloudflareAdapter() })`, aliased to source like `cf-socket`'s `vite.config.ts`) plus a `src/api.ts` that registers a raw `upgradeWebSocket` echo route (with an `onOpen` that sends `'ready'`). **No Durable Object binding** in `wrangler.jsonc` — which also asserts the "no DO needed" design. (If wrangler rejects the CF entry's re-exported DO class without a binding, add the minimal `durable_objects` + `new_sqlite_classes` migration; resolve during implementation.)
   - New describe block "Cloudflare framework adapter: raw upgradeWebSocket" that drives it over real workerd: connect, assert the first frame is `'ready'` (onOpen parity), then send `'hello'` and assert `'echo: hello'`. Reuse/extend the file's `ws`-based helper to collect the first two frames.

4. **Allowlist** — `apps/site/src/__tests__/framework-coverage.test.ts`: remove the `upgradeWebSocket` allowlist entry (the restored demo now exercises it). Confirm the coverage test passes with the export used by the demo.

## Out of scope

- **Direction #2** (build-time rejection of `upgradeWebSocket` under CF) — moot once #1 makes it work.
- The `getWebSocketUpgrader()` throw message wording — with both adapters installing an upgrader it is effectively unreachable for supported adapters; leave as-is (optionally refresh the `ws-upgrader.ts` "Cloudflare in a later release" comment).
- Release notes — handled at release time, not per-PR.

## Verification (pre-push, mirrors CI order from CLAUDE.md)

Framework build → `pnpm gen:agents-corpus` → `pnpm format:check` → `pnpm typecheck` → `pnpm test:types` → `pnpm test:coverage` → `pnpm test:integration` → `pnpm --filter site build`. The new integration test spins up real workerd, so `pnpm test:integration` is the load-bearing gate for the parity assertion. Manually drive the restored `/api/demo/echo` in dev (and, where possible, the PR preview worker) to confirm the live CF path.
