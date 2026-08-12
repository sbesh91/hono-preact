# Preact 11 RC compatibility POC

Status: findings record. The compatibility work described here is
dual-major and verified green on Preact 10; adopting Preact 11 itself is
blocked upstream (see item 5).

Pins the whole workspace to `preact@11.0.0-rc.0` via a `pnpm-workspace.yaml`
override (`preact-render-to-string@6.7.0` already supports both majors), then
runs the full CI pipeline to find out what a Preact 11 upgrade actually costs.
It answers "what breaks", not "should we upgrade yet".

The branch is left **on Preact 10** with the compatibility work applied, because
that work is dual-major and mergeable on its own. All eight CI gates pass on
Preact 10 as committed. To re-run against 11, add to `pnpm-workspace.yaml`:

```yaml
overrides:
  preact: 11.0.0-rc.0
```

Flipping that override in place is not enough: pnpm leaves peer-linked packages
(`@testing-library/preact`, `@preact/signals`) pointing at the previous major,
which produces two live Preact instances and ~800 bogus hook failures. Delete
`node_modules` and reinstall after each flip.

Reproduce:

```sh
pnpm install
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm gen:agents-corpus
pnpm typecheck && pnpm typecheck:tests && pnpm test:types
pnpm test && pnpm test:integration && pnpm test:smoke
pnpm --filter site build
```

## Result

| Gate | Before fixes | After the fixes in this branch |
| --- | --- | --- |
| framework build / `typecheck` | 118 errors (`ui` 125, `iso` 8) | pass |
| `typecheck:tests` |, | pass |
| `test:types` |, | pass (41) |
| `test` | 47 failed / 3535 | 9 failed / 3535 |
| `test:integration` | blocked by the build | pass (13) |
| `test:smoke` | blocked by the build | **pass (13)** |
| `apps/site` build |, | pass |

37 of the original 47 unit failures were the ungenerated agents corpus, not
Preact. The real count was 10; nine remain, and eight of those are one behavior
change (see below).

The smoke suite passing is the most reassuring single result: no `Cycle
detected`, no SSR 500, both adapters, dev and built. The `@preact/signals`
`options.__r` install-order hazard does not reproduce on 11 RC.

## What broke, and why

### 1. The JSX namespace no longer holds element or event types (118 errors)

Preact 11 moved `HTMLAttributes`, `CSSProperties`, `Targeted*Event`,
`*EventHandler`, and the per-element `*HTMLAttributes` interfaces out of the
`JSX` / `JSXInternal` namespace and into `preact/src/dom.d.ts`, re-exported from
the package root. `JSX.Element` and `JSX.IntrinsicElements` stay.

So `JSX.HTMLAttributes<HTMLDivElement>` is gone; `HTMLAttributes<HTMLDivElement>`
imported from `preact` replaces it. Distribution of the 118 errors:

| Spelling | Sites |
| --- | --- |
| `JSX.HTMLAttributes` | 56 |
| `JSX.TargetedMouseEvent` | 22 |
| `JSX.TargetedPointerEvent` | 19 |
| `JSX.TargetedKeyboardEvent` | 9 |
| `JSX.CSSProperties` | 5 |
| others (`TargetedFocus/Input/Composition`, `Input/AnchorHTMLAttributes`, `InputEventHandler`) | 7 |

**The root-import spelling is dual-compatible.** Preact 10 re-exports the same
types from its root as of **10.28.0** (bisected: 10.27.0 fails, 10.28.0 passes).
So this is a pure find-and-replace plus an import merge (23 files, applied here
by codemod), and the only compatibility cost is raising peer minimums:

- `hono-preact` / `@hono-preact/iso`: `preact: >=10.25.0` → `>=10.28.0`
- `hono-preact-ui`: `preact: >=10.11.0` → `>=10.28.0`

This work is worth doing **now**, independent of any Preact 11 decision: it
costs a minor peer bump and removes the single largest upgrade blocker.

### 2. `RefObject<T>` is nullable-aware (19 files)

The two majors define the type differently:

