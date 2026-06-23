# Drop `preact/compat` from the framework runtime

**Date:** 2026-06-23
**Status:** Approved design (spike-validated), pending implementation plan
**Scope:** Framework-wide. This is a change to the published `hono-preact` runtime and its Vite plugin, not just this monorepo. It carries a breaking-change surface (see below).

## Goal

Stop loading `preact/compat` anywhere in the shipped framework runtime, so its
module side-effects, the global `options` patches that enable React-compat
renderer behaviors (`className`/`htmlFor` mapping, event normalization,
`defaultValue`, etc.), never run. The maintainer wants to move off those
renderer flags. "Never ship compat again" is the durable requirement, enforced
by a regression guard.

## Background: where compat actually enters

The `apps/site` `react`/`react-dom`/`react-is` -> `npm:@preact/compat` aliases
were a **red herring**: nothing in the site imports `react`, so deleting them
changes nothing about compat loading. Compat is loaded because **the framework
itself imports it** in `@hono-preact/iso`:

- `useSyncExternalStore` from `preact/compat` -> `use-action-result.ts`, `use-form-status.ts`
- `Suspense` from `preact/compat` -> `internal/route-boundary.tsx`, `internal/loader.tsx`, `internal/page-middleware-host.tsx`

Plus two Vite-level vectors the framework ships:

- `packages/vite/src/hono-preact.ts` calls `...preact()` (`@preact/preset-vite`)
  with defaults, which sets `reactAliasesEnabled: true` (aliases `react` ->
  `preact/compat`).
- The same file lists `'preact/compat'` in `resolve.dedupe`.

Importing `preact/compat` anywhere runs its global `options` patches, so this is
all-or-nothing: a single remaining import keeps the renderer flags active.

### Why a compat-free Suspense is possible (spike-validated)

`preact-render-to-string@6.6.7` is already compat-agnostic on the server: its
async/streaming renderer catches any thrown thenable generically
(`index.js:~406`) and finds boundaries via preact-core hooks
(`getDerivedStateFromError` / `componentDidCatch`, `_childDidSuspend`). Preact
**core** already routes a thrown promise to a parent boundary that implements
`_childDidSuspend`; compat's `Suspense` is merely the component that implements
that hook plus the detach/restore + hydration-adoption bookkeeping. So a
faithful port of compat's `suspense.js` that imports only from `preact` core
runs on stock preact without the rest of compat.

## Approach (validated by spike, commits `53a9a55` + `bfa9520`)

1. **New `packages/iso/src/internal/suspense.tsx`** — a compat-free `Suspense`,
   a faithful port of `preact/compat`'s `suspense.js` importing only `preact`
   core (`Component`, `createElement`, `Fragment`, `options`). Preserves compat's
   hydration handling verbatim (during hydration it does not mark `_suspended`,
   so SSR markup is adopted, not discarded, the behavior `loader.tsx` depends on).
2. **Repoint the 3 Suspense consumers** (`route-boundary.tsx`, `loader.tsx`,
   `page-middleware-host.tsx`) from `'preact/compat'` to `'./suspense.js'`. JSX
   usage unchanged.
3. **Replace both `useSyncExternalStore` call sites** with the repo's existing
   compat-free pattern (`useReducer` force-update + `useEffect(() => subscribe(...), [])`,
   the same pattern in `packages/ui/src/toast/toaster.tsx`), reading the snapshot
   inline during render behind the existing `isBrowser()` guard.
4. **`packages/vite/src/hono-preact.ts`** — `...preact({ reactAliasesEnabled: false })`
   (option verified against `@preact/preset-vite@2.10.5`) and remove
   `'preact/compat'` from `resolve.dedupe`.
5. **`apps/site/package.json`** — delete the three `npm:@preact/compat` aliases.
6. **New guard test** — see the central risk below.
7. **Docs + scaffold sync** — `vite-config.mdx` dedupe sample, the
   `create-hono-preact` template `vite.config` / `package.json`, and the
   `leak-test` fixture `vite.config.ts`.

## Central decision and its risk: mangled-name coupling

