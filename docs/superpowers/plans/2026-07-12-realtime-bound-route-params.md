# Unified route-param model for bound realtime units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a route-bound socket's page-`use` guard authorize on real route params (via a typed `params` wire), and make a route-bound (or colocated) room's guard read route-pattern params under the right names (via a boot-time route↔channel congruence check plus a dev advisory), closing the two review findings on PR #274.

**Architecture:** Unify on one guard-param contract: the page-`use` guard for any route-bound unit reads `ctx.location.pathParams` keyed by the bound route pattern's param names. Bound sockets gain a typed `params` option (the topic-less twin of a room's channel key), validated at the upgrade and denied 4403 on a missing slot. Rooms get a boot check that the route pattern's required params are a subset of the channel's, plus a dev advisory naming each param correspondence. All connection-resolution changes land in the single shared `resolveConnection`, so Node and Cloudflare inherit them.

**Tech Stack:** TypeScript, Hono, Preact, vitest (unit + `--typecheck.only` type-level suites), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-07-12-realtime-bound-route-params-design.md` (this worktree, commit `00076c74`).

## Global Constraints

- **Stacked PR on top of #274.** This work continues the `serverRoute(r).socket/.room` binding feature. Create a new branch based on `worktree-273-socket-room-binding` (the #274 branch), NOT on `main`, and when the PR is opened set its **base branch to `worktree-273-socket-room-binding`**, not `main`. Do not merge or delete the #274 branch (it is this PR's base; deleting it would auto-close this PR).
- **Worktree.** Set up a fresh `git worktree` off the #274 branch via the `superpowers:using-git-worktrees` skill at execution time, then `pnpm wt:setup`. Every absolute path MUST carry that worktree's prefix; a main-checkout absolute path silently edits the wrong tree. All relative paths below are relative to the worktree root.
- **No Serena tools** in a worktree (Serena binds to the primary checkout; its edits land in the wrong tree). Use rg/Read/Edit.
- **Cross-package types flow through built dist:** after ANY `packages/iso` change, run `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build` before `pnpm typecheck` or any `packages/server` test/typecheck, or you will see fake "missing export" / stale-type errors. Every server-package task below includes this build step.
- **No em-dashes** in prose, comments, or commit messages (use commas, colons, parentheses).
- **Cast discipline:** no new `as` casts in production code beyond the pre-existing sanctioned wire-boundary casts these files already carry (`resolveRoomKey`'s JSON narrowing, the def-doubles-as-client-ref return sites). Test files may use the structural-read idioms the surrounding tests already use.
- **Commits:** one per task, message style `feat(iso):` / `feat(server):` / `docs:` etc. Never push or use `--force` without explicit maintainer instruction.
- Run all commands from the worktree root.

---

### Task 1: Rename the key wire constant `SOCKET_ROOM_PARAM` → `SOCKET_KEY_PARAM`

The `r=` query is about to carry a bound socket's route params as well as a room's channel key, so the constant's name should be generic. Mechanical, cross-package, and behavior-preserving (the `r` letter is unchanged).

**Files:**
- Modify: `packages/iso/src/internal/contract.ts:118`
- Modify: `packages/iso/src/use-room.ts` (import + use)
- Modify: `packages/server/src/socket-resolution.ts` (import + use)
- Modify: `packages/server/src/rooms-handler.ts` (doc `@param` reference)
- Any other reference surfaced by grep

**Interfaces:**
- Produces: `SOCKET_KEY_PARAM` (value `'r'`) exported from `@hono-preact/iso/internal/contract`, replacing `SOCKET_ROOM_PARAM`.

- [ ] **Step 1: Find every reference**

Run: `rg -n "SOCKET_ROOM_PARAM" packages/`
Expected: hits in `contract.ts`, `use-room.ts`, `socket-resolution.ts`, `rooms-handler.ts` (and possibly tests). Note each file.

- [ ] **Step 2: Rename the definition**

In `packages/iso/src/internal/contract.ts:118`, change:

```ts
export const SOCKET_ROOM_PARAM = 'r';
```

to:

```ts
/**
 * Query param carrying the JSON-encoded key params for a realtime upgrade: a
 * room's channel key params, or a route-bound socket's route params. Shared by
 * both (the server tells socket from room by registry lookup).
 */
export const SOCKET_KEY_PARAM = 'r';
```

- [ ] **Step 3: Update all consumers**

In each file from Step 1, replace `SOCKET_ROOM_PARAM` with `SOCKET_KEY_PARAM` (imports and uses). In `packages/iso/src/use-room.ts` this is the import (line ~7) and the `buildUrl` interpolation (line ~135). In `packages/server/src/socket-resolution.ts` the import and the `ctx.req.query(SOCKET_ROOM_PARAM)` call. In `packages/server/src/rooms-handler.ts` update the `@param` doc line that names it.

- [ ] **Step 4: Rebuild framework dist and verify no stale references**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && rg -n "SOCKET_ROOM_PARAM" packages/ ; echo "exit: $?"`
Expected: build succeeds; `rg` prints nothing and `echo` shows a non-zero rg exit (no matches).

- [ ] **Step 5: Typecheck + existing realtime suites still green**

Run: `pnpm typecheck && pnpm test rooms-handler sockets-handler`
Expected: PASS (pure rename, no behavior change).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/contract.ts packages/iso/src/use-room.ts packages/server/src/socket-resolution.ts packages/server/src/rooms-handler.ts
git commit -m "refactor(iso): rename SOCKET_ROOM_PARAM to SOCKET_KEY_PARAM (shared socket/room key wire)"
```

---

### Task 2: Shared `requiredParamSlots` helper (iso)

One source of truth for "which `:param` slots a pattern requires", consumed by the room-key resolver, the new socket param resolver, and the boot congruence check.

**Files:**
- Create: `packages/iso/src/internal/param-slots.ts`
- Modify: `packages/iso/src/internal-runtime.ts` (re-export from the `@hono-preact/iso/internal/runtime` barrel)
- Test: `packages/iso/src/__tests__/param-slots.test.ts` (new)

**Interfaces:**
- Produces: `requiredParamSlots(pattern: string): string[]` — the required param names (a `:name` segment with no `?`/`*`/`+` suffix), without the leading colon. Exported from `@hono-preact/iso/internal/runtime`.

- [ ] **Step 1: Write the failing test**

Create `packages/iso/src/__tests__/param-slots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { requiredParamSlots } from '../internal/param-slots.js';

