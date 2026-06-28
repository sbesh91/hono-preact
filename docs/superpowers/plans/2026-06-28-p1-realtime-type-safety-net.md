# P1 Type-Safety Net (#180 + #181) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two P1 backlog items as one PR: add type-level tests guarding the middleware-chain and SSR stream-registry public types (#180), and turn three documented realtime cross-runtime traps into compile errors / a dev warning (#181).

**Architecture:** #180 adds two `*.test-d.ts` suites picked up by the existing `test:types` glob (`packages/**/src/**/__tests__/**/*.test-d.{ts,tsx}`). #181 makes three changes: (trap 1) rooms adopt the socket's `undefined`/`null`/value factory-less model across types + Node + CF; (trap 2) `socket.data` and `conn.data` become `Readonly<Data>`; (trap 3) the Node dev path warns when the data factory result exceeds the 6KB forward-header budget (CF still throws).

**Tech Stack:** TypeScript, Vitest (`--typecheck.only` for `*.test-d.ts`), pnpm workspaces, Hono, Preact, Cloudflare Durable Objects.

## Global Constraints

- No em-dashes in prose, comments, or commit messages (use comma/semicolon/colon/parens or two sentences).
- Run all eight pre-push CI steps before any push (see `CLAUDE.md` "Pre-push verification"). Build framework `dist/` first; `typecheck` and `apps/site` resolve cross-package types through `dist/`.
- `test:types` runs `vitest run --typecheck.only`; its glob is `packages/**/src/**/__tests__/**/*.test-d.{ts,tsx}`.
- This is a substantive change set: it lands on a dedicated branch in a `git worktree`, not on main's working tree. Run `pnpm wt:setup` after creating the worktree.
- The repo dislikes inline `as` casts; reshape types instead. Trap 2's Node-only mutable state uses a closure variable, never a cast that strips `Readonly`.
- Two breaking changes ship here (room factory-less default; `.data` read-only); both get release-note entries.

---

### Task 1: #180 — `compose-server-chain.test-d.ts`

Type-level guard for the middleware-chain public types: `ServerCtx<S>` scope narrowing and the `ComposedServerChain<S>` result shape. A loosening regression (e.g. `ServerCtx<'loader'>` widening to the full union, or `serverMw` dropping its `<S>` parameter) must fail `test:types`.

**Files:**
- Create: `packages/server/src/__tests__/compose-server-chain.test-d.ts`

**Interfaces:**
- Consumes: `ComposedServerChain<S>` from `../compose-server-chain.js` (fields: `serverMw: ReadonlyArray<ServerMiddleware<S>>`, `observers`, `resolvedTimeoutMs: number | false`, `timeoutSignal: AbortSignal | undefined`, `signal: AbortSignal`). `ServerCtx`, `ServerLoaderCtx`, `ServerActionCtx`, `ServerPageCtx`, `ServerMiddleware`, `Scope` from `@hono-preact/iso`.
- Produces: nothing (test-only).

- [ ] **Step 1: Write the type test**

Create `packages/server/src/__tests__/compose-server-chain.test-d.ts`:

```ts
// Type-level contract for the server middleware chain. Run under `pnpm test:types`.
// Guards two boundary types that otherwise rest on runtime tests alone (#180):
// ServerCtx<S> scope narrowing and the ComposedServerChain<S> result shape.
import { expectTypeOf } from 'vitest';
import type { ComposedServerChain } from '../compose-server-chain.js';
import type {
  ServerCtx,
  ServerPageCtx,
  ServerLoaderCtx,
  ServerActionCtx,
  ServerMiddleware,
} from '@hono-preact/iso';

// ServerCtx<S> narrows to exactly one ctx per scope.
function _ctxNarrowingProbe() {
  expectTypeOf<ServerCtx<'page'>>().toEqualTypeOf<ServerPageCtx>();
  expectTypeOf<ServerCtx<'loader'>>().toEqualTypeOf<ServerLoaderCtx>();
  expectTypeOf<ServerCtx<'action'>>().toEqualTypeOf<ServerActionCtx>();
  // The default (unparameterized) ctx is the full union, not a single arm.
  expectTypeOf<ServerCtx>().toEqualTypeOf<
    ServerPageCtx | ServerLoaderCtx | ServerActionCtx
  >();
  // A loader ctx carries module/loader; it must NOT collapse to the action arm.
  expectTypeOf<ServerCtx<'loader'>>().not.toEqualTypeOf<ServerActionCtx>();
}

// ComposedServerChain<S> threads the scope into serverMw and keeps the
// result-shape contract the loader/action handlers depend on.
function _chainShapeProbe() {
  type LoaderChain = ComposedServerChain<'loader'>;
  expectTypeOf<LoaderChain['serverMw']>().toEqualTypeOf<
    ReadonlyArray<ServerMiddleware<'loader'>>
  >();
  expectTypeOf<LoaderChain['resolvedTimeoutMs']>().toEqualTypeOf<
    number | false
  >();
  expectTypeOf<LoaderChain['timeoutSignal']>().toEqualTypeOf<
    AbortSignal | undefined
  >();
  expectTypeOf<LoaderChain['signal']>().toEqualTypeOf<AbortSignal>();

  // A middleware fn for the loader chain receives a ServerLoaderCtx, not the
  // wider union: the scope must flow through.
  const mw = {} as ServerMiddleware<'loader'>;
  expectTypeOf(mw.fn).parameter(0).toEqualTypeOf<ServerLoaderCtx>();
}

void _ctxNarrowingProbe;
void _chainShapeProbe;
```

- [ ] **Step 2: Run the suite and verify it passes**

Run: `pnpm test:types`
Expected: PASS (the file is picked up by the glob; no type errors).

- [ ] **Step 3: Prove it catches a loosening regression**

Temporarily edit `packages/iso/src/define-middleware.ts` and widen `ServerCtx`'s `'loader'` arm to the full union (change `? ServerLoaderCtx` on line ~33 to `? ServerPageCtx | ServerLoaderCtx | ServerActionCtx`).

Run: `pnpm test:types`
Expected: FAIL in `compose-server-chain.test-d.ts` (the `ServerCtx<'loader'>` equality and the `mw.fn` parameter probes go red).

Then revert the edit:

Run: `git checkout packages/iso/src/define-middleware.ts && pnpm test:types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__tests__/compose-server-chain.test-d.ts
git commit -m "test(server): type-level guard for middleware-chain public types (#180)"
```

---

### Task 2: #180 — `stream-registry.test-d.ts`

Type-level guard for the SSR stream public types: the `StreamEvent` wire union (producer/consumer contract) and `ViewState` (the render-arg union `ViewRenderer` hands every loader render function). The spec called the second type `ViewRenderArgs`; its real name in the code is `ViewState` (`view-renderer.tsx`).

**Files:**
- Create: `packages/iso/src/internal/__tests__/stream-registry.test-d.ts`

**Interfaces:**
- Consumes: `StreamEvent` from `../stream-registry.js`; `ViewState` from `../view-renderer.js`; `LoaderState`, `StreamState` from `../../loader-state.js`.
- Produces: nothing (test-only).

- [ ] **Step 1: Write the type test**

Create `packages/iso/src/internal/__tests__/stream-registry.test-d.ts`:

```ts
// Type-level contract for the SSR streaming public types. Run under
// `pnpm test:types`. Guards the StreamEvent wire union and the ViewState render
// arg, which otherwise rest on runtime tests alone (#180).
import { expectTypeOf } from 'vitest';
import type { StreamEvent } from '../stream-registry.js';
import type { ViewState } from '../view-renderer.js';
import type { LoaderState, StreamState } from '../../loader-state.js';

// The StreamEvent union is the producer/consumer wire contract: three variants,
// each carrying a loaderId, discriminated by `type`. A dropped/renamed field or
// a collapsed variant must fail here.
function _streamEventProbe() {
  expectTypeOf<StreamEvent>().toEqualTypeOf<
    | { type: 'push'; loaderId: string; value: unknown }
    | { type: 'end'; loaderId: string }
    | {
        type: 'error';
        loaderId: string;
        error: { message: string; name: string };
      }
  >();

  // The discriminant narrows each variant to its payload.
  const ev = {} as StreamEvent;
  if (ev.type === 'push') expectTypeOf(ev.value).toEqualTypeOf<unknown>();
  if (ev.type === 'error')
    expectTypeOf(ev.error).toEqualTypeOf<{ message: string; name: string }>();
}

// ViewState is the discriminated value handed to every loader render function:
// a LoaderState or StreamState (data erased to unknown at this internal seam)
// plus the consumer's spread props index signature.
function _viewStateProbe() {
  expectTypeOf<ViewState>().toMatchTypeOf<
    LoaderState<unknown> | StreamState<unknown>
  >();
  // The index signature carries arbitrary spread props.
  const state = {} as ViewState;
  expectTypeOf(state['anyProp']).toEqualTypeOf<unknown>();
  // The discriminant survives the intersection (status is still readable).
  expectTypeOf(state.status).not.toBeNever();
}

void _streamEventProbe;
void _viewStateProbe;
```

