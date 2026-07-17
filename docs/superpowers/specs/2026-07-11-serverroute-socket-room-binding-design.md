# serverRoute(r).socket / .room: make the arms really bind

_2026-07-11. Closes item 1 of issue #273 (P0-class contract/auth finding from the 2026-07-11 framework quality comparison rerun). Design approved by maintainer; direction chosen over "throw on the arms" and "remove the arms"._

## Problem

`serverRoute(r).socket(handler)` and `serverRoute(r).room(channel, handler)` (`packages/iso/src/server-route.ts:201-202`) silently discard the `route` argument: they delegate to plain `defineSocket`/`defineRoom` and stamp nothing. Their docstrings promise route binding ("Define a duplex WebSocket bound to this route", "Attaching the room to the route node ... wires its `use` inheritance").

Guard resolution for a `/__sockets` connection actually derives the owning route from the module mount: `resolveConnection` (`packages/server/src/socket-resolution.ts:289-292`) calls `resolveRoutePath(moduleKey)` and falls back to `SOCKETS_RPC_PATH` when the module is not in the route tree. Consequences:

- In a route-attached module, the arms appear to work only because the mount supplies the binding; the declared route is never checked against it. A declared route that disagrees with the mount is silently ignored.
- In a `src/server` registry module, there is no mount, so a `serverRoute('/admin').socket(...)` resolves to `SOCKETS_RPC_PATH`, `resolvePageUse` returns `[]`, and the connection runs with **no page-tier gates**.
- The boot guards (`packages/server/src/route-binding-guard.ts`) scan only `serverLoaders`/`serverActions` (`CONTAINERS`, :15-18), so neither a boot error nor a dev warning fires for either case.

This is the dropped-page-guard auth-bypass class the loaders and actions handlers were hardened against in #194/#212/#217, reintroduced on the realtime arms of the same binder.

## Decision

Make the arms bind for real, mirroring the loader/action model exactly: stamp the declared pattern, validate it fail-closed at boot, and prefer it during connection resolution. Rejected alternatives: throwing at define time or removing the arms (both break route-attached users for whom the arms work today via the mount, and leave registry users no way to gate sockets); docs-only demotion (rejected by the report: the API should not promise gates it does not run).

## Design

### 1. Binder stamping (packages/iso)

- New internal constructors, colocated with the def shapes they stamp (each module owns its def):
  - `_defineRouteSocket(routeId, handler)` in `define-socket.ts`
  - `_defineRouteRoom(routeId, channel, handler)` in `define-room.ts`
- Each calls the public `defineSocket`/`defineRoom` and sets `__routeId: routeId` on the returned object, mirroring `_defineRouteLoader` (`define-loader.ts:442-477`) and `_defineRouteAction`.
- `SocketDef` and `RoomDef` gain `readonly __routeId?: string` so the server-side reads are typed, not cast. The property is a plain optional field like the loader's; the boot guard's structural read (`(value as RouteBoundExport).__routeId`) works unchanged.
- `serverRoute` arms (`server-route.ts:201-202`) switch to the new constructors. The `RouteId` generic already admits `RegisteredPaths | RegisteredSubtrees`, so subtree spellings (`serverRoute('/admin/*').socket`) type-check today and become meaningful with this change; no type surface changes.
- Internal constructors are exported from the internal barrel only (same door as `_defineRouteLoader`), never from the public barrel.

### 2. Boot guard extension (packages/server/src/route-binding-guard.ts)

- `CONTAINERS` grows two rows: `['serverSockets', 'socket']`, `['serverRooms', 'room']`.
- `BoundUnitKind` widens to `'loader' | 'action' | 'socket' | 'room'`.
- No other logic changes: both assert functions iterate `CONTAINERS`, so sockets/rooms inherit the full rule set automatically:
  - `assertRouteBindingsMatchMount`: declared pattern must equal the mount path or its subtree sibling; childless-wildcard binding is a boot error.
  - `assertRegistryRouteBindingsValid`: a registry module's declared pattern must be a real `routeUse` key (exact or subtree), else boot error.
  - `maybeReportAliasedBinding` / `warnAliasedLayoutBinding`: the dev aliasing diagnostic fires for exact-bound sockets/rooms on index-widened layouts, same as loaders.
- The existing error messages are already `kind`-parameterized and their wording ("resolves its page-level `use` (auth) chain from the wrong route") is accurate for the new kinds; review the `serverRoute('...')` fix-suggestion phrasing renders sensibly for socket/room and adjust only if a message reads wrong.
- Bare defs (no `__routeId`) are skipped, exactly as bare loaders are.

### 3. Resolution precedence (packages/server/src/socket-resolution.ts)