describe('requiredParamSlots', () => {
  it('returns required :param names without the colon', () => {
    expect(requiredParamSlots('/board/:id')).toEqual(['id']);
    expect(requiredParamSlots('board/:boardId')).toEqual(['boardId']);
    expect(requiredParamSlots('/org/:orgId/board/:id')).toEqual(['orgId', 'id']);
  });

  it('excludes optional and rest segments', () => {
    expect(requiredParamSlots('/a/:x?')).toEqual([]);
    expect(requiredParamSlots('/a/:rest*')).toEqual([]);
    expect(requiredParamSlots('/a/:rest+')).toEqual([]);
  });

  it('returns [] for a param-less pattern', () => {
    expect(requiredParamSlots('/chat')).toEqual([]);
    expect(requiredParamSlots('/')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/iso/src/__tests__/param-slots.test.ts`
Expected: FAIL, `Cannot find module '../internal/param-slots.js'`.

- [ ] **Step 3: Implement the helper**

Create `packages/iso/src/internal/param-slots.ts`:

```ts
/**
 * The required `:param` slot names in a route or channel pattern: a `:name`
 * segment with no `?` (optional), `*` (rest-zero-or-more), or `+`
 * (rest-one-or-more) suffix, returned without the leading colon.
 *
 * Single-sourced so the room-key resolver (`resolveRoomKey`), the socket param
 * resolver (`resolveSocketParams`), and the boot route<->channel congruence
 * check all agree on what "required" means.
 */
export function requiredParamSlots(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((seg) => {
      if (!seg.startsWith(':')) return false;
      const flag = seg[seg.length - 1];
      return flag !== '?' && flag !== '*' && flag !== '+';
    })
    .map((seg) => seg.slice(1));
}
```

- [ ] **Step 4: Re-export from the runtime barrel**

In `packages/iso/src/internal-runtime.ts`, next to the `subtreePatternOf` export (around line 53), add:

```ts
// Required-param-slot extraction shared with @hono-preact/server's room-key
// resolver, socket param resolver, and boot congruence check.
export { requiredParamSlots } from './internal/param-slots.js';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/iso/src/__tests__/param-slots.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/param-slots.ts packages/iso/src/internal-runtime.ts packages/iso/src/__tests__/param-slots.test.ts
git commit -m "feat(iso): add requiredParamSlots helper for shared pattern slot extraction"
```

---

### Task 3: Thread route params into `SocketHandler` / `SocketRef` types (iso)

Add a `Params` type parameter so an explicitly route-bound socket carries `RouteParams<RouteId>`, and surface those params to the edge `data` factory. Bare `defineSocket` keeps `{}` via defaults (source-compatible).

**Files:**
- Modify: `packages/iso/src/define-socket.ts`
- Modify: `packages/iso/src/server-route.ts` (the `.socket` arm signature + docstring)
- Test: `packages/iso/src/__tests__/define-socket.test-d.ts` (add cases)
- Test: `packages/iso/src/__tests__/server-route-realtime.test.ts` (add a runtime case)

**Interfaces:**
- Consumes: `RouteParams<RouteId>` from `@hono-preact/iso` typed-routes; `Context` from hono.
- Produces:
  - `SocketHandler<Incoming, Outgoing, Data, Params = {}>` with `data?: (c: Context, params: Params) => Data | Promise<Data>`.
  - `SocketDef<Incoming, Outgoing, Data, Params = {}>`.
  - `SocketRef<Incoming, Outgoing, Params = {}>` with `readonly __params?: Params`.
  - `_defineRouteSocket<Incoming, Outgoing, Data = undefined, Params = {}>(routeId: string, handler: SocketHandler<Incoming, Outgoing, Data, Params>): SocketRef<Incoming, Outgoing, Params>`.
  - `serverRoute(r).socket<Incoming, Outgoing, Data>(handler: SocketHandler<Incoming, Outgoing, Data, RouteParams<RouteId>>): SocketRef<Incoming, Outgoing, RouteParams<RouteId>>`.

- [ ] **Step 1: Write the failing type-level test**

In `packages/iso/src/__tests__/define-socket.test-d.ts`, add:

```ts
import { expectTypeOf } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineSocket } from '../define-socket.js';
import type { Context } from 'hono';

// A param-bearing binding types the data factory's params from the route.
serverRoute('/board/:id').socket<{ ping: true }, { pong: true }>({
  data: (_c: Context, params) => {
    expectTypeOf(params).toEqualTypeOf<{ id: string }>();
    return { boardId: params.id };
  },
});

// A bare socket's factory params are {} (second arg present but empty).
defineSocket<{ ping: true }, { pong: true }>({
  data: (_c: Context, params) => {
    expectTypeOf(params).toEqualTypeOf<{}>();
    return undefined;
  },
});
```

- [ ] **Step 2: Run the type test to verify it fails**

Run: `pnpm test:types`
Expected: FAIL. `.socket`'s handler `data` currently takes only `(c: Context)`, so the two-arg factory is a type error.

- [ ] **Step 3: Add the `Params` generic in `define-socket.ts`**

In `packages/iso/src/define-socket.ts`, change the `SocketHandler` signature (line 25) and its `data` field (line 44):

```ts
export interface SocketHandler<Incoming, Outgoing, Data, Params = {}> {
```

```ts
  data?: (c: Context, params: Params) => Data | Promise<Data>;
```

Change `SocketDef` (line 71) to carry `Params`:

```ts
export interface SocketDef<Incoming, Outgoing, Data, Params = {}> extends SocketHandler<
  Incoming,
  Outgoing,
  Data,
  Params
> {
```

Change `SocketRef` (line 94) to carry `Params` and expose the phantom, and thread it through the `useSocket` method:

```ts
export interface SocketRef<Incoming, Outgoing, Params = {}> {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_SOCKET_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  /**
   * The declared route pattern's params when constructed via
   * `serverRoute(r).socket`, so `useSocket(ref, { params })` is typed and
   * required for a param-bearing binding. `{}` for a bare `defineSocket`.
   */
  readonly __params?: Params;
  /**
   * Idiomatic ref-method form of `useSocket`. Equivalent to
   * `useSocket(ref, opts)` but called directly on the ref:
   * `serverSockets.feed.useSocket({ onMessage })`.
   */
  useSocket(
    opts?: UseSocketOptions<SocketRef<Incoming, Outgoing, Params>>
  ): UseSocketResult<SocketRef<Incoming, Outgoing, Params>>;
}
```

- [ ] **Step 4: Thread `Params` through the constructors**

In `packages/iso/src/define-socket.ts`, update `makeSocketRef` (line 109) and `_defineRouteSocket` (line 154). `defineSocket` (line 141) stays as-is (its `Params` defaults to `{}`):

```ts
function makeSocketRef<Incoming, Outgoing, Data, Params>(
  handler: SocketHandler<Incoming, Outgoing, Data, Params>,
  routeId?: string
): SocketRef<Incoming, Outgoing, Params> {
  // (body unchanged: spread handler, conditionally stamp __routeId, attach
  //  .useSocket, return the def cast as the client ref.)
  const ref = {
    ...handler,
    ...(routeId !== undefined ? { __routeId: routeId } : {}),
  } as unknown as SocketRef<Incoming, Outgoing, Params>;
  ref.useSocket = (opts) => useSocket(ref, opts);
  return ref;
}
```

```ts
export function _defineRouteSocket<Incoming, Outgoing, Data = undefined, Params = {}>(
  routeId: string,
  handler: SocketHandler<Incoming, Outgoing, Data, Params>
): SocketRef<Incoming, Outgoing, Params> {
  return makeSocketRef(handler, routeId);
}
```

- [ ] **Step 5: Update the `serverRoute(r).socket` arm signature + docstring**

In `packages/iso/src/server-route.ts`, replace the `socket` arm's docstring and signature (the `socket<Incoming, Outgoing, Data = undefined>(handler: SocketHandler<...>): SocketRef<Incoming, Outgoing>` block) with:

```ts
  /**
   * Define a duplex WebSocket bound to this route. Consume with
   * `useSocket(serverSockets.x, { params })`. Binding selects the route's
   * page-level `use` (auth) chain for the upgrade guard probe AND, for a
   * param-bearing route, requires the client to supply the route params via a
   * typed `params` option. Those params are validated at the upgrade (a missing
   * slot denies 4403), read by the guard as `ctx.location.pathParams`, and
   * passed to the edge `data` factory as its second argument. The declared
   * pattern is stamped on the def and validated fail-closed at boot.
   */
  socket<Incoming, Outgoing, Data = undefined>(
    handler: SocketHandler<Incoming, Outgoing, Data, RouteParams<RouteId>>
  ): SocketRef<Incoming, Outgoing, RouteParams<RouteId>>;
```

And update the arm implementation in the `serverRoute` function body (the `socket:` property, currently `socket: (handler) => defineSocket(handler)` from the binding PR, now the route-stamping form) to:

```ts
    socket: (handler) => _defineRouteSocket(route, handler),
```

Add `_defineRouteSocket` to the imports from `./define-socket.js` at the top of `server-route.ts` (alongside the existing `SocketHandler` / `SocketRef` / `defineSocket` imports). Confirm `RouteParams` is already imported (it is, used by the `.loader` and `.room` arms).

- [ ] **Step 6: Add a runtime stamping assertion**

In `packages/iso/src/__tests__/server-route-realtime.test.ts`, add to the existing `.socket` describe block:

```ts
it('.socket still stamps __routeId (route binding unchanged by params wire)', () => {
  const ref = serverRoute('/board/:id').socket<{ ping: true }, { pong: true }>({});
  expect((ref as { __routeId?: string }).__routeId).toBe('/board/:id');
});
```

- [ ] **Step 7: Build, typecheck, run type + runtime tests**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm test:types && pnpm exec vitest run packages/iso/src/__tests__/server-route-realtime.test.ts`
Expected: PASS (both the type-level factory-params assertions and the runtime stamp).

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src/define-socket.ts packages/iso/src/server-route.ts packages/iso/src/__tests__/define-socket.test-d.ts packages/iso/src/__tests__/server-route-realtime.test.ts
git commit -m "feat(iso): thread route params type into bound SocketHandler/SocketRef and data factory"
```

---

### Task 4: `useSocket` typed `params` option + wire (iso)

Require `params` on `useSocket` iff the bound route has params, and JSON-encode them onto the `SOCKET_KEY_PARAM` wire. Mirror `use-room.ts`'s `RoomRefShape` / `KeyOption` structure to avoid the "excessively deep" constraint recursion through the ref method.

**Files:**
- Modify: `packages/iso/src/use-socket.ts`
- Test: `packages/iso/src/__tests__/define-socket.test-d.ts` (add `useSocket` option cases)
- Test: `packages/iso/src/__tests__/use-socket.test.tsx` (add a wire-encoding case)

**Interfaces:**
- Consumes: `SocketRef<Incoming, Outgoing, Params>` (Task 3); `SOCKET_KEY_PARAM` (Task 1).
- Produces:
  - `UseSocketOptions<R>` intersects `ParamsOption<ParamsOf<R>>` where `ParamsOption<P> = keyof P extends never ? { params?: P } : { params: P }`.
  - `useSocket<R extends AnySocketRefShape>(ref: R, opts?: UseSocketOptions<R>): UseSocketResult<R>`.

- [ ] **Step 1: Write the failing type-level test**

In `packages/iso/src/__tests__/define-socket.test-d.ts`, add:

```ts
import { useSocket } from '../use-socket.js';

declare const boundRef: import('../define-socket.js').SocketRef<
  { ping: true },
  { pong: true },
  { id: string }
>;
declare const bareRef: import('../define-socket.js').SocketRef<
  { ping: true },
  { pong: true }
>;

// Param-bearing binding: `params` is required and typed.
useSocket(boundRef, { params: { id: 'b1' } });
// @ts-expect-error missing required params
useSocket(boundRef, {});
// @ts-expect-error wrong param name
useSocket(boundRef, { params: { boardId: 'b1' } });

// Bare socket: no `params` option.
useSocket(bareRef, {});
// @ts-expect-error bare socket takes no params
useSocket(bareRef, { params: { id: 'b1' } });
```

- [ ] **Step 2: Run the type test to verify it fails**

Run: `pnpm test:types`
Expected: FAIL. `UseSocketOptions` has no `params`, so the required-params `@ts-expect-error` lines do not error (unused directive) and `{ params: ... }` is rejected as excess.

- [ ] **Step 3: Restructure `use-socket.ts` types onto a ref shape**

In `packages/iso/src/use-socket.ts`, replace the phantom extractors (the `Incoming<R>` / `Outgoing<R>` block near line 22) and the `UseSocketOptions` / `UseSocketResult` / `useSocket` constraints with a `SocketRefShape` mirror of `use-room.ts`. Add `SOCKET_KEY_PARAM` to the contract import at the top.

```ts
/**
 * Structural phantom shape `useSocket` reads types from. Carries ONLY the
 * phantom fields, not `SocketRef`'s `useSocket` method: constraining on the
 * full `SocketRef` (whose method references `UseSocketOptions<SocketRef<...>>`)
 * makes the constraint recurse through that method, which TS rejects as
 * excessively deep. Mirrors `RoomRefShape` in use-room.ts.
 */
type SocketRefShape<Incoming, Outgoing, Params> = {
  readonly [FORM_MODULE_FIELD]?: string;
  readonly [FORM_SOCKET_FIELD]?: string;
  readonly __incoming?: Incoming;
  readonly __outgoing?: Outgoing;
  readonly __params?: Params;
};
type AnySocketRefShape = SocketRefShape<unknown, unknown, unknown>;

type Incoming<R> =
  R extends SocketRefShape<infer I, unknown, unknown> ? I : never;
type Outgoing<R> =
  R extends SocketRefShape<unknown, infer O, unknown> ? O : never;
type ParamsOf<R> =
  R extends SocketRefShape<unknown, unknown, infer P> ? P : never;

// `params` mirrors the room's `KeyOption`: a param-less binding makes `params`
// absent, a `:param` binding makes it required and typed from the route.
type ParamsOption<P> = keyof P extends never ? { params?: P } : { params: P };
```

Then change the exported types and the function signature (the current `export type UseSocketOptions<R extends SocketRef<unknown, unknown>>`, `UseSocketResult<...>`, and `export function useSocket<R extends SocketRef<unknown, unknown>>`) to constrain on `AnySocketRefShape` and intersect `ParamsOption`:

```ts
export type UseSocketOptions<R extends AnySocketRefShape> = ParamsOption<
  ParamsOf<R>
> & {
  /** Called on every incoming message. Does NOT trigger a re-render. */
  onMessage?: (msg: Serialize<Outgoing<R>>) => void;
  onOpen?: () => void;
  onClose?: (e: CloseEvent) => void;
  shouldReconnect?: (e: CloseEvent) => boolean;
  reconnect?: ReconnectOptions;
  enabled?: boolean;
  lastMessage?: boolean;
};

export type UseSocketResult<R extends AnySocketRefShape> = {
  send: (msg: Incoming<R>) => void;
  status: SocketStatus;
  close: (code?: number, reason?: string) => void;
  closeInfo?: SocketCloseInfo;
  lastMessage?: Serialize<Outgoing<R>>;
};

export function useSocket<R extends AnySocketRefShape>(
  ref: R,
  opts?: UseSocketOptions<R>
): UseSocketResult<R> {
```

(Keep the existing option JSDoc comments on the fields you carry over; they are elided here for brevity but must remain in the file.)

- [ ] **Step 4: Encode `params` onto the wire**

In `useSocket`'s body, JSON-encode the params once per render (stable primitive for the dep array) and append them to the URL only when present. Replace the `deps` and `buildUrl` in the `useWsLifecycle` call:

```ts
  // JSON-encode route params (bound sockets) once per render so the dep array
  // stays a stable primitive. Read `opts?.params` DIRECTLY, with no cast: both
  // branches of `ParamsOption` declare a `params` property, so it is accessible
  // on the generic intersection. This mirrors use-room.ts, which reads
  // `opts?.key` off the identical `KeyOption` shape castless. A bare socket
  // types `params` as absent, so this is `undefined` there.
  const paramsJson = opts?.params ? JSON.stringify(opts.params) : undefined;

  const lifecycle = useWsLifecycle({
    enabled,
    ready: Boolean(moduleKey && socketName),
    deps: [moduleKey, socketName, paramsJson],
    buildUrl: () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const base = `${proto}//${location.host}${SOCKETS_RPC_PATH}?${SOCKET_MODULE_PARAM}=${encodeURIComponent(moduleKey!)}&${SOCKET_NAME_PARAM}=${encodeURIComponent(socketName!)}`;
      return paramsJson !== undefined
        ? `${base}&${SOCKET_KEY_PARAM}=${encodeURIComponent(paramsJson)}`
        : base;
    },
    // (onOpen/onClose/shouldReconnect/reconnect/onRawMessage unchanged)
```

(No cast is needed or permitted here: `ParamsOption` declares `params` in BOTH branches, exactly as `KeyOption` does in `use-room.ts`, so `opts?.params` type-checks on the generic intersection. If you find yourself reaching for `as`, mirror `use-room.ts`'s `opts?.key` read instead.)

- [ ] **Step 5: Add a wire-encoding runtime test**

In `packages/iso/src/__tests__/use-socket.test.tsx`, add a case following the file's existing render harness that asserts the opened URL carries `r=<encoded params>`. Use the same WebSocket mock / `renderHook` (or component render) pattern already in that file; the assertion is:

```ts
// After rendering useSocket(boundRef, { params: { id: 'b1' } }) with the file's
// existing harness, the mock WebSocket's constructed URL includes the key wire.
expect(lastWsUrl()).toContain(`&r=${encodeURIComponent(JSON.stringify({ id: 'b1' }))}`);
```

(Reuse the file's existing `lastWsUrl` / mock accessor; if the harness exposes the URL differently, assert against that accessor. Do not invent a new mock; extend the existing one.)

- [ ] **Step 6: Build, typecheck, run tests**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm test:types && pnpm exec vitest run packages/iso/src/__tests__/use-socket.test.tsx`
Expected: PASS (required/absent `params` typing and the wire-encoding assertion).

- [ ] **Step 7: Commit**

```bash
git add packages/iso/src/use-socket.ts packages/iso/src/__tests__/define-socket.test-d.ts packages/iso/src/__tests__/use-socket.test.tsx
git commit -m "feat(iso): typed params option on useSocket for route-bound sockets"
```

---

### Task 5: Socket param resolution + guard/factory wiring (server)

Resolve + validate a bound socket's route params at the upgrade, feed them to the guard and the `data` factory, and deny 4403 on a missing slot. Also refactor `resolveRoomKey` onto the shared `requiredParamSlots` (DRY).

**Files:**
- Modify: `packages/server/src/socket-resolution.ts` (new `resolveSocketParams`, `ResolvedConnection` socket variant, socket branch of `resolveConnection`)
- Modify: `packages/server/src/rooms-handler.ts` (refactor `resolveRoomKey`'s slot check onto `requiredParamSlots`)
- Modify: `packages/server/src/sockets-handler.ts` (thread `params` to the socket `data` factory on both the Node and CF paths)
- Test: `packages/server/src/__tests__/socket-resolution.test.ts` (new, for `resolveSocketParams`)
- Test: `packages/server/src/__tests__/sockets-handler.test.ts` (add a resolveConnection deny/params case)

**Interfaces:**
- Consumes: `requiredParamSlots` from `@hono-preact/iso/internal/runtime` (Task 2); `SOCKET_KEY_PARAM` (Task 1); `SocketDef.__routeId`.
- Produces:
  - `resolveSocketParams(routePattern: string, rawR: string | undefined): { ok: true; params: Record<string, string> } | { ok: false; missing: string[] }`.
  - `ResolvedConnection` socket variant gains `params: Record<string, string>`.

- [ ] **Step 1: Write the failing unit test for `resolveSocketParams`**

Create `packages/server/src/__tests__/socket-resolution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSocketParams } from '../socket-resolution.js';

describe('resolveSocketParams', () => {
  const enc = (o: unknown) => JSON.stringify(o);

  it('accepts a wire covering every required slot', () => {
    expect(resolveSocketParams('/board/:id', enc({ id: 'b1' }))).toEqual({
      ok: true,
      params: { id: 'b1' },
    });
  });

  it('requires nothing for a param-less pattern', () => {
    expect(resolveSocketParams('/chat', undefined)).toEqual({
      ok: true,
      params: {},
    });
  });

  it('reports the missing slot when the wire omits it', () => {
    expect(resolveSocketParams('/board/:id', undefined)).toEqual({
      ok: false,
      missing: ['id'],
    });
    expect(resolveSocketParams('/board/:id', enc({}))).toEqual({
      ok: false,
      missing: ['id'],
    });
  });

  it('rejects a non-string value (treats the slot as missing)', () => {
    expect(resolveSocketParams('/board/:id', enc({ id: 42 }))).toEqual({
      ok: false,
      missing: ['id'],
    });
  });

  it('rejects malformed JSON / non-object wire', () => {
    expect(resolveSocketParams('/board/:id', 'not-json')).toEqual({
      ok: false,
      missing: ['id'],
    });
    expect(resolveSocketParams('/board/:id', enc([1, 2]))).toEqual({
      ok: false,
      missing: ['id'],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/socket-resolution.test.ts`
Expected: FAIL, `resolveSocketParams` is not exported.

- [ ] **Step 3: Implement `resolveSocketParams`**

In `packages/server/src/socket-resolution.ts`, add the import and the function (near `resolveConnection`). Add to the existing import from `@hono-preact/iso/internal/runtime` (or add the import if none):

```ts
import { requiredParamSlots } from '@hono-preact/iso/internal/runtime';
```

```ts
export type SocketParamsResolution =
  | { ok: true; params: Record<string, string> }
  | { ok: false; missing: string[] };

/**
 * Parse + validate a route-bound socket's route params from the untrusted
 * `SOCKET_KEY_PARAM` wire. The topic-less twin of `resolveRoomKey`: a bound
 * socket carries route params for its page-use guard but has no channel/topic.
 * A param-less pattern requires nothing. On success returns the validated
 * string params; on failure returns the missing required slot names so the
 * caller can deny 4403 and name them in a dev warning.
 */
export function resolveSocketParams(
  routePattern: string,
  rawR: string | undefined
): SocketParamsResolution {
  let params: Record<string, string> = {};
  if (rawR !== undefined && rawR !== '') {
    let parsed: unknown = null;
    try {
      // Sanctioned untrusted-wire JSON.parse: the client sends route params as
      // a JSON object of string values. A malformed body leaves parsed = null,
      // which fails every required slot below.
      parsed = JSON.parse(rawR);
    } catch {
      parsed = null;
    }
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      // Keep only string-valued entries: a non-string value is a contract lie,
      // so drop it and let the slot read as missing below.
      params = Object.fromEntries(
        Object.entries(parsed).filter(
          (e): e is [string, string] => typeof e[1] === 'string'
        )
      );
    }
  }
  const missing = requiredParamSlots(routePattern).filter(
    (slot) => !params[slot]
  );
  return missing.length === 0 ? { ok: true, params } : { ok: false, missing };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm exec vitest run packages/server/src/__tests__/socket-resolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `params` to the socket `ResolvedConnection` variant and wire the socket branch**

In `packages/server/src/socket-resolution.ts`, add `params: Record<string, string>` to the `kind: 'socket'` variant of the `ResolvedConnection` union (the variant returned near line 343). Then replace the socket branch of `resolveConnection` (currently lines 332-343):

```ts
  // Plain socket. A bare (colocated / registry) socket has no param wire and
  // its guard gets `{}` (the /__sockets endpoint is query-string only). An
  // EXPLICITLY route-bound socket (serverRoute(r).socket, __routeId set) carries
  // its route params on the shared key wire, mirroring a room's channel key:
  // resolve + validate them here so the page-use guard reads them and the edge
  // `data` factory receives them. A missing required slot denies 4403.
  let socketParams: Record<string, string> = {};
  if (def.__routeId !== undefined) {
    const resolved = resolveSocketParams(
      def.__routeId,
      ctx.req.query(SOCKET_KEY_PARAM)
    );
    if (!resolved.ok) {
      if (opts.dev) {
        console.warn(
          `hono-preact: socket '${name ?? ''}' bound to '${def.__routeId}' was ` +
            `connected without required route param(s): ${resolved.missing.join(', ')}. ` +
            `Connect with useSocket(ref, { params: { ${resolved.missing.join(', ')} } }); ` +
            `the connection is denied (4403).`
        );
      }
      return {
        kind: 'socket',
        socketDef: def,
        moduleKey,
        name,
        denied: true,
        params: {},
      };
    }
    socketParams = resolved.params;
  }
  const denied = await resolveGuardDenied({
    def,
    ctx,
    appConfig,
    resolvePageUse: opts.resolvePageUse,
    routePath,
    moduleKey: moduleKey ?? '',
    name: name ?? '',
    pathParams: socketParams,
  });
  return {
    kind: 'socket',
    socketDef: def,
    moduleKey,
    name,
    denied,
    params: socketParams,
  };
```

- [ ] **Step 6: Thread `params` into the socket `data` factory (both paths)**

In `packages/server/src/sockets-handler.ts`:

- In `createEvents`'s socket branch, change the destructure (line 79) to include `params`:

```ts
      const { socketDef, denied, params } = resolved;
```

- Change the Node-path factory call (lines 91-95) to pass `params`:

```ts
      const data: unknown = denied
        ? undefined
        : socketDef.data
          ? await socketDef.data(ctx, params)
          : undefined;
```

- In the CF connector path, change the destructure (line 200) and factory call (line 201):

```ts
    const { socketDef, moduleKey, name, params } = resolved;
    const data = socketDef.data ? await socketDef.data(c, params) : undefined;
```

- [ ] **Step 7: Refactor `resolveRoomKey` onto `requiredParamSlots` (DRY)**

In `packages/server/src/rooms-handler.ts`, add the import and replace the inline `missingRequired` block (lines 148-157) with the shared helper:

```ts
import { requiredParamSlots } from '@hono-preact/iso/internal/runtime';
```

```ts
  // Validate that every required `:param` in the channel name has a non-empty
  // value. interpolatePattern drops a missing segment rather than leaving
  // `:name` in place, so we check the params object directly.
  const missingRequired = requiredParamSlots(channel.name).some(
    (slot) => !params[slot]
  );
```

- [ ] **Step 8: Add a resolveConnection deny/params case**

In `packages/server/src/__tests__/sockets-handler.test.ts`, add a case using the file's existing `resolveConnection` harness (a bound socket def with `__routeId: '/board/:id'` in the registry). Assert:
- With `r={"id":"b1"}` on the request: `resolved.kind === 'socket'`, `resolved.denied === false` (or the guard's own outcome), `resolved.params` equals `{ id: 'b1' }`.
- With no `r`: `resolved.denied === true` and `resolved.params` equals `{}`.

Use the same context/registry mock the surrounding tests already build; do not invent a new harness.

- [ ] **Step 9: Build, typecheck, run server suites**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck && pnpm exec vitest run packages/server/src/__tests__/socket-resolution.test.ts packages/server/src/__tests__/sockets-handler.test.ts packages/server/src/__tests__/rooms-handler.test.ts`
Expected: PASS (new socket param resolution + threading; room-key refactor is behavior-identical so rooms-handler stays green).

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/socket-resolution.ts packages/server/src/rooms-handler.ts packages/server/src/sockets-handler.ts packages/server/src/__tests__/socket-resolution.test.ts packages/server/src/__tests__/sockets-handler.test.ts
git commit -m "feat(server): resolve + validate route-bound socket params, feed guard and data factory"
```

---

### Task 6: Room route↔channel congruence boot check + dev advisory (server)

Fail boot when a room's owning route requires a param the channel does not supply, and emit a dev-only, once-per-binding advisory naming each param correspondence. Covers both explicitly bound rooms and colocated rooms (effective route = `__routeId` or the module mount).

**Files:**
- Modify: `packages/server/src/route-binding-guard.ts` (congruence helper, `RouteBindingCheckContext.onRoomParamBinding`, `warnRoomParamBinding`, calls in both assert functions)
- Modify: `packages/server/src/create-server-entry.ts` (wire `onRoomParamBinding` in dev, mirroring `onAliasedBinding`)
- Test: `packages/server/src/__tests__/route-binding-guard.test.ts` (add congruence + advisory cases)

**Interfaces:**
- Consumes: `requiredParamSlots` (Task 2). Reads a room export's `channel.name` structurally.
- Produces:
  - `RoomParamBindingInfo = { name: string; routeId: string; params: string[] }`.
  - `RouteBindingCheckContext.onRoomParamBinding?: (info: RoomParamBindingInfo) => void`.
  - `warnRoomParamBinding(warned: Set<string>, info: RoomParamBindingInfo): void`.
  - Both `assertRouteBindingsMatchMount` and `assertRegistryRouteBindingsValid` throw on a room whose effective route has a required param absent from its channel.

- [ ] **Step 1: Write the failing test**

In `packages/server/src/__tests__/route-binding-guard.test.ts`, add (following the file's existing module/route fixtures for `assertRegistryRouteBindingsValid`; build a registry room with `__routeId` and a `channel` whose `name` you control):

```ts
// A room whose route requires :id but whose channel keys on :boardId fails boot.
it('throws when a bound room route param is absent from the channel', async () => {
  const roomMod = async () => ({
    serverRooms: {
      cursors: { __routeId: '/board/:id', channel: { name: 'board/:boardId' } },
    },
  });
  await expect(
    assertRegistryRouteBindingsValid([roomMod], {
      routeUseByPattern: new Map([['/board/:id', []]]),
    })
  ).rejects.toThrow(/route param .*id.* is not a key of channel/i);
});

// Congruent names pass and fire the dev advisory once.
it('passes on route ⊆ channel and fires the param advisory', async () => {
  const roomMod = async () => ({
    serverRooms: {
      cursors: { __routeId: '/board/:id', channel: { name: 'board/:id' } },
    },
  });
  const seen: Array<{ name: string; routeId: string; params: string[] }> = [];
  await assertRegistryRouteBindingsValid([roomMod], {
    routeUseByPattern: new Map([['/board/:id', []]]),
    onRoomParamBinding: (info) => seen.push(info),
  });
  expect(seen).toEqual([
    { name: 'cursors', routeId: '/board/:id', params: ['id'] },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-binding-guard.test.ts -t "channel"`
Expected: FAIL (no congruence check yet; the first case does not throw, the advisory never fires).

- [ ] **Step 3: Add the congruence helper + advisory types**

In `packages/server/src/route-binding-guard.ts`, add the import and the shared pieces. Import:

```ts
import { subtreePatternOf, requiredParamSlots } from '@hono-preact/iso/internal/runtime';
```

Add the info type + context field (next to `AliasedBindingInfo` / `onAliasedBinding`):

```ts
export type RoomParamBindingInfo = {
  name: string;
  /** The room's effective owning route pattern (declared __routeId or mount). */
  routeId: string;
  /** The route params the channel satisfies, in pattern order. */
  params: string[];
};
```

Add to `RouteBindingCheckContext`:

```ts
  /**
   * Dev-only observer fired once per param-bearing room binding after
   * congruence holds: the room's route params are being satisfied by the
   * channel key of the same name. Purely diagnostic. Omit in prod.
   */
  onRoomParamBinding?: (info: RoomParamBindingInfo) => void;
```

Add the shared congruence check and the warning helper:

```ts
// Read a room export's channel name pattern structurally (a sanctioned read of
// a user module export). A non-room unit or a channel-less value yields null.
function channelNameOf(value: unknown): string | null {
  const name = (value as { channel?: { name?: unknown } }).channel?.name;
  return typeof name === 'string' ? name : null;
}

/**
 * Fail closed when a room's effective owning route requires a `:param` the
 * channel does not carry: the page-use guard would read that param as
 * undefined. Requires route params ⊆ channel params (the channel may be
 * finer-grained). On success, reports the param correspondence to the dev
 * advisory. No-op for a non-room unit or a param-less route.
 */
function assertRoomChannelCongruent(
  name: string,
  routeId: string,
  channelName: string,
  ctx: RouteBindingCheckContext
): void {
  const routeParams = requiredParamSlots(routeId);
  if (routeParams.length === 0) return;
  const channelParams = new Set(requiredParamSlots(channelName));
  const missing = routeParams.filter((p) => !channelParams.has(p));
  if (missing.length > 0) {
    throw new Error(
      `Route-bound room '${name}' binds route '${routeId}', but its route ` +
        `param(s) ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not ` +
        `a key of channel '${channelName}'. A room's page-use guard reads route ` +
        `params from the channel key, so every route param must be a channel ` +
        `param of the same name. Rename the channel or route param(s) to match, ` +
        `or bind the room to a route whose params the channel supplies.`
    );
  }
  ctx.onRoomParamBinding?.({ name, routeId, params: routeParams });
}

/**
 * Dev-only console advisory for a param-bearing room binding, fired through
 * `RouteBindingCheckContext.onRoomParamBinding`. One per binding for the life
 * of the `warned` set the caller owns.
 */
export function warnRoomParamBinding(
  warned: Set<string>,
  info: RoomParamBindingInfo
): void {
  const key = `${info.name}@${info.routeId}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `hono-preact: room '${info.name}' bound to '${info.routeId}': route ` +
      `param(s) ${info.params.join(', ')} are satisfied by the channel key of ` +
      `the same name. Confirm the route and channel denote the same resource; ` +
      `the room's guard authorizes on the channel key, not the page URL.`
  );
}
```

- [ ] **Step 4: Call congruence from both assert functions**

In `assertRouteBindingsMatchMount`, inside the per-route iteration where `CONTAINERS` are walked, after the existing mount-match checks for each export, add a room-congruence call using the **mount** as the effective route. The mount is the route node's `route.path` (for an explicitly bound room `__routeId === route.path` is already asserted, so `route.path` is correct for both bound and colocated rooms). Guard on `kind === 'room'`:

```ts
          if (kind === 'room') {
            const channelName = channelNameOf(value);
            if (channelName !== null) {
              assertRoomChannelCongruent(name, route.path, channelName, ctx);
            }
          }
```

In `assertRegistryRouteBindingsValid`, inside its `CONTAINERS` walk, after the existing `routeUseByPattern.has(routeId)` validity check, add the same call using the declared `__routeId` (registry rooms have no mount). Guard on `kind === 'room'` and a string `routeId`:

```ts
          if (kind === 'room' && typeof routeId === 'string') {
            const channelName = channelNameOf(value);
            if (channelName !== null) {
              assertRoomChannelCongruent(name, routeId, channelName, ctx);
            }
          }
```

(Place these so a colocated room, which has no `__routeId`, is still checked in `assertRouteBindingsMatchMount` via the mount; a bare registry room with no `__routeId` is route-independent and correctly skipped by the `typeof routeId === 'string'` guard.)

- [ ] **Step 5: Wire the dev advisory in the generated entry**

In `packages/server/src/create-server-entry.ts`, mirror the `onAliasedBinding` wiring (around lines 145-157). Add a second dedup set and the callback in the `dev` block:

```ts
  const warnedAliasedBindings = new Set<string>();
  const warnedRoomParamBindings = new Set<string>();
  const bindingCheckContext: RouteBindingCheckContext = {
    routeUseByPattern: new Map(routes.routeUse.map((r) => [r.path, r.use])),
    ...(dev
      ? {
          onAliasedBinding: (info: AliasedBindingInfo) =>
            warnAliasedLayoutBinding(warnedAliasedBindings, info),
          onRoomParamBinding: (info: RoomParamBindingInfo) =>
            warnRoomParamBinding(warnedRoomParamBindings, info),
        }
      : {}),
  };
```

Add `RoomParamBindingInfo` and `warnRoomParamBinding` to the existing import from `./route-binding-guard.js`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/server/src/__tests__/route-binding-guard.test.ts`
Expected: PASS (throw on mismatch; advisory fires once with the param list; existing binding-guard cases stay green).

- [ ] **Step 7: Build, typecheck, run the full realtime + binding server suites**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build && pnpm typecheck && pnpm exec vitest run packages/server/src/__tests__/route-binding-guard.test.ts packages/server/src/__tests__/sockets-integration.test.ts packages/server/src/__tests__/rooms-integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/route-binding-guard.ts packages/server/src/create-server-entry.ts packages/server/src/__tests__/route-binding-guard.test.ts
git commit -m "feat(server): boot congruence check + dev advisory for room route/channel params"
```

---

### Task 7: Docs (websockets + rooms)

Reverse the doc text the binding PR wrote about socket params, and document the room congruence rule.

**Files:**
- Modify: `apps/site/src/pages/docs/websockets.mdx`
- Modify: `apps/site/src/pages/docs/rooms.mdx`

**Interfaces:** none (prose + examples). No "replaces legacy / formerly" breadcrumbs (describe what is).

- [ ] **Step 1: Update `websockets.mdx`**

In the `serverRoute(r).socket` section, change the example so a param-bearing binding shows the typed `params` option and the two-arg `data` factory, e.g.:

```ts
// src/server/boards/board-chat.server.ts
const route = serverRoute('/board/:id');

export const serverSockets = {
  boardChat: route.socket<{ text: string }, { text: string }>({
    // Route params are validated at the upgrade and passed to the factory.
    data: (_c, { id }) => ({ boardId: id }),
    message(socket, msg) {
      socket.send({ text: msg.text });
    },
  }),
};
```

```tsx
// on the /board/:id page
const { id } = useParams();
const { send } = useSocket(serverSockets.boardChat, { params: { id } });
```

Replace the "a plain socket does not receive route path params" paragraph: an explicit `serverRoute(r).socket` binding on a param-bearing route DOES authorize on route params via a typed, required `params` option, surfaced to both the guard (`ctx.location.pathParams`) and the `data` factory; a missing param denies 4403. A **colocated** socket (a `.server.ts` sibling, no `serverRoute` binding) still has no param wire, so use explicit binding when a socket must authorize on a route param.

- [ ] **Step 2: Update `rooms.mdx`**

In the `serverRoute(r).room` section, add the congruence rule: the route pattern's required params must be a subset of the channel's params (the channel may be finer-grained), validated at boot, so a route param and its same-named channel key denote the same resource. Keep the example's matching param names, now stated as a requirement rather than a coincidence. Note the dev advisory that surfaces each param correspondence. State that congruence applies to a colocated room too (its effective route is the module mount).

- [ ] **Step 3: Build the site to catch MDX/type errors**

Run: `pnpm --filter site build`
Expected: PASS (MDX compiles, code samples typecheck under the site's setup).

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/websockets.mdx apps/site/src/pages/docs/rooms.mdx
git commit -m "docs: bound sockets authorize on typed params; room route/channel congruence"
```

---

### Task 8: Full CI-parity pass and open the stacked PR

**Files:** none (verification + PR).

- [ ] **Step 1: Regenerate the agents corpus (gitignored gate input)**

Run: `pnpm gen:agents-corpus`
Expected: succeeds; regenerates `templates/agents/llms-full.txt`.

- [ ] **Step 2: Run the eight CI-parity checks in CI order**

Run each and confirm PASS before proceeding:

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage
pnpm test:integration
pnpm --filter site build
```

If `format:check` fails, run `pnpm format`, then `git add -A && git commit -m "chore: format"`.
Expected: all eight PASS.

- [ ] **Step 3: Push the branch and open the PR with base = the #274 branch**

```bash
git push -u origin HEAD
gh pr create --base worktree-273-socket-room-binding \
  --title "feat(iso,server): unified route-param model for bound realtime units (#273 item 1 follow-on)" \
  --body "$(cat <<'EOF'
Stacked on #274. Closes the two review findings from the high-effort review of #274.

- Route-bound sockets authorize on typed route `params` (required iff the route has params), validated at the upgrade (4403 on a missing slot) and surfaced to the guard and the `data` factory.
- Route-bound and colocated rooms get a boot route↔channel param congruence check (route ⊆ channel) plus a dev-only advisory naming each param correspondence.
- Unifies the guard param contract across loaders, sockets, and rooms.

Spec: `docs/superpowers/specs/2026-07-12-realtime-bound-route-params-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `worktree-273-socket-room-binding` (NOT `main`). Do not merge or delete the base branch.

- [ ] **Step 4: Run the deep PR review**

Follow `REVIEW.md` (the `PostToolUse` hook also injects this reminder after `gh pr create`). Address findings before requesting merge.

---

## Self-Review

**Spec coverage:**
- Socket typed `params` wire (spec §1) → Tasks 3, 4.
- Socket server resolution + 4403 deny + factory exposure (spec §2) → Task 5.
- Room boot congruence + dev advisory + fail-closed doc (spec §3) → Task 6 (check + advisory), Task 7 (doc).
- Shared key wire rename + single resolution point (spec §4) → Task 1 (rename); Task 5 lands in `resolveConnection` (Node + CF via the shared function).
- Scope note 1 (socket params explicit-binding only) → Task 5 gates on `def.__routeId !== undefined`; colocated sockets keep `{}`.
- Scope note 2 (room congruence covers colocation) → Task 6 checks via mount in `assertRouteBindingsMatchMount`.
- Type surface: `SocketRef` `Params` slot, `RouteParams<RouteId>` threading (spec Type surface) → Task 3.
- Testing (spec Testing) → type-level in Tasks 3-4, runtime in Tasks 2, 5, 6.
- Docs reversal (spec Docs) → Task 7.
- `requiredParamSlots` single-sourcing / `resolveRoomKey` refactor (spec §2 slot extraction) → Tasks 2 and 5 step 7.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". Two tests (Task 4 step 5 wire assertion, Task 5 step 8 resolveConnection case) reference "the file's existing harness" rather than reproducing the whole mock; this is deliberate (extend the existing WebSocket/context mock, do not fork it) and names the exact assertion to add.

**Type consistency:** `requiredParamSlots` (Task 2) is consumed with the same signature in Tasks 5 and 6. `resolveSocketParams` return shape (`{ ok, params } | { ok, missing }`, Task 5) matches its test (Task 5 step 1) and its caller (Task 5 step 5). `SocketRef<Incoming, Outgoing, Params>` (Task 3) matches `SocketRefShape` extraction and `useSocket` constraint (Task 4). `onRoomParamBinding` / `RoomParamBindingInfo` / `warnRoomParamBinding` (Task 6) match between `route-binding-guard.ts` and the `create-server-entry.ts` wiring. `SOCKET_KEY_PARAM` (Task 1) is used in Tasks 4 and 5.