- [ ] **Step 2: Run the suite and verify it passes**

Run: `pnpm test:types`
Expected: PASS.

If the `state.status` probe fails to resolve because `LoaderState`/`StreamState` use a different discriminant field, open `packages/iso/src/loader-state.js` source (`loader-state.ts`), confirm the discriminant name, and adjust the `state.status` line to the real field. Do not guess: read the type first.

- [ ] **Step 3: Prove it catches a loosening regression**

Temporarily edit `packages/iso/src/internal/stream-registry.ts` and rename the `value` field of the `push` variant (line ~10) to `payload`.

Run: `pnpm test:types`
Expected: FAIL in `stream-registry.test-d.ts` (the union equality and the `ev.value` narrowing probes go red).

Then revert:

Run: `git checkout packages/iso/src/internal/stream-registry.ts && pnpm test:types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/internal/__tests__/stream-registry.test-d.ts
git commit -m "test(iso): type-level guard for SSR stream-registry public types (#180)"
```

---

### Task 3: #181 trap 2 — `Readonly<Data>` on `socket.data` and `conn.data`

Make the per-connection `.data` surface read-only on both the socket and room handles, so a CF-breaking in-place mutation becomes a compile error. Pure type change (the runtime handle already returns `unknown`). Node-only mutable state moves to a closure (documented in the JSDoc), not a cast.

**Files:**
- Modify: `packages/iso/src/define-socket.ts:11-21` (`ServerSocket.data`)
- Modify: `packages/iso/src/define-room.ts:20-43` (`RoomConnection.data`)
- Modify (tests): `packages/iso/src/__tests__/define-socket.test-d.ts:18,45`
- Modify (tests): `packages/iso/src/__tests__/define-room.test-d.ts:175,181`

**Interfaces:**
- Consumes: existing `ServerSocket<Outgoing, Data>`, `RoomConnection<Outgoing, State, Data>`.
- Produces: `ServerSocket.data: Readonly<Data>`, `RoomConnection.data: Readonly<Data>` (shallow).

- [ ] **Step 1: Update the type tests to expect `Readonly` (failing first)**

In `packages/iso/src/__tests__/define-socket.test-d.ts`, change both `socket.data` assertions:

Line 18: `expectTypeOf(socket.data).toEqualTypeOf<{ joinedAt: number }>();`
becomes: `expectTypeOf(socket.data).toEqualTypeOf<Readonly<{ joinedAt: number }>>();`

Line 45: same change (the `_routeSocketProbe` body).

In `packages/iso/src/__tests__/define-room.test-d.ts`, change both `conn.data` assertions (lines 175 and 181):

`expectTypeOf(conn.data).toEqualTypeOf<UserData>();`
becomes: `expectTypeOf(conn.data).toEqualTypeOf<Readonly<UserData>>();`

- [ ] **Step 2: Run `test:types` to verify the probes now fail**

Run: `pnpm test:types`
Expected: FAIL (`socket.data` / `conn.data` are still `Data`, not `Readonly<Data>`).

- [ ] **Step 3: Make `.data` read-only on both surfaces**

In `packages/iso/src/define-socket.ts`, change `ServerSocket.data` (line 18) and its JSDoc (lines 14-17):

```ts
  /** Per-connection data seeded by the `data` factory at connect time, read-only
   * for cross-runtime portability. On Cloudflare the DO is hibernatable, so each
   * event re-reads the connect-time value and an in-place mutation does not
   * persist. For Node-only mutable per-connection state, capture a closure
   * variable in `open()` instead of writing to `data`. */
  data: Readonly<Data>;
```

In `packages/iso/src/define-room.ts`, change `RoomConnection.data` (line 40) and its JSDoc (lines 33-39):