- `resolveConnection` derives the owning route path as, in order:
  1. `def.__routeId` when present (a typed read once SocketDef/RoomDef carry the field),
  2. `resolveRoutePath(moduleKey)` (module mount, today's behavior),
  3. `SOCKETS_RPC_PATH` (matches no pattern; app-use + def-use only).
- Safety argument: every stamped `__routeId` is validated by the boot guards before the entry serves (the generated entry awaits the asserts before serving, and in dev re-runs them per request), so the `byPattern` exact-key lookup cannot fail open for a bound def. Declared-vs-mount disagreement is impossible at request time because it is a boot error.
- This is the single change point for both runtimes: the Node `createEvents` path and the CF edge connector both consume `resolveConnection`, so Node and Cloudflare cannot drift.

### 4. Deliberately unchanged

- Plain-socket guards still receive `pathParams: {}`: the `/__sockets` endpoint is query-string-only, and binding selects the **use chain**, not param typing. Add a doc note at the `.socket` arm docstring and at `resolveGuardDenied`'s `pathParams` doc: a guard on a param-bearing pattern sees `{}` for plain sockets (already true today for mount-derived resolution).
- Room `ctx.params` stays channel-derived (`RouteParams<Name>` of the channel pattern); the route contributes only the use chain, as the `.room` docstring already states.
- Bare `defineSocket`/`defineRoom` semantics are untouched: route-attached bare defs keep mount-derived gates; registry bare defs keep app-use + def-use (route-independent by design, like bare loaders). Gating bare registry defs is out of scope.
- Client hooks, client stubs, and the wire protocol: untouched. `__routeId` is server-resolution-only; `useSocket`/`useRoom` keep addressing by `moduleKey::name` query params. (Plan phase verifies the Vite client stubs for `serverSockets`/`serverRooms` do not need to carry the field; they should not, since no client code reads it.)
- Typed route params for sockets remain "reserved for a later release" per the existing docstring.

## Failure modes and messages

| Case | Before | After |
|---|---|---|
| Registry module, `serverRoute('/admin').socket(...)` | Silently gateless (SOCKETS_RPC_PATH fallback) | Runs `/admin`'s composed page gates; unknown pattern is a boot error |
| Route-attached module, declared route != mount | Declared silently ignored (mount wins) | Boot error (same message family as loaders) |
| `serverRoute('/leaf/*').socket(...)` on a childless node | Silently gateless | Boot error (childless-subtree message) |
| Exact binding on an index-widened layout | No signal | Dev aliasing warning (same as loaders) |
| Bare `defineSocket` in a registry module | app-use + def-use | Unchanged (documented) |

## Testing (TDD; tests written first)

1. **Boot fail-closed, per new kind** (extend the route-binding-guard suite): declared != mount for a socket and for a room; childless-wildcard socket; registry socket/room bound to a non-existent pattern. Each asserts the throw and the message names the kind.
2. **Attacker-model regression (the report's ask)**: a registry-module socket bound `serverRoute('/admin')` where `/admin` carries a deny guard: the upgrade is refused (WS_DENY_CODE path), and the same setup minus the guard connects. Twin test for a room via `serverRooms`. This pins the previously-gateless branch.
3. **Precedence**: on a route-attached module, the declared SUBTREE spelling (`serverRoute('/admin/*').socket`) resolves the subtree chain, not the mount-derived exact chain (this is the one route-attached case where declared and mount-derived chains observably differ, since the boot guard forces exact declarations to equal the mount); a bare def still resolves via mount; a bare registry def still falls back to `SOCKETS_RPC_PATH`.
4. **Aliasing diagnostic** fires for an exact-bound socket on a layout whose index child widens the chain, and stays silent for the subtree spelling.
5. **Type-level** (`server-route.test-d.ts`): `.socket`/`.room` arms accept exact and subtree spellings of registered routes, reject unregistered strings; existing arm assertions still hold.
6. **Cross-runtime**: the existing workerd suites (`cf-socket.test.ts`, `cf-room.test.ts`) keep passing unchanged (resolution is shared, so no CF-specific change is expected); add a CF case only if the plan-phase read of `realtime-do-glue.ts` finds a second resolution site (not expected).

## Docs and release notes

- **Site docs sync**: sweep the realtime and typed-server pages for claims about `serverRoute(r).socket`/`.room`; they become true with this change, but check for wording that describes mount-only behavior. Per docs style memory: describe what is, no historical breadcrumbs.
- **v0.11 release-notes draft** (`docs/superpowers/specs/2026-07-11-v0.11-release-notes.md`, exists, maintainer-approved): add a breaking entry. Behavior changes on released v0.10 surface, all fail-closed: (a) previously-ignored declared routes now boot-error on mismatch; (b) registry sockets/rooms bound to a route now run that route's gates (connections that previously succeeded may now be denied, which is the fix working); (c) childless-wildcard socket/room bindings now boot-error. Note this will NOT show in an export-surface diff (no export changes), so the manual entry is load-bearing.

## Open items for the plan phase (verify, do not assume)

1. Confirm `src/server` registry modules feed `buildSocketRegistry`/`buildRoomRegistry` in `createServerEntry` (the report's verified finding implies they do; pin the wiring before writing test 2).
2. Confirm the Vite module-key plugin and `server-only.ts` stub paths treat `route.socket(...)`/`route.room(...)` calls inside `serverSockets`/`serverRooms` containers identically to bare `defineSocket`/`defineRoom` (container-based, not call-based, expected).
3. Confirm `realtime-do-glue.ts` has no second route-path derivation (expected: it consumes `resolveConnection`).
4. Check whether `sockets-handler.test.ts` / `socket-resolution` tests have fixtures to extend vs needing a new registry-module fixture.

## Out of scope

Typed route params for plain sockets; gating bare registry defs; the dead `preResolved` parameter cleanup (#273 item 10); any change to the 6KB budget, presence, or pub/sub paths.
