# Signal-backed stores: optimistic, action/form, per-field errors (signals migration, Phase 3)

Date: 2026-07-25
Status: Design approved (return-signals + per-field granularity + bridge deletion), pending written-spec review.
Branch: `feat/signals-stores` (sub-PR into `feat/signals-migration`)
Umbrella: `2026-07-22-signals-migration.md`
Builds on: Phase 5 (signals always-on) and Phase 4b (read hooks return signals;
`@preact/signals` re-exported first-party; `ReadonlySignal` is the read type).
This is the last planned phase.

## 1. Problem and decision

The optimistic queue, the action-result store, and the form-submit store predate
the always-on foundation. They are hand-rolled around two bridges, `useStoreSnapshot`
(a compat-free `useSyncExternalStore`) and `useForceUpdate`, built specifically to
keep `@preact/signals` off the then-opt-in path. Phase 5 retired that constraint,
so the bridges are now pure overhead, and per-field form errors sit on a single
context (any field error re-renders every `<FieldError>`), the one real
granularity gap left in the data layer.

The owner's decision: convert these stores to signals, following the same rule
Phase 4b set for `useData`, **a reactive read hook returns a signal** (no
`-Signal` suffix; the return type says it). Concretely:

- **The stores become signal-backed.** `action-result-store` / `form-submit-store`
  hold their state in `signal()`s; the optimistic queue is a signal; the
  subscribe/notify listener sets and `useForceUpdate` go away.