```ts
  /**
   * Per-connection state, seeded once at the edge by the room's `data()`
   * factory, read-only for cross-runtime portability. An in-place mutation is
   * NOT guaranteed to persist across events (on Cloudflare each event reads a
   * freshly deserialized attachment). Use `setPresence` for state that evolves;
   * for Node-only mutable state, capture a closure variable in `onJoin()`.
   */
  data: Readonly<Data>;
```

- [ ] **Step 4: Run `test:types` to verify the probes pass**

Run: `pnpm test:types`
Expected: PASS.

- [ ] **Step 5: Run the realtime runtime suites (no runtime change expected)**

Run: `pnpm test --run packages/server/src/__tests__/sockets-handler.test.ts packages/server/src/__tests__/rooms-handler.test.ts`
Expected: PASS (this task is type-only; runtime untouched).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-socket.ts packages/iso/src/define-room.ts \
  packages/iso/src/__tests__/define-socket.test-d.ts \
  packages/iso/src/__tests__/define-room.test-d.ts
git commit -m "feat(realtime)!: make socket.data and conn.data Readonly for cross-runtime safety (#181)

BREAKING CHANGE: socket.data and conn.data are now Readonly<Data>. Node-only
mutable per-connection state moves to a closure in open()/onJoin()."
```

---

### Task 4: #181 trap 1 — unify factory-less default on `undefined`

Rooms adopt the socket's `undefined`/`null`/value model so a factory-less room yields `conn.data === undefined` (not `{}`) on Node, Cloudflare, and in the type. This is the trap-1 fix: a factory-less `conn.data.foo` read becomes a compile error instead of a silent runtime `undefined`.

**Files:**
- Modify: `packages/iso/src/define-room.ts:151-156` (the `Data` generic default)
- Modify: `packages/server/src/rooms-handler.ts:264` (Node room data seed)
- Modify: `packages/server/src/sockets-handler.ts:477` (CF forward-path room data)
- Modify: `packages/server/src/cf/realtime-do-glue.ts:146-171` (CF glue room branch)
- Modify: `packages/server/src/cf/realtime-do.ts:229-232` (DO room data resolution)
- Modify (tests): `packages/server/src/__tests__/rooms-handler.test.ts:825-844`
- Modify (tests): `packages/iso/src/__tests__/define-room.test-d.ts` (add a factory-less default probe)

**Interfaces:**
- Consumes: `RoomConnection.data` (now `Readonly<Data>` from Task 3).
- Produces: `defineRoom<Name, Payload, State = void, Data = undefined>` (default flips from `Record<string, unknown>`); factory-less `conn.data` is `undefined` at runtime on both Node and CF.

- [ ] **Step 1: Update the Node runtime test to expect `undefined` (failing first)**

In `packages/server/src/__tests__/rooms-handler.test.ts`, change the test at line 825:

- Rename the `it(...)` title to `'data factory result defaults to undefined when not provided'`.
- Change the inline comment (line 832) to `// No data factory: conn.data starts as undefined.`
- Change the assertion (line 843) from `expect(seenData).toEqual({});` to `expect(seenData).toBeUndefined();`

- [ ] **Step 2: Run the Node room test to verify it fails**

Run: `pnpm test --run packages/server/src/__tests__/rooms-handler.test.ts -t "defaults to undefined"`
Expected: FAIL (`seenData` is still `{}` because of the `?? {}` seed).

- [ ] **Step 3: Drop the `?? {}` seed on the Node room path**

In `packages/server/src/rooms-handler.ts`, replace the `initialData` seed (lines 264-267):

```ts
      // A factory-less room yields `undefined` (parity with sockets and with
      // Cloudflare, where an absent x-hp-data header resolves to undefined). An
      // intentional null/value factory result is honored verbatim. conn.data is
      // edge-seeded read-only metadata; use setPresence for evolving state.
      const initialData: unknown = await roomDef.data?.(ctx);
```

(Adjust the preceding comment block on lines 250-263 if it still says "seeds the per-connection bag ... `{}`"; the bag is now whatever the factory returned, or `undefined`.)

- [ ] **Step 4: Run the Node room test to verify it passes**

Run: `pnpm test --run packages/server/src/__tests__/rooms-handler.test.ts`
Expected: PASS (all room-handler tests, including the renamed default test).

- [ ] **Step 5: Drop the `?? {}` on the CF forward path**

