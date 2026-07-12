# serverRoute(r).socket/.room Real Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `serverRoute(r).socket` and `.room` actually bind their declared route: stamp it, validate it fail-closed at boot, and prefer it during connection guard resolution (closes issue #273 item 1, a P0-class auth-contract hole).

**Architecture:** Mirror the existing loader/action route-binding model end to end. The binder arms stamp `__routeId` on the socket/room defs via new internal constructors; the boot binding guard gains `serverSockets`/`serverRooms` containers so misbindings throw at boot; shared connection resolution (`resolveConnection`, consumed by both the Node and Cloudflare dispatch paths) prefers the declared pattern over the module-mount derivation; and the `/__sockets` endpoint awaits the boot binding check like the loaders RPC and action POST already do.

**Tech Stack:** TypeScript, Hono, Preact, vitest (unit + `--typecheck.only` type-level suites), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-07-11-serverroute-socket-room-binding-design.md` (in this worktree, commit `ca869475`).

**Verified during planning (do not re-derive):** (a) `src/server` registry modules DO feed the socket/room registries (`create-server-entry.ts:84` merges `serverRegistry` into `serverModules`, consumed by `buildSocketRegistry`/`buildRoomRegistry`), so the registry attacker scenario is real; (b) the Vite client stubs are container-keyed by export name (`server-only.ts:64-68`, `stub-templates.ts:55,72`), so `route.socket(...)`/`route.room(...)` call forms need NO vite change and `__routeId` never reaches the client; (c) the CF edge connector shares `resolveConnection` (`sockets-handler.ts:56` Node, `:159` CF), so Task 3 is the single resolution change point and no `realtime-do-glue.ts` change is needed.

## Global Constraints

- **Worktree:** all work happens in `/Users/stevenbeshensky/Documents/repos/hono-preact/.claude/worktrees/273-socket-room-binding` on branch `worktree-273-socket-room-binding`. Every absolute path MUST carry that prefix; a main-checkout absolute path silently edits the wrong tree. All relative paths below are relative to the worktree root.
- **No Serena tools** in this worktree (Serena binds to the primary checkout; its edits would land in the wrong tree). Use rg/Read/Edit.
- **Cross-package types flow through built dist:** after ANY `packages/iso` type change, run `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` before `pnpm typecheck` or any `packages/server` test run, or you will see fake "missing export" / stale-type errors.
- **No em-dashes** in prose, comments, or commit messages (use commas, colons, parentheses).
- **Cast discipline:** no new `as` casts in production code. The only sanctioned casts touched here are the pre-existing def-doubles-as-client-ref return sites in `define-socket.ts`/`define-room.ts` (keep their comments). Test files may use the structural-read cast idioms the surrounding tests already use.
- **Commits:** one per task, message style `feat(iso):` / `feat(server):` / `test(server):` etc. Never push and never use `--force` without explicit maintainer instruction.
- Run all commands from the worktree root.

---

### Task 1: Stamp `__routeId` in iso (binder arms + def types)

**Files:**
- Modify: `packages/iso/src/define-socket.ts`
- Modify: `packages/iso/src/define-room.ts`
- Modify: `packages/iso/src/server-route.ts:201-202` (the `socket:`/`room:` arms) and the two arm docstrings at :132-160
- Modify: `packages/iso/src/internal.ts` (add exports next to the existing `_defineRouteLoader` export at :93)
- Test: `packages/iso/src/__tests__/server-route-realtime.test.ts` (new)

**Interfaces:**
- Consumes: existing `defineSocket`, `defineRoom`, `SocketHandler`, `RoomHandler`, `Channel`, `RouteParams`.
- Produces (later tasks rely on these exact names):
  - `SocketDef<Incoming, Outgoing, Data>` gains `readonly __routeId?: string`.
  - `RoomDef<Incoming, Outgoing, State, Data, Params>` gains `readonly __routeId?: string`.
  - `_defineRouteSocket<Incoming, Outgoing, Data = undefined>(routeId: string, handler: SocketHandler<Incoming, Outgoing, Data>): SocketRef<Incoming, Outgoing>` exported from `define-socket.ts` AND from the `@hono-preact/iso/internal` barrel.
  - `_defineRouteRoom<Name extends string, Payload, State = void, Data = undefined>(routeId: string, channel: Channel<Name, Payload>, handler: RoomHandler<Payload, Payload, State, Data, RouteParams<Name>>): RoomRef<Payload, Payload, State, RouteParams<Name>>` exported from `define-room.ts` AND from the internal barrel.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/server-route-realtime.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineSocket } from '../define-socket.js';
import { defineRoom } from '../define-room.js';
import { defineChannel } from '../define-channel.js';

// The stamp is server-resolution-only, so it is not declared on the client
// ref types; read it structurally the way route-binding-guard does.
const routeIdOf = (v: unknown): string | undefined =>
  (v as { __routeId?: string }).__routeId;

describe('serverRoute(r).socket / .room route stamping', () => {
  const route = serverRoute('/admin/chat');
  const channel = defineChannel('board/:boardId')<{ n: number }>();

  it('.socket stamps the declared pattern as __routeId', () => {
    const ref = route.socket<{ ping: true }, { pong: true }>({});
    expect(routeIdOf(ref)).toBe('/admin/chat');
  });

  it('.room stamps the declared pattern as __routeId', () => {
    const ref = route.room(channel, {});
    expect(routeIdOf(ref)).toBe('/admin/chat');
  });

  it('bare defineSocket / defineRoom stay unstamped (route-independent)', () => {
    expect(routeIdOf(defineSocket({}))).toBeUndefined();
    expect(routeIdOf(defineRoom(channel, {}))).toBeUndefined();
  });

  it('stamped refs keep their ref-methods attached (SSR contract)', () => {
    const sock = route.socket({});
    const room = route.room(channel, {});
    expect(typeof (sock as { useSocket?: unknown }).useSocket).toBe('function');
    expect(typeof (room as { useRoom?: unknown }).useRoom).toBe('function');
  });

  it('handler fields survive the stamp (spread copies, not replaces)', () => {
    const open = () => {};
    const ref = route.socket({ open });
    expect((ref as { open?: unknown }).open).toBe(open);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/__tests__/server-route-realtime.test.ts`
