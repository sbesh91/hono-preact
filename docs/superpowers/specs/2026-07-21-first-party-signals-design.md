# First-party signals: opt-in fine-grained reactivity

Date: 2026-07-21
Status: Proposal, pending review. Compatibility spike complete (see §4).
Branch: `worktree-signals-spike`
Framework version at time of writing: v0.12.0
Milestone: **not v0.13** (that cut is Hardening & Ergonomics). Candidate for v0.14.

## 1. Problem

Every live data source the framework owns terminates in a `useState` or
`useForceUpdate` inside a framework hook:

| Source                    | Where the update lands                                    |
| ------------------------- | --------------------------------------------------------- |
| Loader data, stream chunks | `useState<LoaderPhase<T>>` (`use-loader-runner.tsx:85-86`) |
| Room roster + presence     | `useState` (`use-room.ts:147,151`)                         |
| Socket messages            | `useState` (`use-socket.ts:133`)                           |
| Optimistic queue           | `useForceUpdate` (`optimistic.ts`)                         |
| Form status, action result | `useStoreSnapshot` -> `useForceUpdate`                     |

Update granularity is therefore fixed at "the component that called the hook,
plus its subtree", and it is fixed **at the source**. That is the whole problem.
An app author can already `import { signal } from '@preact/signals'` today and it
works fine for their own state, but they cannot fix the rows above: by the time
`loader.View(({ data }) => ...)` hands a value to user code, the component
re-render has already happened. Copying that value into a signal downstream
recovers nothing.

Concretely: a live loader pushing a snapshot every second re-renders its entire
subtree; a cursor board re-renders on every presence heartbeat; a 500-row issue
list re-renders 500 rows when one field on one row changes.

This is the property Linear's write-up describes as "a 50-issue update produces
50 cell re-renders, not a full list re-render". It is reachable here only if the
framework's own sources emit signals.

## 2. Goals / non-goals

**Goals**

- Sub-component update granularity for framework-owned reactive sources.
- **Zero bytes** for apps that do not opt in. This is the binding constraint; the
  framework's positioning rests on a 4,911 B gz core.
- Additive API. `loader.View`, `useRoom`, `useSocket` keep their current shapes
  and current types.
- No change to SSR output or to the hydration contract.

**Non-goals**

- Replacing the existing state model. The `LoaderState` / `StreamState` ADTs and
  the structural value-presence rules stay exactly as they are.
- A local-first store, an IndexedDB sync engine, or an offline queue. Signals is
  the rendering half of that story, not the data half. Out of scope here.
- Making signals the default spelling in docs or the scaffolder.

## 3. Non-negotiable constraint: no polyfills, current ESM only

`build.target` stays `'esnext'` (`packages/vite/src/hono-preact.ts:141`). Nothing
in this design adds a downlevel path, a legacy plugin, or a shim. `@preact/signals`
ships modern ESM and is consumed as-is.

## 4. What the spike established

A compatibility spike ran on this branch before any design work. Full detail in
§10; the load-bearing results:

**Compatible.** `@preact/signals` 2.9.4 installs six `options` hooks (`__b`,
`__r`, `__e`, `diffed`, `unmount`, `__h`) through a binder that captures and
calls the previous handler. The pinned `preact-iso` patches `__b` and `__e` and
likewise chains. They overlap on two hooks and coexist in **both import orders**.
The full framework suite passes with signals in the module graph (412 files,
3,151 tests).

**Granularity is real.** `{signal}` in JSX patches the DOM with zero component
re-invocations. `{signal.value}` re-renders normally. Verified through the real
`renderPage` streaming document, not just in isolation.

**SSR and hydration are clean.** Signals render to string; hydration **adopts**
the SSR text node rather than replacing it (asserted by node identity, not by
text comparison). The baked `data-loader` preload is still adopted with no
client refetch when a signal is in the same tree.

**Deferability is proven, and it is what makes this design possible.**
Dynamically importing `@preact/signals` *after* the app has booted and rendered
still installs the hooks correctly and still yields full granularity for
components rendered afterwards. The adapter does **not** have to sit in the entry
closure.

**Cost, measured with the repo's own probe methodology** (isolated esbuild
bundle, peers external, minified, gzip; `scripts/spike-measure-signals.mjs`):