In `packages/server/src/sockets-handler.ts`, change the forward-path room data (line 477) from:

```ts
      const data = (await roomDef.data?.(c)) ?? {};
```

to:

```ts
      const data = await roomDef.data?.(c);
```

- [ ] **Step 6: Mirror the socket `undefined`/`null`/value model in the CF glue room branch**

In `packages/server/src/cf/realtime-do-glue.ts`, replace the room-branch data serialization (lines 146-157) so the `x-hp-data` header is omitted when the factory did not run (matching the socket branch at lines 102-117):

```ts
    const paramsJson = JSON.stringify(params);
    // Only serialize when a data factory ran. An ABSENT x-hp-data lets the DO
    // resolve conn.data to `undefined` (parity with Node and with the socket
    // branch); an intentional `null` result rides as the string 'null'.
    const dataJson = data === undefined ? undefined : JSON.stringify(data);
    const overBudget =
      byteLength(paramsJson) > MAX_FORWARD_HEADER_BYTES ||
      (dataJson !== undefined &&
        byteLength(dataJson) > MAX_FORWARD_HEADER_BYTES);
    if (overBudget) {
      throw new Error(
        'hono-preact: room connection context (params/data) exceeds the ' +
          `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. Keep the room data ` +
          'factory result small (it rides a request header to the Durable Object).'
      );
    }
```

Then, in the same branch, make the `x-hp-data` stamp conditional (line 171). Replace:

```ts
    fwd.headers.set('x-hp-data', dataJson);
```

with:

```ts
    if (dataJson !== undefined) fwd.headers.set('x-hp-data', dataJson);
```

- [ ] **Step 7: Resolve an absent room `x-hp-data` to `undefined` in the DO**

In `packages/server/src/cf/realtime-do.ts`, replace the room data resolution (line 232) so an absent header yields `undefined` (mirroring the socket path at lines 189-193):

```ts
    // An ABSENT x-hp-data means no room data factory ran -> `undefined` (parity
    // with Node, where conn.data defaults to undefined). A present 'null' (an
    // intentional null factory result) still parses to null.
    const rawRoomData = request.headers.get('x-hp-data');
    const data = rawRoomData === null ? undefined : parseHeaderJson(rawRoomData);
```

- [ ] **Step 8: Flip the `Data` generic default on `defineRoom`**

In `packages/iso/src/define-room.ts`, change the generic default (line 155) from:

```ts
  Data = Record<string, unknown>,
```

to:

```ts
  Data = undefined,
```

- [ ] **Step 9: Add a factory-less default type probe**

In `packages/iso/src/__tests__/define-room.test-d.ts`, add a probe asserting a factory-less room types `conn.data` as `undefined` (mirroring the socket default). Append before the trailing `void` statements:

```ts
// A factory-less room defaults Data to `undefined` (parity with defineSocket),
// so reading conn.data is `undefined`, not an object. This is the trap-1 fix.
function _roomFactoryLessDefaultProbe() {
  const channel = defineChannel('room/:roomId');
  const ref = defineRoom(channel, {
    onJoin(conn) {
      expectTypeOf(conn.data).toEqualTypeOf<Readonly<undefined>>();
    },
  });
  void ref;
}
void _roomFactoryLessDefaultProbe;
```

If `defineChannel` is not already imported in this file, add it to the existing import from `'../define-channel.js'` (check the file head; `define-room.test-d.ts` already references channels). Read the file's imports first and match them.

- [ ] **Step 10: Run the CF realtime suites and type tests**

Run: `pnpm test --run packages/server/src/__tests__ -t "socket"` then `pnpm test --run packages/server/src/cf` (if a `cf/__tests__` exists; otherwise the glue/DO unit tests live under `packages/server/src/__tests__`). Then `pnpm test:types`.
Expected: PASS. If a CF glue or DO test asserts a factory-less room sends `x-hp-data` or resolves `{}`, update it to expect the header omitted / `undefined`, matching the new contract.

- [ ] **Step 11: Commit**

