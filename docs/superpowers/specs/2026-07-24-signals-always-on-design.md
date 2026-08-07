# Signals as the always-on data layer (signals migration, Phase 5)

Date: 2026-07-24
Status: Design approved (scope + depth), pending written-spec review.
Branch: `feat/signals-always-on` (sub-PR into `feat/signals-migration`)
Umbrella: `2026-07-22-signals-migration.md`
Builds on: Phases 0-2 (all merged into the umbrella). Reverses those phases'
opt-in / zero-cost-when-unused stance.

## 1. Problem / decision

Phases 1-2 made presence and loader data granular **only when the app imports
`hono-preact/signals`**, behind a registration seam with a signals-free default
path, to honour a zero-cost-when-unused invariant. The framework owner's decision
for Phase 5: **make signals the framework's data-layer opinion, always active.**
Using a loader or a room gives you signal-backed granularity with no opt-in
import; the opt-in seam and the default paths go away.

This deliberately **retires the zero-cost invariant** for the data layer: an app
that uses loaders or rooms now always loads `@preact/signals` (~3.3 kB gz). Core
is unchanged; the framework's floor for a data-driven app rises by that amount.
That is the accepted trade for signals being the opinion.

## 2. Mechanism: direct import, no seam, no boot install

The cleanest realization of "always on" is not a boot-time install; it is to
**delete the registration seam** and have the data-layer modules import the
signal factories directly:

- `use-room.ts` imports `createSignalRoster` directly.
- `loader.tsx` / `define-loader.ts` import `createPhaseCell` / `derive` directly.

Consequences, all intended:

- `@preact/signals` loads exactly when a loader or a room is used (its options
  hooks install on first import of the factory module, before first render, as
  today). An app that uses neither still loads no signals. "Always on" means
  "always, when you use the data layer", not "forced onto an empty app".
- No `getPresenceReactiveImpl` / `getLoaderReactiveImpl` null-checks, no
  `registerXReactiveImpl`, no opt-in `hono-preact/signals` entry, no default
  path. One code path.

### Behaviour is unchanged from the tested signal path

Phases 1-2 already built the signal path as a complete, tested alternative
(e.g. `useRoom`'s signal branch never calls `setMembers`; `members` / `self` are
getters off the store). Phase 5 makes that path the only path by **deleting the
default alternative**, not by rewriting the signal path. So the observable
behaviour is exactly the Phase 1-2 signal-mode behaviour, which the existing
granularity / SSR / parity tests already pin.

## 3. File plan

**New (the factories relocated out of the deleted opt-in entry):**

- `packages/iso/src/internal/roster-signal.ts` - `createSignalRoster<S>()` (the
  presence store: `ids` signal + per-member signals + `members` computed +
  snapshot dedup). Imports `@preact/signals`. Imported by `use-room.ts`. Lands in
  the `realtime` size bucket.
- `packages/iso/src/internal/loader-signal.ts` - `createPhaseCell<T>(initial)`
  and `derive(source, select)`. Imports `@preact/signals`. Imported by
  `loader.tsx` / `define-loader.ts`. Lands in the `loaders` bucket.

**Modified:**

- `internal/reactive.ts` - keep the structural contracts `ReadonlyReactive<T>`,
  `RosterStore<S>`, `PhaseCell<T>` (these are what the new factory modules
  implement and what the consumers name). Remove `PresenceReactiveImpl`,
  `LoaderReactiveImpl`, and the `register*` / `get*` functions.
- `use-room.ts` - remove the `signalMode` flag, the `getPresenceReactiveImpl`
  branch, the `useState` members + `setMembers` default path, and the
  `createDefaultRoster` fallback. Always `createSignalRoster`. `members` / `self`
  getters read the store unconditionally (the getters already exist).
- `internal/loader.tsx` - remove the `getLoaderReactiveImpl` null-check; always
  create the phase cell via `createPhaseCell`; always provide the view-signal
  context from the cell (never the `{ value: viewState }` fallback on the client;
  the server `DataReader` still provides a one-shot `{ value: state }`, which
  needs no signal, see below).
- `define-loader.ts` - remove the `getLoaderReactiveImpl` branches in
  `readDataSignal` / `useFieldSignal`; always `derive`. (The default-mode
  fresh-getter path added in the Phase 2 fix is deleted with the branch.)

**Deleted:**

- `packages/iso/src/signals.ts` (the opt-in entry).
- `packages/iso/src/internal/default-roster.ts` and its test.
- The `hono-preact/signals` subpath and all its wiring (see §4).
- Tests that exercised the default (no-signals) path or the opt-in registration:
  `default-roster.test.ts`, `loader-reactive-registration.test.ts` (registration
  seam), the default-mode cases in `use-room-roster.test.ts` /
  `loader-data-signal-api.test.ts`. The signal-mode granularity / SSR tests stay
  and become the canonical coverage; drop their now-redundant
  `installX()` / `registerX(null)` scaffolding (the factories are always present).

## 4. Subpath teardown (undo the Phase 1-2 wiring)

Remove every trace of `hono-preact/signals`:

- `packages/iso/package.json` - remove the `./signals` export.
- `packages/hono-preact/package.json` - remove the `./signals` export.
- `packages/hono-preact/src/signals.ts` - delete.
- `packages/hono-preact/scripts/consolidate.mjs` - remove the
  `@hono-preact/iso/signals` entry from `DIST_PATHS` and the import-rewrite regex.