| | Preact 10 | Preact 11 |
| --- | --- | --- |
| `RefObject<T>` | `{ current: T \| null }` | `{ current: T }` |
| `Ref<T>` | `RefObject<T> \| RefCallback<T> \| null` | `RefCallback<T> \| RefObject<T \| null> \| null` |
| `useRef<T>(null)` returns | `RefObject<T>` | `RefObject<T \| null>` |

So `RefObject<T | null>` denotes the same shape in both, and it is the spelling
every *slot* that receives a ref should use. Every context type and hook option
declaring `RefObject<HTMLElement>` was widened. Most of these are in `packages/ui`
(`use-position`, `use-positioner`, `use-dismiss`, `use-focus-return`,
`dismiss-stack`, `list-navigation`, and the six component context modules).

**Widening the slots is not free on Preact 10, and the reason is worth
recording.** `RefObject` is a covariant alias, so TS compares
`RefObject<HTMLElement | null>` against `RefObject<Element>` by checking
`HTMLElement | null ⊆ Element`, which fails on `null` even though the two object
types are structurally identical. Three follow-on fixes, all dual-safe:

- `AnyRef<T>` in `packages/ui/src/merge-refs.ts` became `Ref<T | null> | null | undefined`.
- Two `as Ref<Element>` casts in `toast-parts.tsx` became `as AnyRef<Element>`.
- `useInView` in `apps/site` could not return `RefObject<T>` (breaks on 11) or
  `RefObject<T | null>` (breaks on 10, at the `ref=` prop, whose type is
  `Ref<T>` there). The dual-safe spelling is the **structural** type
  `{ current: T | null }`, which sidesteps the alias-variance shortcut entirely.

That last one is the general rule: for a value that is both produced by `useRef`
and handed to a `ref` prop, spell the type structurally, not via `RefObject`.

### 3. Per-element ARIA role narrowing breaks prop-forwarding wrappers

This is the interesting one, and it is new type *capability*, not just
relocation. Preact 11 types `<a>` as
`AccessibleAnchorHTMLAttributes = Omit<PartialAnchorHTMLAttributes, 'role'> & AnchorAriaRoles`,
where `AnchorAriaRoles` is a **discriminated union**:

```ts
| { href: Signalish<string>;  role?: 'link' | 'button' | 'menuitem' | /* 12 more */ }
| { href?: never;             role?: AriaRole /* all 130-ish */ }
```

An anchor with an `href` may only carry anchor-legal roles. `<form>` is
constrained the same way (`'search' | 'form' | 'none' | 'presentation'`).

The trap: `Omit<JSX.IntrinsicElements['a'], 'class'>` **collapses that union**,
widening `role` back to the full `AriaRole`, which then fails to assign to `<a>`
on the way out. `NavLinkProps` and `FormProps` both hit this. The fix is a
distributing alias, the same shape as the `DenyOf` lesson from v0.13:

```ts
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NavLinkProps = DistributiveOmit<JSX.IntrinsicElements['a'], 'class' | 'className'>;
```

Note this also means deriving wrapper props from `AnchorHTMLAttributes` (the
non-accessible interface, still exported and still wide) silently opts out of
the narrowing. Deriving from `JSX.IntrinsicElements[tag]` is the spelling that
keeps it, which matches pracht's conclusion in JoviDeCroock/pracht#245.

### 4. Passive effect cleanup is deferred on unmount (8 of the 9 remaining failures)

Preact 11's "defer passive effect cleanup on unmount" changes when `useEffect`
teardown runs. Probed directly:

| After `unmount()` | `useLayoutEffect` cleanup | `useEffect` cleanup |
| --- | --- | --- |
| synchronously | ran | not run |
| after a microtask | ran | not run |
| after one `requestAnimationFrame` | ran | not run |
| after 100 ms | ran | ran |

It lands on preact's `afterPaint` scheduler (rAF raced with a 100 ms timeout),
not on any tick a test can await cheaply. Every failing assertion is the same
shape ("unsubscribes / aborts / disconnects on unmount"), asserted immediately
after `unmount()`:

- `packages/iso/src/__tests__/action-cancellation.test.tsx` (2): the submit
  `AbortSignal` is not yet aborted
- `packages/iso/src/__tests__/view-transition-types.test.tsx` (3) and
  `view-transition-lifecycle.test.tsx` (1): subscriptions still fire
