# Signals-first migration: investigation

Date: 2026-07-22
Status: Investigation. No implementation proposed for approval yet.
Branch: `worktree-signals-spike`
Supersedes the scope of, but does not replace,
[`2026-07-21-first-party-signals-design.md`](./2026-07-21-first-party-signals-design.md)
(which covers the narrower opt-in loader question and carries the measured
compatibility and cost evidence).

Method: five parallel read-only subsystem surveys (loaders, actions/forms,
realtime, routing/navigation, UI package) against the real design on `main`,
plus the implemented spike on this branch.

---

## 0. The finding that should shape the decision

**"Migrate the entire framework to signals" is the wrong unit of work, and the
thing blocking the biggest win is not reactivity at all.**

Three things came out of the survey that a byte-count or a feature comparison
would not have shown:

1. **The re-render cost is concentrated, not diffuse.** Four hot spots account
   for essentially all of it. Three are fixable in isolation. The framework does
   not have a general over-rendering problem that a general reactivity change
   would cure.

2. **The largest single re-render source cannot be fixed by signals.**
   `preact-iso`'s `Router` rebuilds its context value and re-creates the matched
   child element on every navigation, so the matched view's component function
   re-runs regardless of what its data is made of (`router.js:105-116`,
   `:160-193`, `:300`). A framework that adopts signals everywhere and keeps this
   router is signals-flavoured, not signals-first. Fixing it means owning the
   router.

3. **The hottest interaction in the whole product is in the UI package, and its
   correct fix is not signals.** `use-position.ts:112` holds floating-element
   position in `useState` and `autoUpdate` (`:179`) writes it on every scroll and
   resize frame, re-rendering the positioned subtree per frame. The right fix is
   to stop routing position through render at all and write transforms to the
   DOM in the `autoUpdate` callback. Signals would make that cheaper; not
   rendering would make it free.

So the recommendation at the end of this document is not "migrate" or "don't
migrate". It is: **adopt signals as an internal representation for the four hot
sources, extract the reactivity core as its own module while doing it, and treat
the router as a separate, later, much larger decision.**

---

## 1. What signals-first should mean here

Terminology matters, because "signals-first" is used to mean at least three
different things and they have very different costs.

| Interpretation | What it means concretely | Verdict |
| --- | --- | --- |
| **Signals as internal representation** | Framework sources hold signals; public API still takes and returns plain values | Viable now, incremental, reversible |
| **Signals in the public API** | `useDataSignal()`, `members` is a `Signal<T>`, users bind `{sig}` in JSX | Viable, additive, but a permanent API-surface and teaching cost |
| **Signals as the render model** | No component re-execution on data change; the router, guards and Suspense all rebuilt around reactive graphs | A different framework. Requires replacing preact-iso. |

The first two are what this document evaluates. The third is named in §7 so that
nobody mistakes the first two for it.

---

## 2. The reactivity map

Every framework-owned reactive source, what holds it, and what it costs today.

| # | Source | Holder | Update frequency | Blast radius today | Signals payoff |
| --- | --- | --- | --- | --- | --- |
| 1 | Room presence roster | `useState` `use-room.ts:147` | Per join/leave/presence event, unthrottled | Whole `useRoom` consumer subtree, per event, per member | **Highest** |
| 2 | Floating position | `useState` `use-position.ts:112` | Per scroll/resize frame | Positioned subtree, per frame | **Highest** (but see §5.4) |
| 3 | Loader phase | `useState` `use-loader-runner.tsx:85` | Per fetch settle, per stream chunk, per revalidation | Whole `<Loader>` subtree via one context | **High** for lists and live data |
| 4 | Listbox `activeId` | `useState` `select.tsx:102` | Per arrow keypress | Whole Select subtree per keystroke | Medium |
| 5 | Optimistic queue | `useRef` + `useForceUpdate` `optimistic.ts:27,85-105` | Per mutation | Component-local | Mechanical only |
| 6 | Action result / form status | Module `Map` + hand-rolled `useSyncExternalStore` | Per submit | Per-key narrowed already | Mechanical only |
| 7 | `useAction` pending/error/data | `useState` `action.ts:369-373` | Per submit | Component-local | **None** |
| 8 | WS status / closeInfo | `useState` `ws-lifecycle.ts:97-98` | Per connect/close | Consumer subtree | Low |
| 9 | Route location / params | preact-iso context | Per navigation | Every location consumer + matched subtree re-execution | **Blocked** (§7) |
| 10 | NavLink active state | derived from #9 `route-active.ts:36-41` | Per navigation | Every `NavLink` in the app | Medium, cheap to fix |
| 11 | Head (`hoofd`) | Collected during SSR render, read once | Once per request | None | **None** |