`@hono-preact/iso` builds with plain `tsc` (no minify/mangle), so the property
names written in source are the names used at runtime. Preact ships a **minified**
dist whose private properties are mangled (`_catchError` -> `__e`, `_component`
-> `__c`, `_children` -> `__k`, `_flags` -> `__u`, ...). `preact/compat` works
against those mangled names only because it is built with preact's `mangle.json`.
Our unmangled module must therefore reference the **mangled** names directly.

This is a deliberate, accepted trade: we swap a coupling to `preact/compat` (a
public, supported package whose downside is the renderer patches we want gone)
for a coupling to preact's **private, undocumented mangle map** (stable across
all of 10.x, verified byte-identical in 10.29.1 / 10.29.2). A build-time mangle
step does **not** help: preact does not publish `mangle.json` to npm, so that
path would require vendoring and hand-maintaining the same map with more
machinery and no robustness gain.

**Mitigation (required):** a runtime guard test that renders a thrown-thenable
inside `<Suspense>` and asserts the fallback shows then resolves, plus an
assertion that the mangled keys this module reads (`__e` on `options`, and the
component/vnode fields) still exist on freshly constructed instances. This turns
a silent breakage on a preact bump into a red CI test. (A harder preact version
pin was considered as belt-and-suspenders and deliberately not adopted; the
guard test is the agreed mitigation.)

## Residual risks (from the spike, to address in the plan)

1. **Mangle-map coupling** (headline) -> guard test + version pin.
2. **SuspenseList path (`_suspended` / `__a`)** -> ported but unused/untested.
   Decide: keep (matches compat, near-zero cost) or drop to shrink surface.
3. **`lazy()` not ported** -> framework uses loader/`wrapPromise`, not `lazy`;
   omit, document that adding it later is trivial and mangle-free.
4. **Multiple concurrent suspensions under one boundary during hydration** ->
   `_pendingSuspensionCount` (`__u`) is ported but existing tests do not stress
   two sibling loaders suspending and resolving out of order. Add a test.
5. **`useSyncExternalStore` tear window** -> the `useReducer` pattern does not
   re-read the snapshot at subscribe time. For these synchronous in-memory stores
   the window is empty in practice (no writes between render and effect attach on
   the same tick) and all action/form/optimistic tests pass, but a reviewer must
   sign off on the semantic difference.
6. **`options` patch ordering / idempotency** -> the module chains the previous
   `_catchError` / `unmount` handlers at import time. With compat gone nothing
   else installs these, so ordering is moot today; add a guard-once flag to be
   defensive against double-wrap.

## Breaking-change surface (for release notes)

This changes published framework behavior, invisible in an export-surface diff:

- `reactAliasesEnabled: false`: consumers who imported `react` / `react-dom`
  (e.g. a React-shaped library) relying on preset-vite's implicit
  `react -> preact/compat` alias must now add the alias themselves.
- Compat's global `options` patches no longer load: apps that depended on
  compat-only DOM/prop/event behaviors (`className`, `htmlFor`, `onChange`
  semantics, `defaultValue`, ...) change behavior.
- `'preact/compat'` removed from the framework's `resolve.dedupe`: consumers who
  opt into compat lose the single-instance dedup safety.

Record these in the next release notes (the project tracks export-diff-invisible
breaking changes explicitly).

## Verification

Mirror the 8-step pre-push CI gate (`CLAUDE.md`), plus change-specific checks:

1. No `import ... from 'preact/compat' | '@preact/compat'` anywhere in shipped
   source (packages/*/src, apps/site/src), excluding comments and the standalone
   `leak-test` fixture once updated.
2. The new guard test passes and actually fails if a mangled key is missing
   (mutation-check it, do not ship a test that passes against broken internals).
3. Built `apps/site/dist` client bundle contains zero compat runtime signatures
   (`forwardRef`, `PureComponent`, `CAMEL_PROPS`, `hoistNonReact`) and no
   `@preact/compat`; the only `preact/compat` strings left are docs prose.
4. Full suite (`test:coverage`, 1968+ tests) and `test:integration` green, with
   focus on the loader / route-boundary / page-middleware-host / hydration /
   streaming-SSR suites.
5. `format:check`, `typecheck`, `test:types`, framework build, site build green.