- `apps/site/src/components/__tests__/HeroShader.test.tsx` (2): worker not
  terminated, ResizeObserver not disconnected

These are test-timing failures, not framework defects, but the underlying
behavior change is real and user-visible: an in-flight action now keeps running
for up to a frame past unmount, and a WebGL worker or observer survives that
long too. Anything where the teardown is load-bearing (aborting requests,
releasing GPU resources, closing sockets) should move to `useLayoutEffect` or
be given an explicit non-effect teardown path rather than relying on `useEffect`
cleanup timing. Worth auditing our realtime/socket teardown before committing to
11.

### 5. `preact-iso`'s suspension hold-alive breaks (the 1 remaining failure)

`packages/iso/src/internal/__tests__/route-hold-alive.test.tsx` fails: the
outgoing route is unmounted immediately instead of being held on screen while
the incoming guarded chain is pending. The user-visible regression is a blank
flash on every guarded navigation.

This is **not our code**. `preact-iso` v3 implements hold-alive by reaching into
Preact 10 private internals, `this.__v.__k.reverse()` to suppress diffing,
`__u |= MODE_HYDRATE | MODE_SUSPENDED`, `__h`, `this.__v.__e`, and the `__c`
suspension hook. Hydration 2.0 reworked exactly those internals.

Its published peer range already claims `preact: ">=10 || >= 11.0.0-0"`, which
is optimistic, the package resolves and runs, it just loses this behavior. That
peer range is a hazard for us in the other direction too: it means nothing stops
a user from installing Preact 11 under our current pins.

**This is the actual blocker.** Items 1–3 are our work and cheap; item 4 is an
audit; item 5 needs upstream `preact-iso` to be ported to Preact 11 internals,
and we do not control that.

## Bundle size

Preact 11's "-100 bytes across all packages" does not show up as a win for a
hono-preact app. Measured on the docs site's real always-loaded baseline (entry
chunk plus its static-import closure, 19 chunks both ways):

| | Preact 10.29 | Preact 11.0.0-rc.0 | Δ |
| --- | --- | --- | --- |
| gzip | 23 378 B | 23 415 B | **+37 B** |
| raw | 57 465 B | 57 020 B | −445 B |

Flat. `scripts/measure-framework-size.mjs` shows no movement at all, as
expected, it externalizes peers, so it measures our code, which is unchanged.

## Verified on Preact 10

The whole migration is applied on this branch **with Preact 10 installed**, and
every gate is green: build, `format:check`, `typecheck`, `typecheck:tests`,
`test:types`, `test` (3535 passed, 0 failed), `test:integration`, and the
`apps/site` build. Peer minimums are bumped to `>=10.28.0` in
`@hono-preact/iso`, `@hono-preact/server`, `hono-preact`, and `hono-preact-ui`.

That is the mergeable artifact here. Under Preact 11 RC the same tree leaves the
9 runtime failures described in items 4 and 5.

## Recommendation

1. **Land the dual-compatible type migration now** (items 1–3), on Preact 10,
   with peer minimums raised to `>=10.28.0`. It is mechanical, it is verified
   green under the current major, and it removes 118 of the 128 upgrade errors
   from the future.
2. **Audit `useEffect` teardown where timing matters** (item 4), realtime
   sockets, action aborts, observers, and move the load-bearing ones off
   passive-effect cleanup.
3. **Do not adopt Preact 11 until `preact-iso` is ported.** Track that upstream.
   Until then, consider whether our peer ranges should exclude 11 explicitly
   rather than silently allowing an install that loses hold-alive.
4. Re-run this branch against each RC. Everything except item 5 is now green,
   so the re-check is cheap.

Tracked in #379 (Preact 11 readiness).

## Upstream context

- [Preact 11.0.0-RC.0](https://github.com/preactjs/preact/releases/tag/11.0.0-rc.0)
- [Hydration 2.0 RFC](https://github.com/preactjs/preact/issues/4442)
- [JoviDeCroock/pracht#245](https://github.com/JoviDeCroock/pracht/pull/245):
  the parallel streaming-hydration experiment. Its standing guidance is to
  render `<head>` in the shell and stream only `<body>`, because a suspended
  `<head>` serves placeholder metadata to any client that does not run the
  stream's patcher script.