```
framework core (baseline)      4911 B gz
core + @preact/signals         8227 B gz   -> +3316 B gz (+68% on core)
@preact/signals alone          3512 B gz
@preact/signals-core alone     2005 B gz
```

The core figure agrees exactly with `node scripts/measure-framework-size.mjs`
(`sectionA.core.total`), which is the check that the spike probe has not drifted
from the authoritative one. It must keep agreeing: the probe only matches because
it carries the same production `define`, without which it over-reports.

The last row is a trap worth stating explicitly: `signals-core` is the cheap
half but contains no Preact adapter, so it delivers **none** of the granularity.
There is no 2 kB version of this win.

## 5. The central design problem

Granularity requires the **source** to write to a signal instead of calling
`setState`. If `use-loader-runner.tsx` imports `@preact/signals-core` directly to
hold that signal, every app pays 2,005 B gz whether or not it opts in. That
violates the binding constraint in §2.

Three ways out:

**(A) Core depends on `signals-core`; the opt-in module adds the adapter.**
Simple, but every app pays 2.0 kB for machinery most will not use. Rejected on
the §2 constraint.

**(B) A pluggable reactive cell.** The runner writes through a tiny interface
whose default implementation is the current `useState` path. The opt-in module
registers a signal-backed implementation at boot. Cost when unused is one
indirection and a few hundred bytes; cost when used is the full 3,316 B.

**(C) Build-time selection.** `defineApp({ signals: true })` makes the Vite
plugin alias the cell module to the signal-backed implementation. Zero runtime
indirection and zero bytes when off, at the price of build coupling and a second
code path that CI must exercise in both configurations.

**Recommendation: (B).** It keeps one runtime code path, needs no build
involvement, and the indirection is a property read on a hot-but-not-tight path.
(C) is a later optimization if the indirection ever measures. (B) also degrades
honestly: if the opt-in module is never imported, the registry is never
populated and behavior is bit-identical to today.

The registration ordering requirement is real but mild, and the spike covers it:
late install works, so `boot-client` can register the signal-backed cell before
the first route mounts without needing it in the entry closure.

## 6. Proposed surface

A new subpath export, `hono-preact/signals`. Importing it is what pulls in the
adapter; nothing in core references it.

```ts
import { signal, computed, effect } from 'hono-preact/signals';
```

It re-exports the `@preact/signals` primitives (so apps do not add a second
direct dependency and cannot drift onto a mismatched version) plus the framework
accessors:

```ts
// Loader data as a signal. Additive; `.View` and `.useData()` are unchanged.
const state = serverLoaders.default.useDataSignal();
// ReadonlySignal<LoaderState<T>>

// A projection, so a row binds to one field and nothing else.
const title = serverLoaders.default.useFieldSignal((d) => d.title);

// Rooms: the roster as a signal instead of a re-rendering array.
const { members } = useRoom(ref, { key, signals: true });
// members: ReadonlySignal<Member[]>

// Sockets: last message as a signal.
const { last } = useSocket(ref, { signals: true });
```

Notes on shape:

- `useDataSignal()` returns a signal **of the existing `LoaderState` union**, not
  a bag of loose fields. The ADT is the framework's value-presence contract and
  must not be bypassed (see the loader-state ADT rules: presence is structural,
  never `data === undefined`).
- `useFieldSignal(selector)` is the row-level ergonomic. It is the one that
  actually delivers the Linear property, because it lets a cell bind to a leaf.
- Rooms and sockets take a `signals: true` option rather than a parallel hook, so
  there is one hook per concept and the signal-ness is a flag on it.

**The documentation hazard.** `{title}` and `{title.value}` look nearly identical
and have opposite performance characteristics. Every example in the signals docs
page must use the bare-signal spelling and call out the `.value` footgun
explicitly. This is a real ergonomic cost of the feature and should be weighed,
not glossed.

## 7. What this does not change

- SSR output is byte-identical for apps that do not opt in.
- The baked `data-loader` preload handoff and the one-time hydration adoption in
  `preload.ts` / `loader.tsx` are untouched.
- `__HP_STREAM__` bootstrap and chunk-script wire format are untouched.
- No new dependency for apps that do not import `hono-preact/signals`.

## 8. Risks and open questions

