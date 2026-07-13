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

**`serverRoute(r).socket` and `.room` are RELEASED exports, not new ones.** Both arms ship in `hono-preact@0.10.1` (`git show v0.10.1:packages/iso/src/server-route.ts` carries the `socket<...>` / `room<...>` signatures and the `socket: (handler) => defineSocket(handler)` / `room: (channel, handler) => defineRoom(channel, handler)` implementations, and `serverRoute` is exported from the public barrel). They simply **discarded the route argument**, which IS the bug this work closes. A released app can and does call `serverRoute('/board/:id').socket(...)` today; it just runs with no route gates.

Every earlier version of this note reasoned from the opposite premise ("the binder is unreleased, so nobody has shipped against it") and therefore under-recorded the break surface. Correcting that is the point of this section. Genuinely non-breaking: `SocketRef`'s `Params` slot defaults to `{}` (a bare `SocketRef<In, Out>` reference and every `defineSocket` call stay source-compatible), the `data` factory's second argument is optional to read, and the `SOCKET_ROOM_PARAM` -> `SOCKET_KEY_PARAM` rename is an internal contract constant. Everything below breaks released code.

1. **`defineChannel` now throws at definition time on a non-conforming param name.** `defineChannel` shipped in v0.8.0. A channel name whose `:`-segment carries a character outside `[A-Za-z0-9_]` (a hyphen, most commonly, but also a `:` anywhere in a segment other than its start, e.g. `board:boardId`) now throws immediately, where it previously defined a channel whose param `interpolatePattern`/`requiredParamSlots` silently never recognized. A statically-named channel with an embedded colon, e.g. `defineChannel('metrics:cpu')`, also now throws: `RouteParams<'metrics:cpu'>` already typed a required `cpu` param that `interpolatePattern` never substituted, so that channel was already broken (every call collapsed onto the literal topic `'metrics:cpu'`) before this check existed. The throw surfaces a pre-existing bug rather than introducing a new restriction; there is no silent-behavior escape hatch, only a rename.
2. **`useSocket`/`useRoom` moved from `(ref, opts?)` to a conditional rest tuple.** Both hooks shipped in v0.8.0 with a plain optional second parameter. This branch (`fdb53008`, `ee630297`) switched both to an exported `UseSocketArgs<R>`/`UseRoomArgs<R>` rest tuple, so the options argument is itself required exactly when the bound route/channel has params (previously `useSocket(boundRef)` with the options argument omitted entirely compiled even though a param-bearing binding required `params` once an options object was actually passed). A generic wrapper written against the old signature, e.g. `function f<R extends SocketRef<unknown, unknown>>(ref: R, opts?: UseSocketOptions<R>) { return useSocket(ref, opts); }`, no longer type-checks: `opts` is no longer assignable to the rest tuple's positional slot. `UseSocketArgs`/`UseRoomArgs` are now exported from the public barrel (`packages/iso/src/index.ts`) precisely so such a wrapper can forward the tuple by name instead of re-deriving it; see the type-level pins in `define-socket.test-d.ts` / `define-room.test-d.ts`.
3. **`useRoom`'s `KeyOption` no-params branch changed from `{ key?: P }` to `{ key?: never }`.** A param-less channel's `key` option is now a real type error to assign to (previously `P` was `{}`, which structurally accepted almost any object, so a stray `key` value silently type-checked). Code that passed a stray `key` to a param-less room's `useRoom` no longer compiles; this is the intended tightening (mirrors `useSocket`'s existing `ParamsOption`, itself part of this same branch), not a regression.
4. **Room route/channel congruence now fails the boot.** This covers BOTH a colocated room (`defineRoom` colocation shipped in v0.9) and an explicitly bound `serverRoute(r).room` (shipped in v0.10.1). A room whose owning route declares a param the channel does not carry (for example route `/board/:id` next to `channel('board/:boardId')`) booted fine before and now fails to boot, because its guard would read `pathParams.id` as `undefined`. The check runs against the room's effective owning route: the declared `__routeId` for a bound room, or the module mount for a colocated one.

   The throw is scoped to rooms that actually have a guard which could misread the param. It fires when ANY of the three guard tiers is non-empty: the app tier (`defineApp({ use })`), the page tier (route/layout `use`), or the room's own `use`. All three receive the same `ctx.location.pathParams`, so any one of them can read a param the channel never supplies. When all three are empty there is no guard to mislead, so the boot is allowed and a dev-only advisory fires instead, noting that a guard added later would read the param as `undefined`.

   Three escape hatches: rename the channel or route param so the names match; move the room into a `src/server` registry module with no `serverRoute` binding (a bare registry room is route-independent and is not congruence-checked); or, if the room is deliberately route-independent, leave it on a guard-less route (the exemption above). A room on a param-less route is unaffected.