```bash
git add packages/iso/src/define-room.ts packages/server/src/rooms-handler.ts \
  packages/server/src/sockets-handler.ts packages/server/src/cf/realtime-do-glue.ts \
  packages/server/src/cf/realtime-do.ts \
  packages/server/src/__tests__/rooms-handler.test.ts \
  packages/iso/src/__tests__/define-room.test-d.ts
git commit -m "feat(realtime)!: factory-less room data defaults to undefined, unifying with sockets (#181)

BREAKING CHANGE: a room with no data factory now yields conn.data === undefined
(was {}) on Node, Cloudflare, and in the type. Factory-less conn.data.foo reads
are now compile errors."
```

---

### Task 5: #181 trap 3 — 6KB budget dev warning on the Node path

The 6KB forward-header budget throws only on Cloudflare today, so a Node-tested app can break on deploy. Add a dev-mode `console.warn` on the Node (no-connector) path for both sockets and rooms. First extract the budget constant + `byteLength` to a runtime-neutral module so the Node path does not import a `cf/` module.

**Files:**
- Create: `packages/server/src/realtime-budget.ts`
- Modify: `packages/server/src/cf/realtime-do-glue.ts:27-28,186-189` (move defs out, re-export)
- Modify: `packages/server/src/sockets-handler.ts:96-131` (`dev?` option), `:349,390-394` (socket warn)
- Modify: `packages/server/src/rooms-handler.ts:195+,264` (room warn; thread `dev`)
- Modify: `packages/server/src/create-server-entry.ts:143-149` (pass `dev`)
- Test: `packages/server/src/__tests__/realtime-budget-warn.test.ts`

**Interfaces:**
- Consumes: `SocketsHandlerOptions` (adds `dev?: boolean`); `createRoomWsEvents` opts (adds `dev`).
- Produces: `MAX_FORWARD_HEADER_BYTES: number`, `byteLength(s: string): number`, and `warnIfOverForwardBudget(data: unknown, dev: boolean, kind: 'socket' | 'room'): void` from `realtime-budget.ts`.

- [ ] **Step 1: Write the failing unit test for the warning helper**

Create `packages/server/src/__tests__/realtime-budget-warn.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  warnIfOverForwardBudget,
  MAX_FORWARD_HEADER_BYTES,
} from '../realtime-budget.js';

afterEach(() => vi.restoreAllMocks());

describe('warnIfOverForwardBudget', () => {
  it('warns in dev when the JSON-serialized data exceeds the budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = { blob: 'x'.repeat(MAX_FORWARD_HEADER_BYTES + 1) };
    warnIfOverForwardBudget(big, true, 'socket');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('forward limit');
  });

  it('does not warn when under budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfOverForwardBudget({ ok: true }, true, 'room');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when dev is false, even over budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = { blob: 'x'.repeat(MAX_FORWARD_HEADER_BYTES + 1) };
    warnIfOverForwardBudget(big, false, 'socket');
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when data is undefined (factory-less)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfOverForwardBudget(undefined, true, 'socket');
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test --run packages/server/src/__tests__/realtime-budget-warn.test.ts`
Expected: FAIL with a module-not-found / export-not-found error for `../realtime-budget.js`.

- [ ] **Step 3: Create the runtime-neutral budget module**

Create `packages/server/src/realtime-budget.ts`:

```ts
// Runtime-neutral forward-header budget helpers. Shared by the Cloudflare glue
// (which throws over budget at connect time) and the Node path (which only
// dev-warns, since the Node transport does not ride the data through a header).
// Kept out of `cf/` so the Node path imports no Cloudflare-typed module.

/** Connections whose forwarded context exceeds this byte budget are denied on CF. */
export const MAX_FORWARD_HEADER_BYTES = 6 * 1024;

/** UTF-8 byte length of a string (header size is measured in bytes, not chars). */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Dev-only warning for a data-factory result that would exceed the forward
 * budget on Cloudflare. On Node the result never rides a header, so it works
 * locally and would only fail on deploy; this surfaces it early. A no-op unless
 * `dev` is true and the serialized result is over budget. `undefined` (a
 * factory-less connection) is never over budget.
 */
export function warnIfOverForwardBudget(
  data: unknown,
  dev: boolean,
  kind: 'socket' | 'room'
): void {
  if (!dev || data === undefined) return;
  const json = JSON.stringify(data);
  if (json === undefined || byteLength(json) <= MAX_FORWARD_HEADER_BYTES) return;
  console.warn(
    `hono-preact: ${kind} connection data exceeds the ` +
      `${MAX_FORWARD_HEADER_BYTES}-byte forward limit. It works on Node but will ` +
      'throw at connect time on Cloudflare (the data rides a request header to ' +
      'the Durable Object). Keep the data factory result small.'
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test --run packages/server/src/__tests__/realtime-budget-warn.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Re-point the CF glue at the shared module**

In `packages/server/src/cf/realtime-do-glue.ts`, remove the local `MAX_FORWARD_HEADER_BYTES` definition (line 27-28) and the local `byteLength` definition (lines 186-189), and instead import + re-export them from the shared module so existing importers of `./realtime-do-glue.js` keep working. Near the top imports add:

```ts
import {
  MAX_FORWARD_HEADER_BYTES,
  byteLength,
} from '../realtime-budget.js';
```

And add to the re-export block (near line 22-25):

```ts
export { MAX_FORWARD_HEADER_BYTES, byteLength };
```

- [ ] **Step 6: Verify the CF glue/DO suites still pass after the extraction**

Run: `pnpm test --run packages/server/src/__tests__`
Expected: PASS (the constant/helper are unchanged, only relocated).

- [ ] **Step 7: Add `dev?` to `SocketsHandlerOptions` and thread it from the entry**

In `packages/server/src/sockets-handler.ts`, add to `SocketsHandlerOptions` (after `appConfig?` on line 104, replacing the "not read here" comment on line 105):

```ts
  /**
   * Dev mode. When true, the Node upgrade path warns (rather than silently
   * accepting) a data-factory result that would exceed the 6KB forward budget
   * on Cloudflare, surfacing a CF-only failure during local development. The
   * generated server entry passes `{ dev: import.meta.env.DEV }`.
   */
  dev?: boolean;
```

In `packages/server/src/create-server-entry.ts`, pass `dev` into the `socketsHandler({ ... })` call (lines 143-149):

```ts
      return socketsHandler({
        registry,
        rooms,
        appConfig,
        dev,
        resolvePageUse: pageUseResolver.byPath,
        resolveRoutePath: routePathResolver.byModuleKey,
      })(c, next);
```

- [ ] **Step 8: Warn on the Node socket path**

In `packages/server/src/sockets-handler.ts`, import the helper at the top:

```ts
import { warnIfOverForwardBudget } from './realtime-budget.js';
```

Then, in `socketsHandler`, destructure `dev` (it is on `opts`) and call the warning right after the socket `data` is computed (after line 394, the `const data: unknown = ...` block):

```ts
      warnIfOverForwardBudget(data, opts.dev ?? false, 'socket');
```

- [ ] **Step 9: Thread `dev` into the room path and warn there**

In `packages/server/src/sockets-handler.ts`, where `createRoomWsEvents` is called (line 375), pass `dev` through its options object:

```ts
        return createRoomWsEvents(def, { ctx, denied, roomKey, dev: opts.dev ?? false });
```

In `packages/server/src/rooms-handler.ts`, add `dev` to the `createRoomWsEvents` options type and destructure it (read the existing options shape at line 195 first and extend it), import the helper:

```ts
import { warnIfOverForwardBudget } from './realtime-budget.js';
```

and call the warning right after the room `initialData` seed (the line edited in Task 4 Step 3):

```ts
      warnIfOverForwardBudget(initialData, dev, 'room');
```

- [ ] **Step 10: Run the realtime suites and typecheck**

Run: `pnpm test --run packages/server/src/__tests__` then `pnpm -r exec tsc --noEmit`
Expected: PASS (the `dev` plumbing typechecks; existing tests unaffected since `dev` defaults to false).

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/realtime-budget.ts \
  packages/server/src/cf/realtime-do-glue.ts \
  packages/server/src/sockets-handler.ts \
  packages/server/src/rooms-handler.ts \
  packages/server/src/create-server-entry.ts \
  packages/server/src/__tests__/realtime-budget-warn.test.ts
git commit -m "feat(realtime): dev-warn on Node when socket/room data exceeds the 6KB forward budget (#181)"
```

---

### Task 6: Docs sync + release notes + full CI

Bring the realtime docs in line with the new contracts and record the two breaking changes, then run the full pre-push CI sequence.