- **The read hooks return signals** (a breaking return-type change, shipping with
  the umbrella release like `useData`'s):
  - `useActionResult(stub?): ReadonlySignal<ActionResult<...>>`
  - `useFormStatus(stub?): ReadonlySignal<FormStatus>`
  - `useOptimistic(base, reducer, opts): [ReadonlySignal<TBase>, (payload) => OptimisticHandle]`
- **Per-field form errors go granular.** `<Form>` exposes a per-field error
  signal accessor (the presence `member(id)` pattern), so a `<FieldError name="x">`
  re-renders only when field `x`'s errors change.
- **`useStoreSnapshot` and `useForceUpdate` are deleted**, along with their tests;
  `page-middleware-host` (the other `useForceUpdate` caller) moves to a signal.

Projection stays `useComputed` (re-exported from `hono-preact` in Phase 4b). No
new read primitive is added; the surface stays the existing hooks, now
signal-returning.

## 2. Guiding principles (carried from Phase 4b)

One consistent rule (a reactive read returns a signal), no duplication, no
`-Signal` suffix, simple compiler-guided transition (add `.value`), and every
primitive earns its place. `@preact/signals` stays confined to the sanctioned
factory modules so the Phase 5 core-signals-free invariant holds.

## 3. The store conversions

### action-result store

`internal/action-result-store.ts` today is a module `listeners: Set` plus
`set`/`clear`/`get`/`subscribe`. Replace with a module-level
`signal<StoredActionResult | null>` (created via the loader-signal factory so
`@preact/signals` stays in a sanctioned module, or a new `internal/store-signal.ts`
factory alongside it). `set`/`clear` write the signal; `subscribeLastActionResult`
and the `Set` are deleted.

`useActionResult(stub?)`: `useComputed` that reads the store signal, filters by
`stub`, and falls back to the SSR `ActionResultContext` (the progressive-enhancement
deny re-render path, unchanged), returning `ReadonlySignal<ActionResult>`. The
memoization is a `useRef` like `useData`'s (one computed per call site).

### form-submit store

`internal/form-submit-store.ts` (the pending-tracking store behind `useFormStatus`):
same treatment, a signal replaces the subscribe/notify. `useFormStatus(stub?)`:
`useComputed` returning `ReadonlySignal<FormStatus>` (`{ pending }`).

### optimistic

`optimistic.ts`'s `useOptimistic` keeps its queue in a ref and re-renders via
`useForceUpdate`. Replace with a per-call `signal` holding the queue (or a
`signal` tick), so the derived value is a `useComputed(() => queue.value.reduce(
reducer, base))`. Return `[ReadonlySignal<TBase>, dispatch]`. The `dispatch`
function, `OptimisticHandle`, and `transition` behaviour are unchanged; only the
value channel becomes a signal. The base-change reconciliation (drop `ready`
entries when `base` changes) stays.

## 4. Per-field form errors (granular)

Today `<Form>` computes one `FieldErrorsMap` (`Record<string, string[]>`) and
provides it on `FieldErrorsContext`; `<FieldError>` / the field-prop wiring read
the whole map, so any field's error change re-renders all of them.

Convert to per-field signals, the loader/presence pattern:

- `<Form>` holds the field errors in a signal-backed store keyed by field name
  (a map signal plus a per-field `fieldError(name): ReadonlySignal<string[]>`
  accessor, or per-field signals in a Map, mirroring `roster-signal.ts`).
- The context carries the accessor (a stable `{ fieldError(name) }`), not the raw
  map. `<FieldError name="x">` / `useFieldErrors(name)` read `fieldError(name).value`,
  subscribing only to field `x`. A field whose errors do not change does not
  re-render when a sibling field's errors do.
- `FieldErrorsMap` stays the public type (the shape of the whole error set);
  `useFieldErrors()` without a name (if it exists) reads a coarse `all` signal.

The client/server error merge `<Form>` already does (client `setClientErrors` +
server `ActionResultContext` issues) feeds the per-field store; SSR provides the
initial errors so first render matches.

## 5. Deletions and the last force-update caller

- Delete `internal/use-store-snapshot.ts` + `internal/__tests__/use-store-snapshot.test.tsx`.
- Delete `internal/use-force-update.ts` + `internal/__tests__/use-force-update.test.tsx`.
- `internal/page-middleware-host.tsx` (the only other `useForceUpdate` caller):
  convert its force-render to a signal read (a `signal` tick or reading the real
  reactive state it force-updates on). Its behaviour is unchanged.

## 6. SSR

The stores are client-only state (action results, form pending, optimistic queue
are all post-submit / client-interaction state), so their signals start empty on
the server and the existing SSR fallbacks stay:

- `useActionResult` still reads `ActionResultContext` on the server (the PE deny
  re-render path); the client store signal wins once populated.
- `useFormStatus` is `pending: false` on the server.
- Per-field errors: `<Form>` seeds the per-field store from the server-provided
  issues so first client render matches SSR (no hydration mismatch).

The `@preact/signals` + `preact-render-to-string` patches are already proven
(Phases 1-5 SSR tests); nothing new here.

## 7. Public API and release surface

Breaking return-type changes to released hooks, shipping with the umbrella's one
release (documented in its release notes): `useActionResult`, `useFormStatus`
return `ReadonlySignal`s; `useOptimistic`'s tuple value becomes a `ReadonlySignal`.
The transition is compiler-guided (add `.value`) for most call sites, but NOT for
all of them, and the exceptions are silent. `Signal.prototype` defines `valueOf`,
`toString` and `toJSON`, so a value consumed only via a template literal,
`String()`, `JSON.stringify` or an `unknown`-typed sink type-checks unchanged and
keeps rendering the right characters. Separately, the returned signals are stable
identities (`useComputed`/`useSignal` are `useMemo(..., [])`), so a signal left in
a `useEffect`/`useMemo` dependency array type-checks and pins that effect at mount
- the effect silently stops firing. The correct spelling in a dependency array is
`signal.value`. The repo has no linter (prettier + tsc only), so nothing backstops
either shape; both must be caught by review. No hook is renamed; no new hook
is added. `FieldErrorsMap` and the `useFieldErrors` / `<FieldError>` names are
unchanged; only their reactivity narrows to per-field.

## 8. Testing

- **Stores:** the action-result and form-submit signals update their consumers;
  `set`/`clear` drive the signal; the `stub` filter still selects the right
  action's result. Retarget the existing store tests to the signal reads.
- **Read hooks (return signals):** `useActionResult()` / `useFormStatus()` return
  `ReadonlySignal`s; a binding updates without the host re-rendering (the `useData`
  granularity pattern). `*.test-d.ts` pins the new return types.
- **Optimistic:** the returned signal reflects the folded queue; `dispatch`
  enqueues; base-change drops `ready` entries; `transition` unchanged. The value
  signal updates granularly.
- **Per-field errors (the headline granularity):** a change to field `a`'s errors
  re-renders only `<FieldError name="a">`, not `name="b"` (render-counter,
  mutation-checked, the presence-granularity pattern). SSR seeds first render.
- **Deletions:** `use-store-snapshot` / `use-force-update` tests removed; nothing
  imports them (grep zero). `page-middleware-host` behaviour unchanged (its tests
  stay green).
- **Module-graph guard:** `@preact/signals` still only via the sanctioned factory
  modules (the store signals are created through a factory, not a raw import in
  `action-result-store.ts` / `form-submit-store.ts` / `optimistic.ts`); extend the
  guard's importer set if a new `internal/store-signal.ts` factory is added.
- All eight pre-push steps; docs sync (the forms/actions/optimistic docs now read
  `.value`); no historical breadcrumbs.

## 9. Scope (not in this phase)

- No change to the optimistic `dispatch` / `OptimisticHandle` / `transition` API,
  the action invocation path, form submission, or validation, only the read
  channels become signals and per-field errors go granular.
- No new read primitive; projection stays `useComputed`.
- No routing, loader, or presence change.

## 10. Risks

- **Breaking-surface breadth.** Three released hooks change return type. Partly
  mitigated by its being compiler-guided (`.value`) and shipping in the umbrella's
  one release with notes; all call sites are updated in this PR (the same fan-out
  Phase 4b's value-`useData` removal handled). The residual risk is the two shapes
  tsc does NOT flag (see section 7): coercion sinks (template literal, `String()`,
  `JSON.stringify`, `unknown` parameters) and dependency arrays, where a stale
  spelling compiles, renders correctly, and silently freezes the effect. Nothing
  in the repo lints for it, so it is a review obligation.
- **Per-field store correctness.** The client/server error merge must feed the
  per-field signals without dropping the coarse "all errors" read or breaking SSR
  seeding. Covered by the granularity test plus an SSR-parity test.
- **Keeping `@preact/signals` in sanctioned modules.** The store signals must be
  created through a factory (loader-signal or a new store-signal), not a raw
  import in the store files, or the module-graph guard trips. The guard is the
  safety net.
- **`page-middleware-host` force-update replacement** must preserve its exact
  re-render timing; its existing tests are the check.