Rows 7 and 11 are worth stating explicitly because they are where a naive
"convert everything" migration burns effort for zero return. `useAction`'s state
is component-local with no fan-out; a signal there is a differently-spelled
`useState`. Head management is a single-pass SSR concern that never re-renders.

### 2.1 Quantifying the top of the list

Presence is the clearest case. Every presence event today does a full array
reallocation (`use-room.ts:256-270` does `slice()` + `findIndex` + splice) and
calls `setMembers`, re-rendering every consumer. With N members each emitting
events, the cost is O(N x M) component re-renders. There is no throttling
anywhere in the path and no heartbeat, so a cursor board wired to `mousemove`
sends a wire frame and re-renders every peer's whole roster subtree per mouse
move. `self` is recomputed with `.find()` on every render (`use-room.ts:241-242`)
whether or not presence changed.

This is the one place in the framework where the "Linear 50-issue" framing is
literally true today.

---

## 3. Constraints any design must respect

These came out of the surveys and are non-negotiable inputs, not preferences.

**C1. The mirror law.** Proven empirically on this branch: making a signal the
authoritative source and suppressing the host's re-render froze every
`useData()` / `.View()` consumer in the same tree at the first value, because
they read `LoaderDataContext`, which only changes when the host re-renders.
**Signals must be an additional read channel, never the sole source of truth,
until every consumer of that source is converted.** This is the single most
important safety rule for the whole migration.

**C2. Render purity is load-bearing in the loader path.** `getPreloadedData` is
documented pure and its DOM cleanup is deliberately deferred to an effect
because Preact does not support mid-render DOM mutation
(`use-loader-runner.tsx:125-130`). Meanwhile `buildPreloadReader` performs a
synchronous `cache.set` **during render** (`:431`). A signal write during render
is a stronger hazard than a ref write, because it can notify subscribers
mid-render. Making `LoaderCache` itself reactive would turn an existing
tolerable impurity into a real one.

