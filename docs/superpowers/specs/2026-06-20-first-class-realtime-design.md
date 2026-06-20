# First-class realtime: typed channels, a fan-out backend, sockets & rooms

Date: 2026-06-20
Status: Design (brainstormed; pending review)

Builds on (does not supersede):

- `2026-06-18-route-persistent-live-data-design.md` and
  `2026-06-18-unify-streaming-into-view-design.md`, shipped in **PR #133**
  (`26756a5`). Those delivered the live-loader *consumption* layer:
  `defineLoader(fn, { live: true })` plus the accumulating
  `loader.View(render, { initial, reduce })` with
  `status: 'connecting' | 'open' | 'closed' | 'error'`, client-only (no SSR
  hang), no timeout, `Serialize<T>` chunk typing, `<Persist>` removed.

## Summary

Make realtime first-class from one typed substrate and a shared fan-out backend.
The reactive-read consumption layer **already exists** (SSE `live` loaders, PR
#133). This spec adds only what that layer lacks: (1) a strictly-typed channel
address, (2) a pub/sub fan-out backend that gives existing `live` loaders a
cross-connection/cross-isolate *source*, and (3) a duplex socket/room layer for
client to server traffic on a single connection. On Cloudflare a single
hibernating connection-holding Durable Object backs all of it.

## The dividing line (why both SSE and WS exist here)

On our targets (HTTP/2 on Node and Cloudflare) a WebSocket used **only** for
server to client push is not meaningfully better than SSE, and is more complex
(upgrade, keepalive, a stateful connection to hold). The historical SSE penalty
(HTTP/1.1's ~6-connections-per-origin limit) is moot on HTTP/2. Therefore:

- **Reactive reads ("my data stays fresh")** ride the existing SSE `live` loader.
  A server-driven feature like "cards move on their own" is an SSE live loader,
  not a socket.
- **A socket earns its place only for the client to server leg on the same
  connection**: one authenticated stateful session (vs. SSE+POST re-auth per
  message), low latency for high-frequency input, ordering/correlation between
  input and the resulting push, two-way backpressure, and presence/liveness as a
  first-class signal. That means live cursors, typing indicators, broadcasting an
  in-flight drag position, collaborative editing, chat.

This split drives the demo plan: the board's auto-moving cards are an SSE live
loader (PR 2); the WS layer is demoed on live cursors + presence (PR 4), which
SSE genuinely cannot do.

## Goals

- A strictly-typed channel address (name + payload + params) eliminating
  stringly-typed topics, the universal footgun across Socket.IO/Phoenix/Ably/
  PartyKit.
- Upgrade the existing `live` loaders from per-isolate single-producer streams to
  real fan-out (cross-connection on Node, cross-isolate on Cloudflare) via a
  typed channel they subscribe to and an action-side `publish()`.
- A duplex socket primitive and a rooms/presence layer for genuinely two-way,
  session-bound features.
- Node and Cloudflare parity behind one adapter seam.

## Non-goals (v1)

- Re-building the live-loader consumption layer (shipped in PR #133).
- Convex-style automatic dependency tracking (we do not own a database; reactive
  re-push is driven by explicit channel `publish`).
- Runtime schema validation on sockets only. The framework's wire is types-only
  with one confined cast boundary (`serialize.ts`, `action-envelope.ts`); actions
  already ingest untrusted bodies with no validator. Sockets match that exactly:
  types-only, validate-in-handler. First-class validation, if ever, lands on
  loaders/actions/sockets together, not bolted onto sockets.
- Request/reply on the message channel (actions are the typed request/reply RPC).
- Delta/CRDT live-loader payloads (coarse re-run v1).
- Touching the demo activity bar (stays on its SSE `live` loader).

## Architecture

```
                 defineChannel  -- typed descriptor (name + payload + params), pure-type
                       |
        +--------------+-------------------------------+
   Layer A: PubSubBackend (publish/subscribe by Topic) |  adapter seam
        |                                              |
   existing `live` loaders                  Layer C: sockets -> rooms
   (server->client, SSE)  <-- channel source           (duplex, WS)
        +--------------+-------------------------------+
              Node: in-process Map  |  Cloudflare: one hibernating connection-DO
```

Unifying insight: on Cloudflare a "topic-DO" (read-only source for live loaders)
and a "room-DO" (duplex for rooms) are the **same** DO class (holds connections
for a key, fans out, hibernates). Build it once; live loaders subscribe
read-only, rooms use it duplex, presence reads its connection set.

## The typed-channel substrate (`defineChannel`)

Pure-type module in `packages/iso`, reusing the route param structural engine
(#95), no codegen. The `serverRoute`/`buildPath` analog for channels.

```ts
export const boardChannel = defineChannel('board/:projectId')<{
  taskId: string; to: TaskStatus; by: string;
}>();
//   Channel<{ projectId: string }, Payload>
boardChannel.key({ projectId: 'p1' }); // -> branded Topic<Payload> ('board/p1')
```

- Channel names use the `/:param` route grammar so the existing param-extraction
  type runs over them verbatim (the one PR-1 implementation check: confirm that
  engine is delimiter-agnostic; if `/`-anchored, the grammar reuses it for free).
- **Strict construction / permissive wire**: layers accept only `Topic<P>`; the
  brand carries the payload type; `PubSubBackend` stays string-keyed underneath
  (DOs key on strings), exactly as `buildPath` is a typed skin over string hrefs.
- **Factory-only**: no global registry/module-augmentation needed (no
  external-string-matching requirement, simpler than URLs). Wildcard subscription
  (`board/*`) is a deliberate later extension.
- Vocabulary: **channel** = the typed address; **room** = the duplex runtime at
  that address.
- Optional synergy: a channel may be derived from a route
  (`serverRoute('/demo/projects/:projectId').channel<Payload>()`) inheriting the
  route's params, the tightest binding between page, its live data, and its
  channel, all from one typed source.

## Layer A: pub/sub fan-out backend

```ts
interface PubSubBackend {
  publish<P>(topic: Topic<P>, message: P): void | Promise<void>;
  subscribe<P>(topic: Topic<P>, onMessage: (msg: P) => void): { close(): void };
}
```

- Adapter-supplied (`HonoPreactAdapter.pubsub?`), mirroring the WS seam. Node =
  in-process `Map<topic, Set<subscriber>>` (the `activity-stream.ts` pattern,
  generalized into the framework). Cloudflare = a Durable Object per topic
  (`idFromName(topic)`), registry held via the hibernation API.
- Async-tolerant (CF may cross to a DO; Node resolves synchronously).
- Delivery transport is adapter-chosen (SSE on Node, WS-to-DO on Cloudflare for
  hibernation economics); the developer API is identical.

### Feeding the existing `live` loaders

A `live` loader runs an async generator. Layer A provides the blessed way to
write that generator as "subscribe to a typed channel," so re-push happens on
any `publish` to the channel, with fan-out:

```ts
// channel-driven live loader (sugar over defineLoader(gen, { live: true })):
export const serverLoaders = {
  board: route.liveLoader({
    channel: boardChannel,
    key: ({ location }) => ({ projectId: location.pathParams.projectId }),
    load: async ({ location }) => { /* the existing one-shot board loader body */ },
  }),
};
```

which desugars to the existing shipped consumption path:

```ts
async function* gen(ctx) {
  yield await load(ctx);                          // initial value
  const sub = backend.subscribe(boardChannel.key(key(ctx)));
  try { for await (const _ of sub) yield await load(ctx); } // re-run + push per publish
  finally { sub.close(); }
}
// consumed by the EXISTING accumulating loader.View(render, { initial, reduce })
```

Actions/server agents publish through the same descriptor (no drift between where
data changes and where it is pushed):

```ts
// patchTask action and the demo server agent:
setTaskStatus(taskId, to, userId);
publish(boardChannel.key({ projectId }), { taskId, to, by });
```

- Rides the existing `/__loaders` SSE transport; no new wire format on Node.
- Coarse re-run per publish (debounce; re-applies the loader's `use` guards each
  run, a guard throw closes the stream, covering auth revocation). Deltas later.
- `invalidate` still forces a re-run; `publish` is the normal path.

## Layer C: the duplex WS primitive, then rooms

### C.1 the primitive

`route.socket` / `defineSocket` / `useSocket`. The server module exports a
`serverSockets` map, riding the existing `.server` triad by adding
`'serverSockets'` to `RECOGNIZED_SERVER_EXPORTS` (`server-exports-contract.ts`);
module-key injection, client strip, and build-time export validation are all
inherited. No `.socket` suffix.

```ts
// project-board.server.ts
export const serverSockets = {
  feed: route.socket<Incoming, Outgoing, Data>({
    use: [requireUser],                       // guards run in the upgrade factory
    open(socket, ctx) { /* ctx.params typed via route colocation */
      return subscribeSomething(...);          // returning the cleanup fn = teardown
    },
    message(socket, msg) { /* msg: Incoming (discriminated union) */ },
    close(socket, e) {}, error(socket, e) {},
  }),
};
```

```tsx
const sock = useSocket(serverSockets.feed, {
  onMessage(msg) { /* msg: Serialize<Outgoing>; callback default, no per-frame re-render */ },
});
// sock.status: 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed'
// sock.send(msg) (bounded queue while not open); sock.closeInfo?.code (e.g. 4403)
```

- Single endpoint `GET /__sockets?m=<moduleKey>&s=<name>`, mirroring `/__loaders`;
  `createServerEntry` registers it off a generated registry keyed by
  `moduleKey::name` (the same identifiers loaders carry), built by the route-tree
  walk that already collects loader/action maps.
- Messages: typed **discriminated union** (matches Elysia and the framework's own
  loader/action idiom; not a Socket.IO event-map). `Serialize<T>` both directions.
- Guards run before upgrade; deny upgrades then `close(4403)` so the client gets a
  real close code (a rejected handshake is opaque `1006` in browsers).
- Client hook: callback `onMessage` by default, `status` as the one reactive
  value, capped-backoff finite-retry reconnection with a bounded send queue, app
  close codes (`4403`/`4408`) passed through; `shouldReconnect` defaults to no on
  `1000`+`4xxx`. (Defaults from `reconnecting-websocket`/`react-use-websocket`.)
- Adapter seam `HonoPreactAdapter.websocket?` supplies the upgrade helper (Node:
  `@hono/node-ws`, formalizing today's `injectWebSocket`; CF:
  `hono/cloudflare-workers`). A socket author never imports a cloud helper.
- Depends only on the WS seam, not on Layer A.

### C.2 rooms + presence

`route.room` / `defineRoom`, bound to a channel descriptor and Layer A:

```ts
export const serverRooms = {
  board: route.room(boardCursorChannel, {
    use: [requireMember],
    onMessage(conn, msg) { conn.broadcast(msg); },  // -> backend.publish(roomTopic, msg)
  }),
};
```

- `broadcast(msg, exclude?)` implemented via `backend.publish(roomTopic, msg)`
  with every connection subscribed to the room topic (PartyKit shape).
- Presence derived from the room's connection set; single-DO-per-room is
  authoritative so no CRDT (unlike Phoenix's multi-node Presence).
- Reconnect replay: the room buffers a short ring and replays via `lastEventId`
  on reconnect (`tracked()` pattern), the one genuinely new lifecycle concern.

## Cloudflare backend

One hibernating connection-holding Durable Object backs both topics (Layer A) and
rooms (Layer C): `acceptWebSocket` + tags + `getWebSockets`, per-connection state
in tags/`serializeAttachment` (never instance vars, so it is hibernation-correct
by construction), auto-response ping/pong. The codegen re-exports the DO class
from the generated server entry (as it already re-exports the default fetch
handler); the CF adapter adds/validates the `wrangler.jsonc` DO binding +
migration. **This deploy-config wiring is the single biggest cost in the
program.**

## PR breakdown (one spec, a PR at each barrier)

| PR | Scope | Depends on | Dogfood / acceptance |
|----|-------|-----------|----------------------|
| **1. Typed channel substrate** | `defineChannel`, `Channel`/`Topic`, branded `.key()`, route-engine reuse | shipped #133 | `*.test-d.ts` type tests; verify the param engine is delimiter-agnostic for `/:param` channel names |
| **2. Layer A backend + channel-driven live loaders (Node)** | `PubSubBackend` seam + in-process impl + `publish`/`subscribe` + `route.liveLoader` sugar over the existing `{live:true}`/`.View` | 1 | board loader becomes a channel-driven live loader; `patchTask` + a server agent `publish`; **cards move on their own**, with animated cross-column FLIP (top-layer ghost to beat the `overflow-x-auto` clip). Reactive-data slice complete on Node |
| **3. Layer C.1 WS primitive (Node)** | `route.socket`/`defineSocket`/`useSocket`, `serverSockets` codegen, `/__sockets`, WS adapter seam | shipped #133 | move-over-socket or a minimal presence ping on Node |
| **4. Layer C.2 rooms + presence (Node)** | `route.room`/`defineRoom`, broadcast, presence, reconnect replay | 1, 2, 3 | **live cursors + presence on the board** (the SSE-impossible demo) |
| **5. Cloudflare backend** | the hibernating connection-DO backing topics + rooms; wrangler binding + migration codegen; DO re-export; WS-to-DO delivery | 2, 4 | A + live loaders + rooms parity on CF under `wrangler dev` |

Ordering payoff: PRs 1-2 deliver the entire typed reactive-data feature on Node,
reusing the shipped `live .View` consumption, and are likely the highest
value-per-effort slice. PRs 3-4 add duplex where it is actually justified. PR 5
pays the Cloudflare DO/deploy tax once and lights up everything. Each PR follows
the standing process: the 7-step pre-push CI mirror, deep PR review on open
(replacement-parity + cross-cutting middleware/auth tracing), size/lighthouse
baselines, dogfood-or-document.

## Cross-cutting (held constant with the framework)

Guards via the existing `use` chain + `compose-server-chain`; `Serialize<T>` at
every wire boundary; types-only validation; SSR unchanged (a `live` loader never
runs on the server; reactivity is post-hydration); the demo activity bar stays on
its SSE `live` loader.

## Decisions locked during the brainstorm

SSE for reactive reads, WS only for the same-connection client to server leg ·
live-loader consumption reused from PR #133 (not rebuilt) · discriminated-union
messages (not event-map) · types-only validation (no socket-only schema hook) ·
`.server` + `serverSockets`/`serverRooms` (no `.socket` suffix) · single
`/__sockets` registry endpoint; live loaders ride `/__loaders` · `route.*` for
route-bound + typed params, bare `define*` otherwise · request/reply out of core ·
`open()` returns a teardown fn · typed channels via `defineChannel` (branded
`Topic`, factory-only, route-engine reuse) · channel = address / room = runtime ·
one hibernating connection-DO on Cloudflare · coarse re-run v1 · activity bar
untouched.

## Risks & open questions

1. **Param-engine reuse** for `/:param` channel names, the load-bearing PR-1
   assumption (verify delimiter-agnostic; parameterize if not).
2. **Live-loader coarse re-run cost** under high publish rates (debounce v1;
   deltas later).
3. **Cloudflare deploy-config automation** (auto-editing `wrangler.jsonc`
   migrations vs. documenting it), the biggest unknown.
4. **Optimistic + socket coexistence** on the board (status over socket, priority
   over action), an integration detail the pressure test surfaced.
5. **Reconnect replay semantics** (ring size, dedup, `lastEventId`) for rooms.