5. **A param-bearing `serverRoute(r).socket` now REQUIRES `params`, at compile time and at runtime.** The binder shipped in v0.10.1 discarding the route, so a released app could write `serverRoute('/board/:id').socket(handler)` and consume it as `useSocket(ref)` or `ref.useSocket({ onMessage })`. Both now fail to compile (`SocketRef`'s `Params` is `RouteParams<RouteId>`, so `UseSocketArgs` makes the options argument required and `params` mandatory), and a client that forces past the types is denied `4403` on every connection for a missing slot. Fix: pass the route params, `useSocket(ref, { params: { id } })`. Note what such an app was actually doing before: running the socket with NO route gates at all, which is the auth hole this work closes. The break is real, and the pre-break behavior was unsafe.

6. **A route-bound socket or room on a route with a non-conforming `:param` now fails the boot.** A released app may serve `/board/:board-id` over HTTP (preact-iso's route matcher binds hyphenated params), and may have bound a socket or room to it. The framework's own param grammar is `[A-Za-z0-9_]+`, so `requiredParamSlots` / `declaredParamSlots` / `RouteParams` all see no param there, which means a bound socket would require nothing, resolve `{}`, never deny, and hand its guard an empty param the type contract promised. That silent degradation now throws at boot instead. Ordinary HTTP routes, loaders, actions, and colocated (unbound) sockets/rooms on the same route are deliberately NOT affected, so an app that merely serves the route keeps booting. Fix: rename the route param to the supported class, or drop the `serverRoute(...)` binding.

7. **`defineRoom` now re-validates a hand-rolled `Channel`.** `Channel` is a public type export (shipped with `defineChannel` in v0.8.0), so a released app could construct one directly as a `{ name, key }` literal without ever calling `defineChannel`, bypassing its name-conformance check entirely. `defineRoom` (and `serverRoute(r).room`) now run the SAME check on the `channel` argument, so a hand-rolled `Channel` whose `name` carries a non-conforming `:`-segment now throws at the `defineRoom`/`serverRoute(r).room` call instead of silently collapsing every connection onto one degenerate constant topic. Fix: construct the channel with `defineChannel` (which already validated the name), or rename the segment to the supported `[A-Za-z0-9_]` class.

8. **`resolveRoomKey` now drops undeclared wire keys.** A room's `onJoin` `ctx.params` and a room/socket guard's `pathParams` are now restricted to the channel/route pattern's own declared `:param` slots; a key on the `r=` wire that the pattern does not declare is silently dropped rather than passed through. A released room that (knowingly or not) relied on an extra wire key reaching `onJoin`'s `params` or a guard's `pathParams` no longer sees it there. This closes a client-injection surface (a connection could otherwise smuggle an arbitrary extra key onto the wire that no real page navigation could ever produce), so the pre-break behavior was unsafe; the fix is to stop relying on undeclared keys and pass real data through the `data` factory (edge-derived, not wire-derived) instead.

Items 1-8 all need an entry in the v0.11 release notes.

## Rejected alternatives

- **Location-mirror (reuse the loader's current-URL wire for both sockets and rooms).** Simplest single model, but it inherits the loader's congruence-by-convention with no backstop: a socket consumed off its bound route sends the wrong params or none, with no deny. Worse for rooms, the guard would authorize on the client's page URL instead of the server-authoritative channel key, a real security downgrade for the case rooms exist to handle.
- **Rooms-only param auth (boot-forbid param-bearing sockets).** Safe and small, but it drops the chosen intent that a bound socket be able to authorize on its route param.
- **Explicit per-param correspondence for rooms (stronger #3 fix).** Require `route.room` to name which channel param satisfies each route param (identity written as `{ id: 'id' }`), killing name-magic entirely. Rejected as the default because it puts boilerplate on every correct-and-identical binding to defend against a mistake that fail-closed guards already catch; retained here as the available escalation if the dev advisory proves too soft.

## Known limitation

Congruence is by param **name**, so `/org/:id` bound to `channel('board/:id')` (same name, different resource) passes the boot check and feeds the org guard a board id. Unlike a loader (whose params come from the same route's URL, safe by construction), a room's params come from a different pattern that only shares a name, so this is a genuine aliasing risk, not a theoretical one. It is mitigated, not eliminated: the dev advisory surfaces every param correspondence for the author to eyeball, and the fail-closed guard contract turns a wrong-resource id into a deny in the common case. The residual (colliding id namespaces across two resources) is a pre-existing system-design hazard the framework does not attempt to solve.
