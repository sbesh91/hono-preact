# P1 type-safety net: #180 + #181

Date: 2026-06-28
Issues: [#180](https://github.com/sbesh91/hono-preact/issues/180), [#181](https://github.com/sbesh91/hono-preact/issues/181)
Tracker: [#189](https://github.com/sbesh91/hono-preact/issues/189) (v0.8 quality-comparison rerun backlog)

## Goal

Close the two P1 "CI safety net" items from the rerun backlog as a single PR:

- **#180** adds type-level tests so a loosening regression in the middleware-chain
  or SSR stream-registry public types fails `test:types` (today those two
  subsystems rest on runtime tests alone).
- **#181** turns three documented realtime cross-runtime traps into compile errors
  or a dev warning instead of doc notes.

## Background / findings

Reading the anchors clarified the real shape of #181's three traps:

1. **Factory-less default divergence.** A socket with no `data` factory yields
   `socket.data === undefined` (`defineSocket<…, Data = undefined>`); a room with
   no `data` factory yields `conn.data === {}` (`defineRoom<…, Data =
   Record<string, unknown>>`). Each subsystem is internally type-honest (the
   generic default matches the runtime default); the trap is purely the
   *asymmetry between them*.
2. **Mutability divergence.** On Node, `.data` is a live mutable bag (same
   reference every event). On Cloudflare the DO is hibernatable, so each event
   re-deserializes the original factory value and in-place mutations silently
   vanish. This affects **both** `conn.data` (rooms) and `socket.data` (sockets):
   the socket docs already admit "on Cloudflare each event gets the original
   factory value."
3. **6KB forward-header budget.** The data factory result rides a request header
   to the DO, bounded at `MAX_FORWARD_HEADER_BYTES` (6KB). The check throws at
   connect time **only on Cloudflare** (in `cf/realtime-do-glue.ts`), so a
   Node-tested app can break on deploy with no local signal.

`test:types` coverage is `packages/**/src/**/__tests__/**/*.test-d.{ts,tsx}`
(root `vitest.config.ts`), so new `test-d` suites in either `packages/server` or
`packages/iso/src/internal` are picked up automatically.

## Part 1 — #180: type-level tests (no runtime change)

Two new `*.test-d.ts` suites:

- `packages/server/src/__tests__/compose-server-chain.test-d.ts` — asserts the
  middleware-chain ordering contract (`[app, page, unit]`) and `ServerCtx<S>`
  narrowing on `ComposedServerChain<S>`
  (`packages/server/src/compose-server-chain.ts`).
- `packages/iso/src/internal/__tests__/stream-registry.test-d.ts` — asserts the
  `StreamEvent` union shape and `ViewRenderArgs`
  (`packages/iso/src/internal/stream-registry.ts`,
  `packages/iso/src/internal/view-renderer.tsx`).

**Acceptance proof:** before finalizing, deliberately loosen each target type and
confirm the corresponding suite turns red under `test:types`, then revert.

## Part 2 — #181: realtime trap enforcement

### Trap 1 — factory-less default: unify on `undefined`

Rooms converge on the socket's existing, deliberate `undefined` / `null` / value
three-way model (the socket path becomes the reference; rooms adopt it).

- `defineRoom`'s `Data` generic default flips `Record<string, unknown>` →
  `undefined`.
- Runtime: drop the `?? {}` room seed on the Node path
  (`rooms-handler.ts:264`) and the CF forward path (`sockets-handler.ts:477`).
  The CF glue room branch adopts the socket branch's model: serialize only when
  the factory ran (`data === undefined ? undefined : JSON.stringify(data)`), omit
  the header when absent, and the DO resolves an absent header to `undefined`
  (not `{}`).

This is a **breaking change**: factory-less room code reading `conn.data.foo`
goes from `undefined` at runtime to a compile error (the intended outcome — the
typecheck now catches it).

### Trap 2 — mutability: `Readonly<Data>` on both portable surfaces

- `ServerSocket.data` and `RoomConnection.data` are typed `Readonly<Data>` (shallow).
- A CF-breaking in-place mutation of `.data` becomes a compile error on the
  portable surface.
- Docs: Node-only mutable per-connection state uses a closure variable captured in
  `open()` / `onJoin()` (cast-free), not `.data`. The closure is the documented,
  portable-by-omission escape hatch (it is Node-only by nature, same as the old
  mutable bag, but it does not masquerade as cross-runtime state).

This is a **breaking change** at the type level for code that mutates `.data`.

### Trap 3 — 6KB budget on the Node dev path (additive)

- On the Node (no-connector) path, after the factory runs, if dev mode is on and
  `byteLength(JSON.stringify(data)) > MAX_FORWARD_HEADER_BYTES`, emit a
  `console.warn(...)` (Cloudflare still throws; Node only warns so it keeps
  working). Applies to both sockets and rooms.
- `MAX_FORWARD_HEADER_BYTES` and `byteLength` currently live in
  `cf/realtime-do-glue.ts`. The Node path must not import a `cf/` module, so hoist
  both to a runtime-neutral module (e.g. `realtime-budget.ts`) and re-export them
  from the glue to preserve the existing import sites.

## Cross-cutting work

- **Type tests:** extend `define-socket.test-d.ts` / `define-room.test-d.ts` to
  assert the new `undefined` default and the `Readonly<Data>` surface.
- **Runtime tests:** update existing socket/room tests that assert
  `conn.data === {}` or mutate `.data`.
- **Docs sync:** the realtime rooms/sockets pages get the new factory-less default,
  the read-only `.data` contract, and the closure-for-mutable-state guidance.
- **Release notes:** two breaking entries (room factory-less default; `.data`
  read-only).
- **Isolation:** substantive change set, so it lands in a dedicated worktree +
  branch (per the repo workflow), not on main's working tree.

## Out of scope

- Removing the `socketDef!` non-null bangs (that is #183).
- Any of the P2 modularity splits (#182–#185) or P3/P4 items.

## Acceptance criteria

- `compose-server-chain.test-d.ts` and `stream-registry.test-d.ts` run under
  `test:types` and each fails on a deliberate type-loosening change (#180).
- Each of the three realtime traps is a compile error or a dev warning rather than
  a doc note (#181):
  - factory-less room `conn.data.foo` is a compile error;
  - mutating `.data` on a socket or room connection is a compile error;
  - an over-budget factory result warns on the Node dev path.
- All eight pre-push CI steps pass.