**C3. Server-side error propagation cannot move to a reactive channel.**
`preact-render-to-string` does not propagate a throw from a suspended subtree to
an ancestor boundary (`loader.tsx:99-104`, and the #287 scar). The deny/coldError
path must stay throw-based on the server. Only the client's in-view surfacing is
a signals candidate.

**C4. Effect-scoped teardown is the current lifetime guarantee.** Every WS
subscription is owned by exactly one `useEffect` whose cleanup nulls handlers,
closes the socket and sets an `unmounted` flag checked at four call sites
(`ws-lifecycle.ts:150-268`). Signals that outlive components are the whole point
of module-scoped signals, and here that would leave connections open with no
owner. **`@preact/signals` has no ownership/disposal scope primitive** (no
`createRoot`/`onCleanup` equivalent). This is a genuine gap, and it is where
naive signals adoptions become hacky.

**C5. SSR must not connect, and the guard is inside an effect.** `isBrowser()` is
checked inside `useWsLifecycle`'s effect (`ws-lifecycle.ts:151`), which never runs
during SSR anyway. But `makeRoomRef`/`makeSocketRef` attach the real hook to the
server-side def, so SSR **does** call `useRoom`/`useSocket` for real. Any signals
construction that moves out of the effect (a natural signals idiom) reintroduces
a server-side connect unless the guard moves with it.

**C6. Adopting `@preact/signals` contradicts a documented rationale.**
`use-store-snapshot.ts:5-11` says it was hand-rolled specifically so the
framework never imports `preact/compat`, "which installs global options
patches". `@preact/signals` installs six global `options` patches
(`__b`, `__r`, `__e`, `diffed`, `unmount`, `__h`). The rationale needs to be
restated or retired honestly, not quietly ignored.

---

## 4. Signals-first design patterns worth adopting

These are the patterns I would build the framework around, in priority order.
They are what make the difference between a signals migration and a signals
retrofit.

### P1. Sources become stores, hooks become bindings

Today every reactive source is a hook that owns `useState`. That is why
`use-loader-runner.tsx` is 577 lines doing five jobs, and why none of its five
reader factories can be tested without mounting a component.

Signals-first inverts this: the source is a plain object created **outside** the
component, and the hook is a thin binding to it.

```ts
// Not a hook. Testable with no renderer. No Preact import.
export function createLoaderStore<T>(deps: LoaderDeps<T>): LoaderStore<T> {
  const phase = signal<LoaderPhase<T>>({ tag: 'loading' });
  const view = computed(() => toLoaderView(phase.value, sync.peek()));
  return { phase, view, reload, dispose };
}

// The hook does binding and lifetime, nothing else.
export function useLoaderStore<T>(deps: LoaderDeps<T>): LoaderStore<T> {
  const store = useRef<LoaderStore<T>>();
  store.current ??= createLoaderStore(deps);
  useEffect(() => () => store.current!.dispose(), []);
  return store.current;
}
```

This is the single biggest modularity win available, and it is mostly
independent of signals: the discipline is "state lives in a plain object with an
explicit lifetime; components bind to it". Signals just make the binding cheap.

### P2. Keyed per-entity signals for collections

One signal holding an array gives you nothing: any change replaces the array and
every reader re-runs. The shape that actually delivers O(1) updates is a keyed
map of signals plus a signal of the key order:

```ts
type Roster = {
  ids: Signal<readonly string[]>;              // membership changes only
  member: (id: string) => ReadonlySignal<PresenceState>;  // per-entity
};
```

A join/leave writes `ids`. A presence update writes exactly one member signal
and does not touch `ids`, so the list does not re-render and only the moved
avatar updates. This is the pattern for #1 (roster) and for loader-backed lists.

It is also the pattern most often skipped, which is why so many signals
adoptions produce no measurable win.

### P3. Derived state as `computed`, not per-render projection

`toLoaderView(phase, syncRef)` is recomputed on every render today whether or
not the phase changed (`use-loader-runner.tsx:546-557`), and `loader.tsx:231`
adds a `useMemo` downstream to re-stabilise the reference it just destabilised.
As a `computed` the projection is memoized once, shared by every reader, and the
downstream `useMemo` becomes unnecessary.

The ADT itself does not change. `LoaderPhase`, the `data?: never` cold arms and
the structural presence rule all survive verbatim. Signals relocate **where the
read happens**, not what is legitimately present.

### P4. Explicit owner scopes, because the library does not provide them

This is the pattern that keeps the migration from getting hacky, and it needs to
be built, because `@preact/signals` does not ship it (C4).

```ts
type Scope = { add(dispose: () => void): void; dispose(): void };
function createScope(): Scope;
function useScope(): Scope;  // disposes on unmount
```

Every store takes a scope and registers its teardown. Every subscription,
timer, `effect()` and socket lives on a scope. Nothing is torn down by
convention or by remembering to write a cleanup. This is what Solid gets from
`createRoot`/`onCleanup` and what a `@preact/signals` codebase has to supply for
itself.

Once scopes exist, cross-component connection sharing (§5.3) becomes expressible
with refcounting instead of being impossible.

### P5. `.peek()` at write sites, `.value` only at bind sites

The `{sig}` versus `{sig.value}` hazard is real and already documented. The
internal version of the same hazard is worse: a `.value` read inside a store's
own write path silently creates a dependency and can produce a loop. The rule is
mechanical and should be lint-enforced: **writers peek, binders read.** The spike
already follows it (`signals-spike.ts` peeks in the cell's `set`).

### P6. Keep transports imperative

Decoding a WS envelope, pumping an SSE stream, running an AbortController: none
of this becomes better as a reactive graph. Signals belong at the **fan-out**
boundary (one decoded message writes N per-entity signals), not in the decode or
transport path. Attempting to make the transport reactive is how these
migrations acquire their reputation for being clever and unmaintainable.

---

## 5. Modularity improvements

Asked for explicitly, and several are worth doing whether or not signals happen.

### 5.1 Extract a reactivity core package

Reactivity is currently smeared across `packages/iso` with three unrelated
hand-rolled mechanisms: `use-force-update.ts`, `use-store-snapshot.ts` (a
hand-rolled `useSyncExternalStore`), and per-hook `useState`. A
`@hono-preact/reactive` module (or `iso/src/reactive/`) should own: the scope
primitive (P4), the store conventions (P1), the keyed-collection helper (P2),
and the single decision about what reactive library is used underneath. Every
other subsystem then depends on that one seam rather than each inventing its
own.

This is also what makes the reactive library swappable, which matters given the
cost is 3 kB and the decision may be revisited.

### 5.2 Decompose `use-loader-runner.tsx`

577 lines, five jobs: phase state, reload orchestration (~150 lines, a
self-contained state machine), reader construction (~210 lines, five factories
in a decision tree), SSR preload/deny adoption bookkeeping, and view projection.
The five factories are nested closures capturing 6-8 outer refs, which is
precisely why none is independently testable.

P1 makes the decomposition natural rather than forced: the phase store and the
reload orchestrator become plain objects, and the reader factories take an
explicit deps object instead of closing over the hook's refs.

### 5.3 Realtime: one connection per room, not per hook

Two hooks pointed at the same room open two WebSockets today, each with its own
reconnect state machine (`ws-lifecycle.ts`, no pooling). The "shared connection"
is a server-side multiplexing of `/__sockets` by query param, not a client pool.
Refcounted connection sharing is currently inexpressible because lifetime is
`useEffect`-scoped; with P4 scopes it becomes straightforward.

### 5.4 UI package: take position out of the render path entirely

`use-position.ts:112` stores position in `useState` and `autoUpdate` writes it
per scroll frame. The fix is not signals. It is to write `transform` (or CSS
custom properties) to the floating element directly in the `autoUpdate`
callback and never re-render. That is strictly faster than any reactive
solution, removes a dependency question, and is a self-contained change.

More generally: **`packages/ui` should not take a signals dependency.** It ships
`@floating-ui/dom` as its only dependency and `preact` as its only peer. It is a
headless library consumed by apps that may never use signals, and
`useControllableState`'s public contract is plain values plus `onChange`
(`use-controllable-state.ts:3-7`), so internal adoption would be possible later
without any public change. There is no reason to spend the bytes or the coupling
now.

### 5.5 Collapse the duplicated mutation-overlay implementations

`useOptimistic` (internal ref queue) and `OptimisticOverlay` (caller-owned
`pending` array over `LoaderDataContext`) solve the same problem for different
targets with different ownership models. Under P3 both are
`computed(() => pending.reduce(reducer, base))` and the fold can be shared.

### 5.6 Two pre-existing DRY gaps worth closing while nearby

- `<Form>` reimplements `useAction`'s entire fetch/dispatch loop (AbortController
  set, `beginSubmit`/`endSubmit`, decode, `applyDecodedOutcome`, store write)
  rather than consuming it, because it needs FormData encoding and optimistic
  handles. A shared submit primitive parameterised by body encoding would remove
  the largest duplicated state machine in the codebase.
- The `DecodedEnvelope -> StoredActionResult` mapping is written twice by hand:
  six inline `setLastActionResult` calls in `form.tsx` and six branches of
  `recordOutcome` in `action.ts`.

Neither is a signals problem. Both are cheapest to fix while the area is already
open.

### 5.7 Give the phase/sync coherence invariant a type-level home

`resolveCurrentValue(phase, syncRef)` is only correct because the runner resets
`syncRef` on every reader rebuild. The ADT module cannot enforce that a phase and
a sync value are a coherent pair; the invariant lives entirely in the runner's
bookkeeping. If `phase` becomes a signal and `syncRef` stays a ref, a future code
path can desync them silently. They should become one value.

---

## 6. What I would not convert

- **`useAction`'s pending/error/data** (row 7). Component-local, no fan-out.
- **Head management** (row 11). Single-pass SSR collection.
- **SSR generally.** One pass, nothing to amortise. Signals only pay after
  hydration.
- **The cold-to-success first load.** Happens once per mount.
- **Error and deny routing.** Inherently whole-subtree; there is no field to bind.
- **Transport internals** (P6).
- **`packages/ui`** (§5.4).

---

## 7. The router question

This is the part that decides whether "signals-first" is achievable in the
strong sense, and it deserves to be stated plainly rather than buried.

`preact-iso` is not a routing detail; it is load-bearing in four places:
`Router`/`Route`/`LocationProvider` (navigation), `lazy()` (all code splitting),
`prerender` (the SSR entry), and its borrowed `_childDidSuspend` convention,
which is how client page guards hold the outgoing route alive while a middleware
chain resolves (`page-middleware-host.tsx:288-292,329`).

Consequences:

1. **Params cannot become fine-grained while `Router` is unmodified.** `Router`
   re-creates the matched child element per navigation, so the view function
   re-runs regardless. Any claim that navigation stops re-rendering under signals
   is false without replacing `Router`.
2. **Guards depend on throw-a-promise.** Signals have no suspension primitive. A
   signals-first navigation model would either keep Suspense for route gating
   (a mixed model) or reinvent "keep the old view until the new one is ready".
3. **View transitions detect navigation by hooking `options.debounceRendering`**
   (`route-change.ts:300-309`), that is, by observing that a Preact render flush
   happened. If signals make navigations stop causing flushes, this silently
   stops firing and view transitions break in a way that only visual QA catches.

The mixed model (signals for leaf data, Suspense and component re-render for
route transitions) is a perfectly respectable design. React Router, TanStack
Router and Remix all live there. It should be chosen deliberately and documented,
not arrived at by accident.

Replacing preact-iso is a separate program with its own justification, and it
should not be smuggled in as part of a reactivity change.

---

## 8. Cost

Measured (`scripts/spike-measure-signals-first.mjs`, repo probe methodology):

```
@preact/signals marginal over core                +3316 B gz
@preact/signals marginal over a data-heavy app    +3298 B gz  (+15.5%)
deletable hand-rolled bridges                      -328 B gz
net, unconditional                                ~+2970 B gz
```

Denominators: framework core 4,911 B gz; a realistic data-heavy framework bundle
21,303 B gz; the docs site's real always-loaded JS 22,541 B gz (18 chunks), so
about +14.6% there.

The fixed cost is why the interpretation in §1 matters. Paying 3 kB to make
presence and live data fine-grained is a good trade for a collaborative app and
a poor one for a content site. It is the same 3 kB either way.

---

## 9. Phasing

Ordered by payoff-to-risk, each phase independently shippable and independently
revertible.

- **Phase 0 (no behaviour change).** Extract the reactivity core (§5.1) with the
  scope primitive (P4). Decompose `use-loader-runner` (§5.2) using P1 while it
  still uses `useState`. This is pure modularity and is worth doing even if
  signals are rejected outright.
- **Phase 1 (highest payoff, lowest coupling).** Presence roster as keyed
  signals (P2). No SSR involvement, no hydration parity concern, self-contained
  in `use-room` + `ws-lifecycle`. Separately and independently: take position out
  of the render path (§5.4), which needs no signals at all.
- **Phase 2.** Loader read-side as a mirror (C1): `useDataSignal` /
  `useFieldSignal`. Single-value loaders first; streaming needs `status` moved
  into the store too, so it is a distinct follow-on.
- **Phase 3.** Optimistic queue and the action/form stores. Mechanical; verify
  the view-transition rAF choreography in `optimistic.ts:55-83` still holds,
  since it depends on `forceRender` being asynchronous and signals may flush
  differently.
- **Phase 4 (separate decision, possibly never).** Routing. §7.

Do not start Phase 2 before Phase 0. The loader runner is the most intricate code
in the framework and adding a reactive channel to it before decomposing it is how
this becomes unmaintainable.

---

## 10. Recommendation

Do Phase 0 regardless. It is the modularity work the codebase already wants,
it makes every later decision cheaper, and it commits to nothing.

Do Phase 1. Presence is a genuine O(N x M) problem with a clear fix, and the
positioning fix is strictly a win with no dependency cost.

Treat Phase 2 as the real decision point, informed by the 3 kB and by whether
the framework's intended users are building collaborative apps or content sites.
The evidence supports doing it; it does not compel it.

Do not adopt "signals-first" as an identity. The framework's re-render costs are
concentrated in four places, three of which are fixable without a framework-wide
migration, and the fourth is a router problem that signals cannot solve. A
targeted fix to those four, on top of a properly extracted reactivity core, gets
essentially all of the available performance win at a fraction of the risk.

## 11. Open questions

1. Does the C6 contradiction (avoiding global `options` patches, then adopting a
   library that installs six) change the answer, or is the original rationale
   simply narrower than it reads?
2. Is the mixed model of §7 acceptable as a stated, documented position?
3. Who are the framework's target users? This decides Phase 2 and nothing else
   in this document decides it for them.