Expected: FAIL. The two stamping tests fail with `expected undefined to be '/admin/chat'` (the arms currently discard the route). The bare/ref-method/spread tests pass.

- [ ] **Step 3: Implement the stamp in `define-socket.ts`**

Add `__routeId` to `SocketDef` (after the `__outgoing` phantom at `define-socket.ts:77`):

```ts
export interface SocketDef<Incoming, Outgoing, Data> extends SocketHandler<
  Incoming,
  Outgoing,
  Data
> {
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  /**
   * The declared route pattern when constructed via `serverRoute(r).socket`.
   * Read by the boot binding guard (fail-closed validation against the module
   * mount, or the route table for src/server registry modules) and by
   * connection resolution, where it takes precedence over the module-mount
   * derivation for the page-use (auth) chain. Absent on bare `defineSocket`
   * defs, which stay route-independent.
   */
  readonly __routeId?: string;
}
```

Refactor the constructor body into a shared maker and add the internal route-bound constructor (replace the current `defineSocket` function body at `define-socket.ts:107-126`; keep the existing comments where shown):

```ts
function makeSocketRef<Incoming, Outgoing, Data>(
  handler: SocketHandler<Incoming, Outgoing, Data>,
  routeId?: string
): SocketRef<Incoming, Outgoing> {
  // A copy of the handler IS the runtime def on the server; the type presents
  // as a client SocketRef. The build strips the body on the client and replaces
  // it with the descriptor stub, so this object only runs server-side.
  // Single sanctioned cast: the def-doubles-as-client-ref pattern, identical
  // to how defineAction returns a server fn typed as ActionRef (action.ts
  // uses `return fn as unknown as ActionRef<...>`). The cast is bounded to
  // this one return site.
  const ref = {
    ...handler,
    ...(routeId !== undefined ? { __routeId: routeId } : {}),
  } as unknown as SocketRef<Incoming, Outgoing>;
  // Attach the `.useSocket` ref-method to the def itself, for the same reason
  // `defineRoom` attaches `.useRoom`: SSR skips the `.server`->stub transform,
  // so a server-rendered component calling `serverSockets.x.useSocket(...)` runs
  // against this real def and would otherwise throw "useSocket is not a
  // function" (a bare 500). Without a module/socket key the hook stays
  // disconnected during SSR, matching the client's first hydration render.
  ref.useSocket = (opts) => useSocket(ref, opts);
  return ref;
}

/**
 * Define a typed duplex WebSocket. Place it in a `serverSockets` map in a
 * `.server` module; consume it with `useSocket(serverSockets.x)`.
 *
 * The handler only ever touches its own connection (`socket`); per-connection
 * state lives on `socket.data`. `open` may return a teardown fn.
 */
export function defineSocket<Incoming, Outgoing, Data = undefined>(
  handler: SocketHandler<Incoming, Outgoing, Data>
): SocketRef<Incoming, Outgoing> {
  return makeSocketRef(handler);
}

/**
 * Internal constructor behind `serverRoute(r).socket`: a `defineSocket` that
 * stamps the declared route pattern as `__routeId`, so the boot binding guard
 * validates the binding fail-closed and connection resolution resolves the
 * route's page-use (auth) chain from it. Framework-private; not part of the
 * public API.
 */
export function _defineRouteSocket<Incoming, Outgoing, Data = undefined>(
  routeId: string,
  handler: SocketHandler<Incoming, Outgoing, Data>
): SocketRef<Incoming, Outgoing> {
  return makeSocketRef(handler, routeId);
}
```

- [ ] **Step 4: Implement the stamp in `define-room.ts`**

Add `__routeId` to `RoomDef` (after the `channel` discriminator at `define-room.ts:107`):