**Files:**
- Modify: `apps/site/src/pages/docs/websockets.mdx` (socket.data read-only; closure for Node-only mutable state)
- Modify: `apps/site/src/pages/docs/rooms.mdx` (factory-less default `undefined`; conn.data read-only; setPresence for evolving state)
- Modify: `apps/site/src/pages/docs/realtime.mdx` (if it documents `.data` defaults/mutability)
- Create: `docs/superpowers/specs/2026-06-28-realtime-trap-enforcement-release-note.md`

**Interfaces:**
- Consumes: the contracts established in Tasks 3-5.
- Produces: docs + release note (no code).

- [ ] **Step 1: Update the realtime docs**

In `apps/site/src/pages/docs/websockets.mdx`, find the prose describing `socket.data` mutability. State that `socket.data` is read-only (seeded once by the factory); for Node-only mutable per-connection state, capture a closure variable inside `open()`. Do not add migration breadcrumbs ("formerly mutable"); describe the current contract (per the repo's docs style).

In `apps/site/src/pages/docs/rooms.mdx`, update two things: (1) a factory-less room's `conn.data` is `undefined` (not `{}`); (2) `conn.data` is read-only, and evolving state uses `setPresence`. For Node-only mutable state, use a closure in `onJoin()`.

In `apps/site/src/pages/docs/realtime.mdx`, update any shared `.data` default/mutability statement to match.

Read each page's existing wording first and edit in place; match the surrounding voice and any `<CodeTabs>` structure.

- [ ] **Step 2: Write the release note**

Create `docs/superpowers/specs/2026-06-28-realtime-trap-enforcement-release-note.md`:

```markdown
# Release note: realtime cross-runtime trap enforcement (#181)

Two breaking changes harden the realtime API against silent cross-runtime
divergence. Both turn a runtime footgun into a compile error.

## `socket.data` and `conn.data` are now read-only

The per-connection `.data` bag is typed `Readonly<Data>` on both sockets and
rooms. On Cloudflare the Durable Object is hibernatable, so each event re-reads
the connect-time value and an in-place mutation silently vanishes; the read-only
type makes that mutation a compile error instead.

**Migration:** for Node-only mutable per-connection state, capture a closure
variable in `open()` (sockets) or `onJoin()` (rooms) instead of writing to
`.data`. For state that must evolve and broadcast, use `setPresence` (rooms).

## A factory-less room's `conn.data` is now `undefined` (was `{}`)

A room defined without a `data` factory now yields `conn.data === undefined`,
matching `socket.data` and the Cloudflare resolution path. The `defineRoom`
`Data` generic defaults to `undefined`.

**Migration:** if you read `conn.data` in a factory-less room, either add a
`data` factory or guard the access. With the new default, `conn.data.foo` is a
compile error rather than a runtime `undefined`.

## Also: Node dev warning for the 6KB forward budget

Not breaking. The Node dev server now warns when a `data` factory result exceeds
the 6KB forward-header budget that throws at connect time on Cloudflare, so the
limit surfaces locally instead of only on deploy.
```

- [ ] **Step 3: Run the full pre-push CI sequence**

Run, in order (from `CLAUDE.md`):

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

Expected: all green. If `format:check` fails, run `pnpm format` and re-stage.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/websockets.mdx apps/site/src/pages/docs/rooms.mdx \
  apps/site/src/pages/docs/realtime.mdx \
  docs/superpowers/specs/2026-06-28-realtime-trap-enforcement-release-note.md
git commit -m "docs(realtime): document read-only .data, undefined room default, and 6KB dev warning (#181)"
```

---

## Self-review notes

- **Spec coverage:** #180 → Tasks 1-2 (both `test-d` suites + catch-proof). #181 trap 1 → Task 4. Trap 2 → Task 3. Trap 3 → Task 5. Cross-cutting type tests → Tasks 1-4. Runtime test updates → Task 4. Docs sync + release notes → Task 6. Worktree isolation → Global Constraints. All spec sections map to a task.
- **Type-name correction:** the spec's `ViewRenderArgs` is `ViewState` in code; Task 2 uses the real name.
- **Ordering rationale:** Task 3 (Readonly) precedes Task 4 so the factory-less probe added in Task 4 can assert `Readonly<undefined>` against the already-read-only surface.
- **Budget extraction note:** Task 5 moves `MAX_FORWARD_HEADER_BYTES` / `byteLength` to `realtime-budget.ts` and re-exports from the glue, so no existing importer of `./realtime-do-glue.js` breaks.