- `vitest.config.ts` - remove the two `hono-preact/signals` / `@hono-preact/iso/signals`
  aliases.
- `scripts/size-probe-config.mjs` - remove the `signals: ['signals.js']` bucket.
  Do NOT add `@preact/signals` to `EXTERNAL`. That list is peers only, and
  signals is a `dependency` (see the note at the end of this section), so the
  app does not already have it: its bytes are the framework's bytes, exactly
  like the bundled `@floating-ui/dom` in `packages/ui`. Excluding it prices the
  entire always-on decision at zero. Measured with it counted: `loaders`
  marginal 8,169 -> 11,037 B gzip, `actions` 6,596 -> 9,432, `realtime`
  1,890 -> 4,743, and a whole realistic app bundle 19,792 -> 23,967 B (+21.1%)
  against the pre-migration merge base.
- `packages/create-hono-preact/templates/agents/AGENTS.md` - remove the
  `hono-preact/signals` public-entry bullet (regenerate the corpus after).
- `packages/create-hono-preact/__tests__/agents-appendix.test.ts` - remove the
  `hono-preact/signals` import and barrel entry.
- `packages/hono-preact/__tests__/exports.test.ts` - remove the
  `hono-preact/signals export` block.

`@preact/signals` stays a `dependency` of both `@hono-preact/iso` and the
consolidated `hono-preact` package (now reached through the data-layer modules
rather than the deleted entry).

## 5. SSR

Unchanged in shape from Phase 2. The server `DataReader` still provides
`LoaderViewSignalContext value={{ value: state }}` (a one-shot snapshot, no
signal needed server-side), and `useRoom` renders an empty roster with no
connection. The client always creates the real signal store / cell. The
`@preact/signals` options patches under `preact-render-to-string` are already
proven safe (Phase 1-2 SSR tests, the #287 scar); those tests stay.

## 6. Size

Measured with the repo probe, `@preact/signals` external (a peer). Expectations
to verify:

- **Core unchanged** (~5,521 B gz): nothing new enters the `index.ts` graph.
- The `signals` bucket disappears; its ~360 B of glue folds into `realtime`
  (roster-signal) and `loaders` (loader-signal). Net framework glue is roughly
  flat (the same factory code, relocated) minus the deleted default-path code
  (`createDefaultRoster`, the dual-path branches), so realtime / loaders may
  slightly *shrink*.
- The honest number to report: an app using the data layer now ships
  `@preact/signals` (~3.3 kB gz) unconditionally. That is the point of the phase
  and is stated in the charter, not hidden.

## 7. Charter

Retire the zero-cost invariant. Replace with: **signals is the data-layer
opinion** - loaders and rooms are signal-backed and granular by default; using
the data layer loads `@preact/signals`; there is no opt-in and no non-signal
path. Record Phase 5 as delivering it, and re-open Phase 3 (now unblocked) and
Phase 4 on this foundation.

## 8. Testing

- **The existing signal-mode tests become canonical** and must stay green with
  the factories always present (drop their `installX`/`registerX(null)`
  scaffolding): presence granularity through `useRoom`, the self path, loader
  field granularity (mutation-checked), both SSR tests.
- **Delete** the default-path and registration-seam tests (§3).
- **New:** a small module-graph assertion that `use-room` / the loader entry
  reach `@preact/signals` (the data layer is signal-backed), and that the core
  `index.ts` graph does NOT (core stays signals-free). This replaces the old
  "core must not import @preact/signals" guard with the always-on version:
  core clean, data layer signal-backed.
- Full suite green; `test:types` green (the `never`-on-streaming assertions
  stay; the `useDataSignal`/`useFieldSignal` public types are unchanged, only
  their implementation loses the branch).
- All eight pre-push steps.

## 9. Scope (not in this phase)

- **Phase 3** (optimistic + action/form + field-error stores, and deleting
  `use-store-snapshot` / `use-force-update`) is NOT here. Phase 5 only collapses
  the presence + loader seam. Phase 3 converts those store consumers on this new
  always-on foundation, which is what finally lets the bridges be deleted.
- **Phase 4** (`<For>`, streaming-loader signals) is not here.
- No change to caching, preload adoption, reload, the reader machinery, or any
  public API signature. `useDataSignal` / `useFieldSignal` / `memberIds` /
  `member` keep their exact shapes; only the opt-in requirement and the internal
  dual path are removed.

## 10. Risks

- **`@preact/signals` options patches install whenever a data-layer module
  loads**, not only via the opt-in entry. This is the intended always-on
  behaviour and is already exercised by the Phase 1-2 SSR tests, but the new
  module-graph test should confirm the load happens through the data-layer
  modules and not the core entry.
- **Deleting the default path is a deletion, but a wide one.** The safety net is
  that the signal path it leaves behind is the one already covered by the
  Phase 1-2 tests; the risk is missing a live call site of the removed
  `getXReactiveImpl` / `createDefaultRoster`. A repo-wide grep for each removed
  symbol returning zero non-test hits is a required step.
- **Public docs churn.** Removing `hono-preact/signals` touches the AGENTS
  appendix and the exports test; the doc-completeness gate must pass after
  regenerating the corpus. This is the same gate Phase 1-2 had to satisfy when
  adding the subpath, run in reverse.