1. **Two ways to read the same data.** `.View`/`useData` and `useDataSignal`
   coexist forever. That is a real API-surface cost. Mitigation: docs present
   `.View` as the default and signals as the opt-in for dense live UI, never as
   an upgrade path.
2. **The `.value` footgun** (§6). No mitigation beyond documentation.
3. **Optimistic overlay interaction is unexplored.** `useOptimistic` layers a
   pending queue over a base value. How that composes with a signal-backed base
   is not designed here and not spiked. **Open.**
4. **Devtools.** Preact devtools shows signal updates differently from state
   updates; a signal-driven DOM patch has no component in the profiler. Worth a
   note in docs.
5. **Version coupling.** Re-exporting `@preact/signals` means the framework pins
   its version. Adds a lockstep obligation to the release policy.
6. **No real-browser verification yet.** Everything in §4 is Node-side
   simulation. A real-browser pass belongs in the implementation PR, not here.

## 9. Test plan

- Unit: granularity assertions must be **mutation-checked**. A test asserting
  "zero re-renders" is vacuous unless swapping `{sig}` to `{sig.value}` fails it.
  The spike demonstrates the technique (§10).
- SSR + hydrate through real `renderPage`, both non-streaming (baked preload) and
  streaming (`__HP_STREAM__`).
- **Streaming-SSR tests must run in the `node` vitest environment.** `cache.ts`
  decides at module load whether to init `AsyncLocalStorage` by sniffing real
  `window`/`document`; under `happy-dom` the request-scoped streaming registry is
  inert and `renderPage` silently returns a single-shot response. Setting
  `env.current = 'server'` does not fix it.
- Bundle: extend `scripts/size-probe-config.mjs` with a `signals` feature row so
  the PR-only `client-size` job reports its marginal cost, and add an assertion
  that core is unchanged when the module is not imported.
- Both import orders, since the `options` binder captures whatever is installed
  at import time.

## 10. Spike appendix

The spike artifacts ship with this PR so the evidence is reviewable and
re-runnable. **They are throwaway.** They test a third-party library's
interaction with the framework, not framework behavior, and they carry the only
reason `@preact/signals` / `@preact/signals-core` appear in the root
`devDependencies`. Delete all six files, `scripts/spike-measure-signals.mjs`, and
both devDependencies when the implementation lands (or sooner, if this proposal
is rejected). No shipping code imports them: the only importers under
`packages/` are the four spike test files themselves, all under `__tests__/`.

Reproduce from this branch:

```
pnpm exec vitest run packages/iso/src/internal/__tests__/signals-spike
pnpm exec vitest run packages/server/src/__tests__/signals-spike
node scripts/spike-measure-signals.mjs
```

| File                                                    | Covers                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `iso/.../signals-spike.test.tsx`                         | options chain, granularity + `.value` contrast, suspense, streaming loader, SSR->hydrate node adoption |
| `iso/.../signals-spike-order.test.tsx`                   | reverse import order                                                  |
| `iso/.../signals-spike-control.test.tsx`                 | same assertions with signals absent (the control)                     |
| `iso/.../signals-spike-lazy-install.test.tsx`            | deferred install after boot, the §5 enabler                           |
| `server/.../signals-spike-ssr-integration.test.tsx`      | real `renderPage` + baked `data-loader`, no client refetch            |
| `server/.../signals-spike-stream-integration.test.tsx`   | real streaming document, inline scripts, `installStreamRegistry`, hydrate |

Two findings incidental to signals, recorded because they will resurface:

- **`preact-iso`'s `ErrorBoundary` does not catch plain errors.** Its
  `options.__e` intercepts thenables only (`err.then`); a plain throw falls
  through to the previous handler. A suspend with no boundary ancestor escapes as
  `Unknown Error: Promise`. True with and without signals; confirmed by control.
- **Streaming SSR is untestable under `happy-dom`**, per §9.

## 11. Recommendation

Proceed, as an opt-in marginal module using approach (B), targeted at v0.14.

The case rests on one argument: the reactive sources are framework-owned, so
this granularity is unreachable from userland no matter what an app author does.
Everything else about the feature is a cost. The payoff is concentrated in
realtime, rooms, and live-loader-heavy applications; it is worth approximately
nothing for content sites, which is precisely why it must not be in core.

Before implementation, resolve open question §8.3 (optimistic overlay), since it
is the one place the design could still need to change shape.