```ts
export interface RoomDef<
  Incoming,
  Outgoing,
  State,
  Data,
  Params,
> extends RoomHandler<Incoming, Outgoing, State, Data, Params> {
  /** The channel this room is bound to. The discriminator vs a `SocketDef`. */
  readonly channel: Channel<string, unknown>;
  /**
   * The declared route pattern when constructed via `serverRoute(r).room`.
   * Same contract as `SocketDef.__routeId`: boot-validated, and preferred
   * over the module-mount derivation when resolving the page-use chain.
   * Absent on bare `defineRoom` defs.
   */
  readonly __routeId?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  readonly __state?: State;
}
```

Refactor the constructor (replace the `defineRoom` body at `define-room.ts:152-186`; keep the existing comments where shown):

```ts
function makeRoomRef<Name extends string, Payload, State, Data>(
  channel: Channel<Name, Payload>,
  handler: RoomHandler<Payload, Payload, State, Data, RouteParams<Name>>,
  routeId?: string
): RoomRef<Payload, Payload, State, RouteParams<Name>> {
  // The def (handler + channel) IS the runtime value on the server; the type
  // presents as a client `RoomRef`. The build strips the body on the client and
  // replaces it with the descriptor stub, so this object only runs server-side.
  // Single sanctioned cast: the def-doubles-as-client-ref boundary, identical
  // to how `defineSocket` returns a server def typed as `SocketRef`. The cast is
  // bounded to this one return site.
  const def: RoomDef<Payload, Payload, State, Data, RouteParams<Name>> = {
    ...handler,
    channel,
    ...(routeId !== undefined ? { __routeId: routeId } : {}),
  };
  const ref = def as unknown as RoomRef<
    Payload,
    Payload,
    State,
    RouteParams<Name>
  >;
  // Attach the `.useRoom` ref-method to the def itself. On the client the
  // `.server` import is replaced by a stub that attaches its own `.useRoom`, but
  // the build skips that transform for SSR, so a server-rendered component that
  // calls `serverRooms.x.useRoom(...)` runs against this real def. Without the
  // method, SSR throws "useRoom is not a function" (a bare 500). The def carries
  // no module/room key, so the hook stays disconnected during SSR (opening no
  // socket) and the markup matches the client's first hydration render.
  ref.useRoom = (opts) => useRoom(ref, opts);
  return ref;
}

export function defineRoom<
  Name extends string,
  Payload,
  State = void,
  Data = undefined,
>(
  channel: Channel<Name, Payload>,
  handler: RoomHandler<Payload, Payload, State, Data, RouteParams<Name>>
): RoomRef<Payload, Payload, State, RouteParams<Name>> {
  return makeRoomRef(channel, handler);
}

/**
 * Internal constructor behind `serverRoute(r).room`: a `defineRoom` that
 * stamps the declared route pattern as `__routeId`, so the boot binding guard
 * validates the binding fail-closed and connection resolution resolves the
 * route's page-use (auth) chain from it. Framework-private; not part of the
 * public API.
 */
export function _defineRouteRoom<
  Name extends string,
  Payload,
  State = void,
  Data = undefined,
>(
  routeId: string,
  channel: Channel<Name, Payload>,
  handler: RoomHandler<Payload, Payload, State, Data, RouteParams<Name>>
): RoomRef<Payload, Payload, State, RouteParams<Name>> {
  return makeRoomRef(channel, handler, routeId);
}
```

Keep the original `defineRoom` docstring (the "Define a typed broadcasting room bound to a `Channel`..." block) on the exported `defineRoom`.

- [ ] **Step 5: Wire the binder arms and update their docstrings in `server-route.ts`**

Update the imports (`server-route.ts:19-24`). After this change `defineSocket` and `defineRoom` have no remaining call sites in the file, so drop them; the final import blocks are exactly:

```ts
import {
  _defineRouteSocket,
  type SocketHandler,
  type SocketRef,
} from './define-socket.js';
import {
  _defineRouteRoom,
  type RoomHandler,
  type RoomRef,
} from './define-room.js';
```

Replace the two arms (`server-route.ts:201-202`):

```ts
    socket: (handler) => _defineRouteSocket(route, handler),
    room: (channel, handler) => _defineRouteRoom(route, channel, handler),
```

Update the `.socket` arm docstring (replace the block at `server-route.ts:132-138`):

```ts
  /**
   * Define a duplex WebSocket bound to this route. Consume with
   * `useSocket(serverSockets.x)`. Binding selects the route's page-level
   * `use` (auth) chain for the upgrade guard probe: the declared pattern is
   * stamped on the def, validated fail-closed at boot (against the module
   * mount, or the route table for src/server registry modules), and takes
   * precedence over the module-mount derivation. The handler receives
   * `ctx.c` (the Hono Context for the upgrade request); there is no
   * `ctx.params` field because the socket endpoint is query-string-only at
   * runtime, so a guard on a param-bearing pattern sees empty
   * `ctx.location.pathParams`. Binding selects the use chain, not param
   * typing; typed route params for sockets are reserved for a later release.
   */
```

Update the `.room` arm docstring's last sentence (the block at `server-route.ts:143-151`): replace "Attaching the room to the route node only wires its `use` inheritance." with:

```ts
   * Binding the route wires the room's page-level `use` inheritance: the
   * declared pattern is stamped on the def, validated fail-closed at boot,
   * and takes precedence over the module-mount derivation when the upgrade
   * guard chain is resolved.
```

- [ ] **Step 6: Export the internal constructors from the iso internal barrel**

In `packages/iso/src/internal.ts`, next to the existing line 93 (`export { _defineRouteLoader } from './define-loader.js';`), add:

```ts
export { _defineRouteSocket } from './define-socket.js';
export { _defineRouteRoom } from './define-room.js';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/__tests__/server-route-realtime.test.ts`
Expected: PASS (5 tests).

Also run the neighboring suites the refactor touches:
`pnpm exec vitest run packages/iso/src/__tests__/define-socket.test.ts packages/iso/src/__tests__/define-room.test.ts packages/iso/src/__tests__/use-socket.test.tsx packages/iso/src/__tests__/use-room.test.tsx`
Expected: PASS, no behavior change for bare defs.

- [ ] **Step 8: Rebuild dist and typecheck (cross-package types)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck`
Expected: both green. The build step is mandatory here: Task 2 onward reads `__routeId` off iso types from `packages/server`, which resolves them through the built dist.

- [ ] **Step 9: Commit**

```bash
git add packages/iso/src/define-socket.ts packages/iso/src/define-room.ts packages/iso/src/server-route.ts packages/iso/src/internal.ts packages/iso/src/__tests__/server-route-realtime.test.ts
git commit -m "feat(iso): stamp __routeId from serverRoute(r).socket/.room (#273 item 1)"
```

---

### Task 2: Extend the boot binding guard to sockets and rooms

**Files:**
- Modify: `packages/server/src/route-binding-guard.ts:9-18` (`SelfModule`, `CONTAINERS`), `:26` (`BoundUnitKind`), plus the two assert functions' doc headers
- Test: `packages/server/src/__tests__/route-binding-guard.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `__routeId` stamped by Task 1 (read structurally; no import needed).
- Produces: `BoundUnitKind = 'loader' | 'action' | 'socket' | 'room'`; `assertRouteBindingsMatchMount` / `assertRegistryRouteBindingsValid` now also scan `serverSockets` and `serverRooms`. Task 4 relies on the thrown messages containing `socket '<name>'` / `room '<name>'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/__tests__/route-binding-guard.test.ts` (it already imports everything needed; `routeOf`/`ctxOf` are the file's existing helpers):

```ts
describe('socket/room bindings (serverSockets / serverRooms containers)', () => {
  // Socket/room defs are objects, not fns; mirror the file's `bound` helper.
  const boundDef = (routeId: string): Record<string, unknown> =>
    Object.defineProperty({ open() {} }, '__routeId', {
      value: routeId,
      enumerable: false,
    });

  it('mount passes when a bound socket matches its mount path', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/chat') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).resolves.toBeUndefined();
  });

  it('mount throws when a bound socket declares a different route', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/other') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).rejects.toThrow(
      /Route-bound socket 'feed' is bound to route '\/other', but its module is registered on route '\/chat'/
    );
  });

  it('mount throws when a bound room declares a different route', async () => {
    const routes = [
      routeOf('/board', {
        __moduleKey: 'm',
        serverRooms: { board: boundDef('/elsewhere') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/board', []]]))
    ).rejects.toThrow(
      /Route-bound room 'board' is bound to route '\/elsewhere'/
    );
  });

  it('mount rejects a socket subtree binding on a childless route (fail closed)', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: boundDef('/chat/*') },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).rejects.toThrow(
      /socket 'feed' binds the subtree pattern '\/chat\/\*', but route '\/chat' has no child routes/
    );
  });

  it('registry throws when a bound socket targets a route not in the table', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverSockets: { feed: boundDef('/nope') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/chat', []]]))
    ).rejects.toThrow(
      /Route-bound socket 'feed' in the src\/server registry is bound to route '\/nope', which is not a route/
    );
  });

  it('registry throws when a bound room targets a route not in the table', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverRooms: { board: boundDef('/nope') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/chat', []]]))
    ).rejects.toThrow(/Route-bound room 'board'/);
  });

  it('registry passes when bound socket/room target real patterns', async () => {
    const registry = [
      async () => ({
        __moduleKey: 'src/server/rt',
        serverSockets: { feed: boundDef('/chat') },
        serverRooms: { board: boundDef('/chat') },
      }),
    ];
    await expect(
      assertRegistryRouteBindingsValid(registry, ctxOf([['/chat', []]]))
    ).resolves.toBeUndefined();
  });

  it('bare (unstamped) socket/room defs are skipped', async () => {
    const routes = [
      routeOf('/chat', {
        __moduleKey: 'm',
        serverSockets: { feed: { open() {} } },
        serverRooms: { board: { onJoin() {} } },
      }),
    ];
    await expect(
      assertRouteBindingsMatchMount(routes, ctxOf([['/chat', []]]))
    ).resolves.toBeUndefined();
  });

  it('aliasing diagnostic reports kind socket and room', async () => {
    const g1 = () => {};
    const g2 = () => {};
    const seen: AliasedBindingInfo[] = [];
    await assertRouteBindingsMatchMount(
      [
        routeOf('/app', {
          __moduleKey: 'm',
          serverSockets: { feed: boundDef('/app') },
          serverRooms: { board: boundDef('/app') },
        }),
      ],
      {
        routeUseByPattern: new Map([
          ['/app', [g1, g2]],
          ['/app/*', [g1]],
        ]),
        onAliasedBinding: (info) => seen.push(info),
      }
    );
    // CONTAINERS order: loaders, actions, sockets, rooms.
    expect(seen).toEqual([
      { kind: 'socket', name: 'feed', routeId: '/app', subtreeId: '/app/*' },
      { kind: 'room', name: 'board', routeId: '/app', subtreeId: '/app/*' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-binding-guard.test.ts`
Expected: the new throw-expecting tests FAIL with "promise resolved ... instead of rejecting" (the guard does not scan the new containers yet); the pass-expecting new tests pass vacuously; all pre-existing tests still pass.

- [ ] **Step 3: Implement the container extension**

In `packages/server/src/route-binding-guard.ts`, replace lines 9-18 and line 26:

```ts
type RouteBoundExport = { __routeId?: unknown };
type SelfModule = {
  serverLoaders?: unknown;
  serverActions?: unknown;
  serverSockets?: unknown;
  serverRooms?: unknown;
};

const CONTAINERS = [
  ['serverLoaders', 'loader'],
  ['serverActions', 'action'],
  ['serverSockets', 'socket'],
  ['serverRooms', 'room'],
] as const;
```

```ts
export type BoundUnitKind = 'loader' | 'action' | 'socket' | 'room';
```

Update the module-level doc comment at the top of the file (`:4-8`) from "A route-bound loader/action stamps..." to "A route-bound server unit (loader, action, socket, or room) stamps...", and in the `assertRouteBindingsMatchMount` doc header (`:91-117`) change "any route-bound loader/action" to "any route-bound unit (loader/action/socket/room)". Same one-line generalization in the `assertRegistryRouteBindingsValid` header (`:162-180`). No logic changes anywhere.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-binding-guard.test.ts`
Expected: PASS (all pre-existing plus the 9 new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/route-binding-guard.ts packages/server/src/__tests__/route-binding-guard.test.ts
git commit -m "feat(server): boot-validate socket/room route bindings (#273 item 1)"
```

---

### Task 3: Declared-pattern precedence in connection resolution

**Files:**
- Modify: `packages/server/src/socket-resolution.ts:127-136` (the `resolveRoutePath` option doc) and `:285-292` (the `routePath` derivation in `resolveConnection`)
- Test: `packages/server/src/__tests__/sockets-handler.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `SocketDef.__routeId` / `RoomDef.__routeId` (Task 1, typed via the rebuilt iso dist); `_defineRouteSocket` / `_defineRouteRoom` from `@hono-preact/iso/internal` (test fixtures).
- Produces: `resolveConnection` resolves `routePath` as declared-pattern-first. No signature changes; both the Node `createEvents` path and the CF connector branch inherit automatically (both call `resolveConnection`, `sockets-handler.ts:56` and `:159`).

- [ ] **Step 1: Write the failing tests**

In `packages/server/src/__tests__/sockets-handler.test.ts`, extend the internal import at line 10 to:

```ts
import {
  _defineRouteSocket,
  _defineRouteRoom,
  type RoomDef,
} from '@hono-preact/iso/internal';
```

Append this describe block (it reuses the file's `makeFakeUpgrader`, `makeApp`, `getRequest`, and `app` helpers, and mirrors the deny idiom of the "route-node use inheritance" block at :502):

```ts
describe('socketsHandler: declared route binding (serverRoute(r).socket/.room)', () => {
  const denyMiddleware = defineServerMiddleware(async (_ctx) => {
    const { deny } = await import('@hono-preact/iso');
    throw deny('forbidden', 403);
  });

  it('a registry-module socket bound to a guarded route runs that route gates (attacker model)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = _defineRouteSocket<never, never>('/admin', {
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    // Registry module: not in the route tree, so the mount derivation yields
    // undefined. Before this fix the connection resolved SOCKETS_RPC_PATH and
    // ran NO page gates; the declared '/admin' binding must select them.
    const resolvePageUse = (path: string) =>
      path === '/admin' ? [denyMiddleware] : [];

    const registry = new Map([['src/server/rt::feed', def]]);
    app = makeApp(registry, undefined, resolvePageUse, () => undefined);
    await getRequest('src/server/rt', 'feed');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('a registry-module room bound to a guarded route runs that route gates (attacker model)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const onJoinSpy = vi.fn();
    const channel = defineChannel('board/:boardId')<{ n: number }>();
    const def = _defineRouteRoom('/admin', channel, {
      onJoin: onJoinSpy,
    }) as unknown as RoomDef<unknown, unknown, unknown, unknown, unknown>;

    const resolvePageUse = (path: string) =>
      path === '/admin' ? [denyMiddleware] : [];

    const localApp = new Hono();
    localApp.get(
      SOCKETS_RPC_PATH,
      socketsHandler({
        registry: new Map(),
        rooms: new Map([['src/server/rt::board', def]]),
        resolvePageUse,
        resolveRoutePath: () => undefined,
      })
    );
    await localApp.request(
      `http://localhost${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent('src/server/rt')}&${SOCKET_NAME_PARAM}=board`
    );

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(ws.closes).toHaveLength(1);
    expect(ws.closes[0]!.code).toBe(WS_DENY_CODE);
    expect(onJoinSpy).not.toHaveBeenCalled();
  });

  it('the declared pattern wins over the mount derivation (subtree spelling)', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const openSpy = vi.fn();
    const def = _defineRouteSocket<never, never>('/admin/*', {
      open: openSpy,
    }) as unknown as SocketDef<never, never, undefined>;

    const resolved: string[] = [];
    const resolvePageUse = (path: string) => {
      resolved.push(path);
      return [];
    };

    // The mount derivation says '/admin' (the exact page scope); the declared
    // subtree spelling must win. This is the one route-attached case where the
    // two chains observably differ (the boot guard forces exact declarations
    // to equal the mount).
    const registry = new Map([['pages/admin::feed', def]]);
    app = makeApp(registry, undefined, resolvePageUse, () => '/admin');
    await getRequest('pages/admin', 'feed');

    const events = lastEvents();
    const ws = lastWs();
    await events.onOpen?.(new Event('open'), ws as never);

    expect(resolved).toEqual(['/admin/*']);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(ws.closes).toHaveLength(0);
  });

  it('bare defs keep the mount derivation and the SOCKETS_RPC_PATH fallback', async () => {
    const { upgrader, lastEvents, lastWs } = makeFakeUpgrader();
    installWebSocketUpgrader(upgrader);

    const def = defineSocket<never, never>({}) as unknown as SocketDef<
      never,
      never,
      undefined
    >;
    const resolved: string[] = [];
    const resolvePageUse = (path: string) => {
      resolved.push(path);
      return [];
    };

    // Mounted module: bare defs still resolve via the mount.
    app = makeApp(
      new Map([['pages/chat::feed', def]]),
      undefined,
      resolvePageUse,
      (mk) => (mk === 'pages/chat' ? '/chat' : undefined)
    );
    await getRequest('pages/chat', 'feed');
    await lastEvents().onOpen?.(new Event('open'), lastWs() as never);
    expect(resolved).toEqual(['/chat']);

    // Route-less registry module: terminal fallback unchanged.
    resolved.length = 0;
    app = makeApp(
      new Map([['src/server/rt::feed', def]]),
      undefined,
      resolvePageUse,
      () => undefined
    );
    await getRequest('src/server/rt', 'feed');
    await lastEvents().onOpen?.(new Event('open'), lastWs() as never);
    expect(resolved).toEqual([SOCKETS_RPC_PATH]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run packages/server/src/__tests__/sockets-handler.test.ts`
Expected: the two attacker-model tests FAIL (`ws.closes` has length 0: the guard never ran because resolution fell back to `SOCKETS_RPC_PATH`), and the subtree-precedence test FAILS (`resolved` equals `['/admin']`, the mount derivation). The bare-def test and all pre-existing tests pass.

- [ ] **Step 3: Implement the precedence**

In `packages/server/src/socket-resolution.ts`, replace the derivation at :285-292:

```ts
  // The def's declared pattern (serverRoute(r).socket/.room stamps __routeId)
  // wins when present: the boot binding guard validates it against the module
  // mount (or the route table for src/server registry modules) before the
  // entry serves, so the byPattern lookup cannot fail open for a bound def.
  // The module-mount derivation is the fallback for bare defs; a bare def
  // whose moduleKey is not in the route tree falls back to SOCKETS_RPC_PATH,
  // which matches no route pattern, so resolvePageUse returns [] and the def
  // gets app-use + def-use only.
  const routePath =
    def.__routeId ??
    (moduleKey && opts.resolveRoutePath
      ? (opts.resolveRoutePath(moduleKey) ?? SOCKETS_RPC_PATH)
      : SOCKETS_RPC_PATH);
```

Update the `resolveRoutePath` option doc (`:127-136`) first sentence to: "Resolve a socket's moduleKey to its owning route path so that `resolvePageUse` receives the correct path **when the def carries no declared `__routeId`** (bare `defineSocket`/`defineRoom`); a stamped declared pattern takes precedence."

Also append one sentence to `resolveGuardDenied`'s `pathParams` doc (`socket-resolution.ts:155-161`): "A declared route binding does not change this: binding selects the use chain, never the param wire, so a guard on a param-bearing bound pattern still sees `{}` for plain sockets."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run packages/server/src/__tests__/sockets-handler.test.ts packages/server/src/__tests__/sockets-integration.test.ts packages/server/src/__tests__/rooms-handler.test.ts`
Expected: PASS (new and pre-existing; the integration and rooms suites prove no regression for mount-derived and bare defs).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/socket-resolution.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "feat(server): declared route pattern takes precedence in socket/room guard resolution (#273 item 1)"
```

---

### Task 4: Gate the /__sockets endpoint on the boot binding check

**Files:**
- Modify: `packages/server/src/create-server-entry.ts:231-254` (the `SOCKETS_RPC_PATH` handler)
- Test: `packages/server/src/__tests__/create-server-entry.test.ts` (append one test; add `SOCKETS_RPC_PATH` and `_defineRouteSocket` imports)

**Interfaces:**
- Consumes: `routeBindingCheck()` (existing closure in `createServerEntry`), the Task 2 guard messages, `_defineRouteSocket` (Task 1).
- Produces: `/__sockets` returns 500 (JSON `{ error }`) before any upgrade when the binding check fails, matching the loaders RPC and action POST gates.

- [ ] **Step 1: Write the failing test**

In `packages/server/src/__tests__/create-server-entry.test.ts`, extend the imports: add `SOCKETS_RPC_PATH` to a new import from `@hono-preact/iso/internal/runtime`, and add `_defineRouteSocket` to the existing `@hono-preact/iso/internal` import at line 9:

```ts
import { _defineRouteLoader, _defineRouteSocket } from '@hono-preact/iso/internal';
import { SOCKETS_RPC_PATH } from '@hono-preact/iso/internal/runtime';
```

Append inside the `describe('createServerEntry', ...)` block:

```ts
  it('fails the socket upgrade closed (500) when a registry socket is misbound', async () => {
    // A src/server registry socket bound to a pattern that is not in the route
    // table. Before this gate, /__sockets never ran the binding check, so the
    // misbinding surfaced (at best) as a silently gateless connection.
    const app = createServerEntry({
      routes: manifest({
        serverImports: [],
        routeUse: [{ path: '/x', use: [] }],
      }),
      layout: Layout,
      serverRegistry: [
        async () => ({
          __moduleKey: 'src/server/rt',
          serverSockets: { feed: _defineRouteSocket('/nope', {}) },
        }),
      ],
      dev: true,
    });

    const res = await app.request(
      `${SOCKETS_RPC_PATH}?m=${encodeURIComponent('src/server/rt')}&s=feed`
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/socket 'feed'/);
    expect(body.error).toMatch(/'\/nope'/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/create-server-entry.test.ts`
Expected: FAIL. The handler proceeds past the (unrun) binding check; the request dies later (missing WebSocket upgrader) with a different error, so the `expect(res.status).toBe(500)` may hold but the message assertions on `/socket 'feed'/` FAIL.

- [ ] **Step 3: Implement the gate**

In `packages/server/src/create-server-entry.ts`, at the top of the `SOCKETS_RPC_PATH` handler body (immediately after `.get(SOCKETS_RPC_PATH, async (c, next) => {` at :231), insert:

```ts
      // Sockets are the third route-bound dispatch surface: a misbound
      // socket/room must fail the handshake closed (500, no upgrade) rather
      // than resolve a wrong or empty gate chain, mirroring the loaders RPC
      // and action POST gates above.
      try {
        await routeBindingCheck();
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : String(err) },
          500
        );
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/server/src/__tests__/create-server-entry.test.ts`
Expected: PASS (all pre-existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/create-server-entry.ts packages/server/src/__tests__/create-server-entry.test.ts
git commit -m "feat(server): gate /__sockets on the route-binding boot check (#273 item 1)"
```

---

### Task 5: Type-level assertions for the binder arms

**Files:**
- Modify: `packages/iso/src/__tests__/server-route.test-d.ts` (extend `_probes`)

**Interfaces:**
- Consumes: `SocketRef` (from `../define-socket.js`), `RoomRef` (from `../define-room.js`), the existing `route`/`boardChannel` fixtures in the file.
- Produces: compile-time pins that the arms infer message/param types and return the exact ref types.

- [ ] **Step 1: Add the type probes**

In `packages/iso/src/__tests__/server-route.test-d.ts`, add imports:

```ts
import type { SocketRef } from '../define-socket.js';
import type { RoomRef } from '../define-room.js';
```

Append inside `_probes()` (after the existing loader probes; `route` and `boardChannel` are already defined at :19-20):

```ts
  // .socket: Incoming/Outgoing infer through the arm; the ref carries them.
  const sock = route.socket<{ ping: true }, { pong: true }>({
    message(socket, msg) {
      expectTypeOf(msg).toEqualTypeOf<{ ping: true }>();
      expectTypeOf(socket.send).parameter(0).toEqualTypeOf<{ pong: true }>();
    },
  });
  expectTypeOf(sock).toEqualTypeOf<SocketRef<{ ping: true }, { pong: true }>>();

  // .room: ctx.params is typed from the CHANNEL pattern, not the route.
  const room = route.room(boardChannel, {
    onJoin(conn, ctx) {
      expectTypeOf(ctx.params).toEqualTypeOf<{ projectId: string }>();
      expectTypeOf(conn.broadcast).parameter(0).toEqualTypeOf<{ n: number }>();
    },
  });
  expectTypeOf(room).toEqualTypeOf<
    RoomRef<{ n: number }, { n: number }, void, { projectId: string }>
  >();
```

- [ ] **Step 2: Run the type suite to verify it passes**

Run: `pnpm test:types`
Expected: "Type Errors: no errors" across the suite, including the extended file. (If `toEqualTypeOf` on the ref types trips over the optional phantom members, switch those two assertions to `.toExtend<...>` plus a `.not.toBeAny()` guard; the repo's test-d gotcha memory documents this optional-member equality quirk.)

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/server-route.test-d.ts
git commit -m "test(iso): type-level pins for serverRoute(r).socket/.room arms (#273 item 1)"
```

---

### Task 6: Docs sync and release-note entry

**Files:**
- Possibly modify: `apps/site` realtime/typed-server docs pages (grep-driven, see Step 1)
- Modify AT PR TIME, in the PRIMARY checkout (untracked draft, exists only there): `/Users/stevenbeshensky/Documents/repos/hono-preact/docs/superpowers/specs/2026-07-11-v0.11-release-notes.md`

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1-4.
- Produces: docs that describe the real binding semantics; the v0.11 breaking-notes entry.

- [ ] **Step 1: Sweep the site docs for socket/room binding claims**

Run: `rg -n "\.socket\(|\.room\(|serverRoute" apps/site/src --type-add 'mdx:*.mdx' -t mdx -t ts -t tsx | rg -i "socket|room"`

For each hit that describes `serverRoute(r).socket`/`.room` semantics: the arms now really bind, so wording that says binding comes only from the module mount (or that the route argument is inert) must be updated to the new semantics: declared pattern stamped, boot-validated fail-closed, precedence over mount, plain-socket guards see empty `pathParams`. Per the repo docs style: describe what IS, no "previously/now" migration breadcrumbs. If a page already words it as binding (matching the old docstring promise), it is now accurate; leave it. If the sweep finds zero prose describing the arms, record that in the commit message and skip the docs edit.

- [ ] **Step 2: Run the docs-affecting checks**

Run: `pnpm --filter site build`
Expected: green (only needed if Step 1 edited site content; skip otherwise).

- [ ] **Step 3: Commit (only if Step 1 edited anything)**

```bash
git add apps/site
git commit -m "docs(site): serverRoute(r).socket/.room binding semantics (#273 item 1)"
```

- [ ] **Step 4: Queue the release-note entry (PR time, primary checkout)**

The v0.11 draft is an untracked file in the primary checkout only, owned by the release flow. When the PR opens, append this entry to its breaking-changes section at `/Users/stevenbeshensky/Documents/repos/hono-preact/docs/superpowers/specs/2026-07-11-v0.11-release-notes.md` (do NOT create the file in the worktree):

```markdown
- **`serverRoute(r).socket` / `.room` now really bind their route (fail-closed).**
  Previously the route argument was silently discarded: upgrade-guard resolution
  came only from the module mount, so a route-bound socket/room in a `src/server`
  registry module ran with NO page-tier gates, and a declared route that
  disagreed with the module mount was silently ignored. Now the declared pattern
  is stamped on the def, validated at boot exactly like route-bound
  loaders/actions (mismatched, childless-wildcard, and unknown-pattern bindings
  fail the boot), takes precedence in upgrade-guard resolution, and the
  `/__sockets` endpoint refuses to upgrade (500) until the binding check passes.
  Registry-module sockets/rooms bound to a route now run that route's gates:
  connections that previously succeeded may now be denied, which is the fix
  working. Not visible in an export-surface diff (no export changes), so this
  manual entry is load-bearing.
```

---

### Task 7: Full verification (CI parity) and wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Run the eight pre-push checks in CI order**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build \
  && pnpm gen:agents-corpus \
  && pnpm format:check \
  && pnpm typecheck \
  && pnpm test:types \
  && pnpm test:coverage \
  && pnpm test:integration \
  && pnpm --filter site build
```

Expected: all eight green. If `format:check` fails, run `pnpm format`, re-run the checks, and amend the offending commit or add a `style:` commit. If `test:coverage` flakes on the two known heavy tests (measure-client-size, agents-conformance) under parallel load, re-run serially before treating it as a regression (documented host-contention flake).

- [ ] **Step 2: Verify the checkbox trail**

Confirm every task in this plan is checked, every commit exists (`git log --oneline origin/main..HEAD` should show one commit per task plus the cherry-picked spec), and the working tree is clean (`git status`).

- [ ] **Step 3: Hand off for integration**

Do not push or open a PR without maintainer instruction. When instructed: push the branch, open the PR (body ends with the standard attribution), apply the Task 6 Step 4 release-note entry in the primary checkout, and run the mandatory deep PR review per `REVIEW.md` (the PostToolUse hook will remind after `gh pr create`). Close issue #273 item 1's checkbox in the PR body via `Closes` reference or a follow-up comment on #273.
