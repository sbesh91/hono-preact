# Unified route-param model for bound realtime units

_2026-07-12. Follow-on hardening for the `serverRoute(r).socket/.room` binding work (see `2026-07-11-serverroute-socket-room-binding-design.md`). Closes the two findings from the high-effort review of PR #274. Design approved by maintainer; Approach A chosen over "location-mirror" and "rooms-only param auth"._

## Problem

The binding PR made `serverRoute(r).socket/.room` really run the bound route's page-`use` guard (closing the auth-bypass in #273 item 1). But it left the guard reading param **values** that do not line up with the bound route pattern's param **names**:

- **Socket** (`socket-resolution.ts`): a bound socket's guard always runs with `pathParams: {}`. A guard on a param-bearing bound route (`/chat/:id`) reads `pathParams.id === undefined` and either throws (500 on every upgrade) or mis-authorizes.
- **Room** (`socket-resolution.ts`): a bound room's guard runs with the **channel** params (`channel('board/:boardId')` yields `{ boardId }`), not the **route** params (`/board/:id` yields `{ id }`). A route guard keyed on `pathParams.id` reads `undefined`. The name mismatch is not validated at boot.

The root asymmetry: the framework already has a coherent param model for route-bound **loaders** (guard chain resolved server-side by the `__routeId` pattern; param *values* ride the wire; names line up), but sockets and rooms do not participate in it. Rooms substitute channel params (a different namespace); sockets substitute nothing.

## Decision

Unify on a single guard-param contract and give each unit kind a validated source that guarantees the route pattern's param names are present. Bound sockets gain a typed `params` wire (the topic-less twin of a room's channel key); bound (and colocated) rooms get a boot-time congruence check between the route pattern and the channel. The guard, for every route-bound unit, reads `ctx.location.pathParams` under the bound route pattern's param names.

Rejected alternatives (see the closing section): the location-mirror model (reuse the loader's current-URL wire for both) and rooms-only param auth (boot-forbid param-bearing sockets).

## The unifying invariant

For any route-bound unit, the page-`use` guard reads route-param values from `ctx.location.pathParams` keyed by the **bound route pattern's** param names. Only the source differs, and each source is validated so the names are guaranteed present before the guard runs:

| Unit   | Param source                                              | Validation                                        |
| ------ | -------------------------------------------------------- | ------------------------------------------------- |
| Loader | client RPC `location.pathParams` (current URL)           | congruence by convention (consumed on-route)      |
| Room   | channel key (`r=`), server-recomputed `channel.key(...)` | **boot**: route params ⊆ channel params           |
| Socket | new typed `params` wire (`r=`), explicit binding only    | **runtime**: deny 4403 if sent params miss a slot |

## Design

### 1. Socket `params` wire (packages/iso)

Explicit `serverRoute(r).socket` binding gains a typed param wire; colocation does not (see Scope notes).

- **`SocketRef` gains a `Params` slot:** `SocketRef<Incoming, Outgoing, Params = {}>`, carrying `readonly __params?: Params` as a phantom, exactly as `RoomRef` carries `__params` from its channel. The `{}` default keeps every existing `SocketRef<In, Out>` reference and `defineSocket` call source-compatible.
- **`_defineRouteSocket` threads the route params type:** `_defineRouteSocket<In, Out, Data, RouteId>(routeId, handler): SocketRef<In, Out, RouteParams<RouteId>>`. The `serverRoute` `.socket` arm forwards its `RouteId` generic, so `serverRoute('/board/:id').socket(...)` yields `SocketRef<In, Out, { id: string }>` and a param-less binding (`serverRoute('/chat').socket(...)`) yields `SocketRef<In, Out, {}>`.
- **`useSocket` requires params iff the route has them:** `UseSocketOptions` intersects a `ParamsOption<Params<R>>` mirroring the room's `KeyOption`: `keyof P extends never ? { params?: P } : { params: P }`. So `useSocket(serverSockets.boardChat, { params: { id } })` is required and typed for a `/board/:id` binding, and absent for a param-less or unbound socket. `useSocket<R>` widens its constraint to `SocketRef<unknown, unknown, unknown>` to read the `Params` slot.
- **Wire:** `useSocket` JSON-encodes `opts.params` and appends it to the upgrade URL on the shared key wire (see section 4). The client stub is keyed by export name only, so `__routeId`/`__params` never reach the client bundle; the params the client sends are ordinary values it already has in scope (typically a route param off the page it renders on).

### 2. Socket server resolution (packages/server)

- **`resolveSocketParams(routePattern, raw)`** is the topic-less twin of `resolveRoomKey`: parse the `r=` JSON as an object of string values, validate it covers every `:slot` in the route pattern (non-empty string), and return `{ ok: true, params } | { ok: false }`. A param-less pattern requires nothing and returns `{ ok: true, params: {} }`. Slot extraction reuses the same pattern-slot helper `resolveRoomKey` uses against a channel.
- **`resolveConnection` socket branch:** call `resolveSocketParams(routePath, ctx.req.query(SOCKET_KEY_PARAM))`. On `ok: false`, return the connection as **denied** (close 4403) with a dev-mode warning naming the missing slots and the binding; this is a protocol-level reject independent of the guard, matching how a failed room key denies before `onJoin`. On `ok: true`, feed `params` to both the guard `pathParams` and the edge factory. An unbound socket (no `__routeId`) keeps `pathParams: {}` unchanged.
- **Edge factory sees the params:** `SocketHandler.data` widens to `data?: (c: Context, params: Params) => Data | Promise<Data>`, mirroring room `onJoin`'s `ctx.params`. The second arg is the same validated `params` object handed to the guard, so a socket bound to `/board/:id` can `db.board(params.id)` to seed `socket.data` without re-parsing the raw query. Additive: existing one-arg factories keep working.

### 3. Room boot congruence + dev advisory (packages/server)

- **Boot check (`route-binding-guard.ts`):** for every room whose effective owning route has params, require the route pattern's param names to be a subset of the channel pattern's param names (**route ⊆ channel**; the channel may be finer-grained, never coarser). A missing route slot is a boot error with a rename hint (`/board/:id` + `channel('board/:boardId')` fails: "route param `id` is not a key of channel `board/:boardId`; rename one so they match"). The "effective owning route" is the declared `__routeId` for an explicitly bound room, or the module mount for a colocated room (registry rooms with no `__routeId` are route-independent and skipped).
- **Dev-only aliasing advisory:** when congruence holds and the route has params, emit a once-per-binding dev advisory through the existing `onAliasedBinding` / `warned`-Set channel: _"room `cursors` bound to `/board/:id`: route param `id` is satisfied by the channel key of the same name; confirm they denote the same resource."_ Dev-only, deduped once per boot, stripped in prod. Nothing about the param correspondence is silent.
- **Fail-closed contract (documented):** the bound route must denote the same resource the channel keys on, and guards must fail-closed on unknown ids (`db.org(id)` for a non-org id returns null then `deny()`, the natural and required shape). This is the guardrail behind the known limitation below.

### 4. Shared plumbing

- **Generic key wire:** the `r=` query is now a shared key-params wire used by both rooms (channel key) and bound sockets (route params). Rename the constant `SOCKET_ROOM_PARAM` → `SOCKET_KEY_PARAM` (keep the `r` letter and encoding). The server tells socket from room by registry lookup (`socketDef` vs `roomDef`), so one wire serves both with no ambiguity.
- **Single resolution point:** all of the above lands in `resolveConnection`, which both the in-worker Node path and the Cloudflare edge connector already share, so no separate CF change is needed.

## Scope notes (please confirm at review)

1. **Socket param auth is explicit-binding only.** A colocated socket next to `/board/:id` cannot carry a typed `params` wire (the client stub is keyed by export name and does not know the mount route), so it keeps `pathParams: {}` and the existing "read query/headers in the socket's own `use`/`open`" guidance. Explicit `serverRoute('/board/:id').socket(...)` is the way to authorize a socket on a route param. This makes explicit binding strictly more capable than colocation, which is a feature, not a wrinkle.
2. **Room congruence covers colocation too.** The boot congruence check runs against the effective owning route, so a colocated room on `/board/:id` with a mismatched channel also fails boot, not just an explicitly bound one. This is broader than the two findings (which were about explicit binding) but closes the same hazard; included deliberately for completeness.

## Validation summary

- **Boot (rooms):** route ⊆ channel congruence against the effective owning route; existing `__routeId`-validity and mount-match checks unchanged.
- **Runtime (sockets):** `resolveSocketParams` denies 4403 when a param-bearing bound socket's wire omits a slot; dev-warns.
- **Type (sockets):** `useSocket` requires `params` typed from `RouteParams<RouteId>` iff the route has params.

## Testing

- **Type-level (`*.test-d.ts`, iso):** `useSocket` requires `params` for a param-bearing binding and rejects a missing/mistyped `params`; a param-less binding and an unbound `defineSocket` expose no `params` option; `RouteParams<RouteId>` shape flows to both `useSocket` and the `data` factory's second arg.
- **Runtime (server):** `resolveSocketParams` accepts a covering wire, rejects a missing slot / non-object / non-string value; `resolveConnection` denies 4403 on a bad socket wire and threads good params to the guard `pathParams` and the factory; room boot congruence passes on route ⊆ channel and throws with the rename hint on a missing slot, for both explicit and colocated rooms; the dev advisory fires once per binding and is silent in prod.
- **Regression:** unbound sockets and param-less bound sockets keep `pathParams: {}`; existing room key resolution (topic + `onJoin` params) is unchanged by the constant rename.

## Docs updates

This reverses doc text the binding PR just wrote:

- **`websockets.mdx`:** the "a plain socket never receives route path params" paragraph flips for the explicit-binding case: `serverRoute(r).socket` on a param-bearing route authorizes via a typed `params` option, surfaced to the guard and the `data` factory. Colocation still gets no param wire (Scope note 1).
- **`rooms.mdx`:** add the route ⊆ channel congruence rule and the same-resource expectation; the example keeps its matching param names, now as a stated requirement rather than a coincidence.

## Breaking-change surface

The socket-side changes are non-breaking for published users: `serverRoute(r).socket/.room` real binding is new in the unreleased base PR (#274), so the socket `params` wire is hardening a feature nobody has shipped against. `SocketRef`'s `Params` slot defaults to `{}`, so every existing `SocketRef<In, Out>` reference and `defineSocket` call stays source-compatible; the `data` factory's second argument is optional to read, so existing one-arg factories keep working. The `SOCKET_ROOM_PARAM` -> `SOCKET_KEY_PARAM` rename is an internal contract constant, not a public export.

**Colocated-room boot congruence IS a released-behavior break.** `defineRoom` colocation shipped in v0.9, before this branch existed. An app already on v0.9/v0.10 with a room colocated on a param-bearing route, whose channel does not carry that route's params (for example `/board/:id` next to `channel('board/:boardId')`), booted fine before this change and now fails to boot: the new route-⊆-channel congruence check in `route-binding-guard.ts` runs against the effective owning route for every room, and colocation is explicitly in scope (Scope note 2), not just explicit `serverRoute(r).room` binding. This is a hard boot error, not a silent behavior change: it fails loud and closed with an actionable rename hint naming the offending param and channel. Two escape hatches: rename the channel or route param so the names match, or move the room into a `src/server` registry module with no `serverRoute` binding (a bare registry room carries no `__routeId`, is route-independent, and is skipped by the congruence check entirely). A colocated room on a param-less route is unaffected, since the check early-returns when the route has no required params; that is also why this break is easy to miss when reasoning about the diff from the export surface alone.

This congruence break REQUIRES an entry in the v0.11 release notes.

## Rejected alternatives

- **Location-mirror (reuse the loader's current-URL wire for both sockets and rooms).** Simplest single model, but it inherits the loader's congruence-by-convention with no backstop: a socket consumed off its bound route sends the wrong params or none, with no deny. Worse for rooms, the guard would authorize on the client's page URL instead of the server-authoritative channel key, a real security downgrade for the case rooms exist to handle.
- **Rooms-only param auth (boot-forbid param-bearing sockets).** Safe and small, but it drops the chosen intent that a bound socket be able to authorize on its route param.
- **Explicit per-param correspondence for rooms (stronger #3 fix).** Require `route.room` to name which channel param satisfies each route param (identity written as `{ id: 'id' }`), killing name-magic entirely. Rejected as the default because it puts boilerplate on every correct-and-identical binding to defend against a mistake that fail-closed guards already catch; retained here as the available escalation if the dev advisory proves too soft.

## Known limitation

Congruence is by param **name**, so `/org/:id` bound to `channel('board/:id')` (same name, different resource) passes the boot check and feeds the org guard a board id. Unlike a loader (whose params come from the same route's URL, safe by construction), a room's params come from a different pattern that only shares a name, so this is a genuine aliasing risk, not a theoretical one. It is mitigated, not eliminated: the dev advisory surfaces every param correspondence for the author to eyeball, and the fail-closed guard contract turns a wrong-resource id into a deny in the common case. The residual (colliding id namespaces across two resources) is a pre-existing system-design hazard the framework does not attempt to solve.
