# v0.14 Track B design: loader-state ergonomics, NavLink prefetch, emitted client assets

Covers issues #371, #372, #373, #374, #376. Issue #375 is resolved by
measurement rather than by code; see "Resolved by measurement" below.

Ships as two PRs, mirroring the Track A batch 1 / batch 2 split:

- **PR 1 (iso / core):** #371, #372, #373, #374
- **PR 2 (vite):** #376

Two breaking changes land in PR 1 (#372 and #373). Both are pre-1.0 type-level
replacements with no deprecation window, consistent with the ten breaking type
changes v0.13 shipped.

---

## Resolved by measurement: #375

#375 asked whether the Cloudflare adapter should stop emitting the realtime
Durable Object stack into workers that use no rooms or sockets. The issue set
its own gate: "Measured payoff: how many gzip KB the gate actually saves off
the worker. If it is small, the migration hazard may not be worth buying."

Measured with a production Vite SSR bundle, peers external, gzipped, taking the
marginal over the real core-app graph (`createServerEntry` from
`hono-preact/server/internal/runtime`, which is what the generated worker entry
imports):

| Bundle | gzip |
| --- | --- |
| coreApp graph (base) | 27,381 B |
| base + realtime tail | 29,977 B |
| **Marginal cost of the realtime tail** | **2,596 B (2.54 KB)** |

2.54 KB is about 0.25% of the free-tier 1 MB compressed worker limit. That does
not buy the hazard the issue itself identifies: removing an exported Durable
Object class from an already-deployed worker requires a `deleted_classes`
migration, and any automatic gate breaks the migration chain of a deployed app
the moment its last room is deleted. An explicit `cloudflareAdapter({ realtime:
false })` opt-out avoids the hazard but adds public API surface for a 2.5 KB
saving.

**Decision: close #375 as wontfix**, recording the measurement.

The measurement did surface a real finding worth its own issue.
`packages/server/src/create-server-entry.ts` statically imports
`buildRoomRegistry`, `buildSocketRegistry`, and `socketsHandler`. The rooms and
sockets registry machinery therefore ships in **every** worker through the core
app, independent of what any adapter emits, and the 27.4 KB base above already
contains it. Gating the adapter tail cannot reach those bytes. **Open a new
issue** for that, scoped to the core app rather than the adapter.

An intermediate probe that measured the tail in isolation reported 3.08 KB. That
number double-counts bytes the core app already carries and should not be cited;
2.54 KB is the marginal figure.

---

## #371: `match()` for status-first loader narrowing

### Problem

`data ? X : Loading` treats a legitimately falsy resolved value (`0`, `''`, `[]`)
as "still loading". The loader-state ADT was built so value presence is carried
structurally by `status`, but nothing stops a consumer from reaching for `data`
first.

### Design

A plain function (not a hook) in `packages/iso/src/loader-state.ts`, alongside
`hasPhaseValue` and `isLoaderState`, exported from the iso public surface:

```ts
export function match<S extends { status: string }, R>(
  state: S,
  handlers: { [K in S['status']]: (state: Extract<S, { status: K }>) => R }
): R;
```

One generic implementation serves both `LoaderState` and `StreamState` because
both discriminate on the same `status` key. The handler map is derived from the
state's own status union, so:

- a caller cannot reach a `data` branch without the type system having narrowed
  `status` first, which is the whole point of the issue;
- a missing arm is a compile error;
- the streaming arms (`connecting`, `open`, `reconnecting`, `closed`, `error`)
  come along free, answering the issue's third design question. No separate
  streaming helper is needed.

`Extract<S, { status: K }>` gives each handler the fully narrowed member, so the
`success` handler receives `{ status: 'success'; data: T }` and reads `data`
without a guard, while the `loading` handler cannot read `data` at all
(`data?: never`).

A second overload keeps the five-arm streaming case from being verbose, allowing
a partial handler map when a catch-all is supplied:

```ts
export function match<S extends { status: string }, R>(
  state: S,
  handlers: Partial<{ [K in S['status']]: (state: Extract<S, { status: K }>) => R }> & {
    _: (state: S) => R;
  }
): R;
```

Exhaustive-without-`_` remains the default and the documented form; `_` is the
escape hatch, not the habit.

This composes with rather than competes against the existing ADT: it narrows on
the same `status` discriminant the docs already teach, and adds no new vocabulary.
Direct `switch (state.status)` stays fully supported and is not deprecated.

### Naming

The bare name `match` is what #371 specifies, but iso already has an internal
`matchPath` and `NavLink` has a `match` prop taking a `RoutePattern`, so an
exported `match` invites a route-matching reading. `matchState` is unambiguous at
the import site. **Recommendation: ship `match`** as the issue specifies, since
its first argument is a loader state and the call site reads unambiguously; flag
for review.

### Out of scope

The ADT's own shape is unchanged, per the issue.

---

## #372: split `invalidate`'s tri-mode

### Problem

`InvalidateInput = 'auto' | false | ReadonlyArray<AnyLoaderRef>` overloads one
parameter with two independent decisions: which loader caches to clear, and
whether to re-run the active page's loader. The app's own demo needed a
five-line comment per call site to explain which arm did what.

Current behaviour in `packages/iso/src/use-invalidate.ts`:

| Value | Effect |
| --- | --- |
| `'auto'` | Re-run the active page's loader. Clears nothing. |
| `LoaderRef[]` | Call `.invalidate()` on each ref. Also re-run the active loader if it appears in the list. |
| `false` / `undefined` | Nothing. |

### Design

Breaking replacement. One options object with two named, orthogonal fields:

```ts
export type InvalidateInput = {
  /** Loader caches to clear. Each ref's `.invalidate()` is called. */
  clear?: ReadonlyArray<AnyLoaderRef>;
  /**
   * Re-run the active page's loader. Defaults to true when the active loader
   * appears in `clear`, false otherwise, which preserves today's behaviour.
   * Set explicitly to override.
   */
  refetchActive?: boolean;
};
```

Every current call site has a direct, comment-free replacement:

| Today | Replacement |
| --- | --- |
| `invalidate: 'auto'` | `invalidate: { refetchActive: true }` |
| `invalidate: [a, b]` | `invalidate: { clear: [a, b] }` |
| `invalidate: false` | omit `invalidate` |

The `refetchActive` default is what preserves parity: an array containing the
active loader refetches it today, and continues to. Making the default implicit
rather than requiring the field keeps the common case a single key.

Consumers: the `invalidate` option on `useAction`
(`packages/iso/src/action.ts`), the `invalidate` prop on `<Form>`
(`packages/iso/src/form.tsx`), and the shared apply function
(`packages/iso/src/use-invalidate.ts`).

### `MutateResult` interaction

The `navigated` arm invalidates declared loaders through the existing tri-mode
call. That path must be re-expressed in the new shape and must cover the same
cases; a test asserting the `navigated` arm still invalidates its declared
loaders is a required part of this change, not an optional extra.

### Out of scope

Cache-key semantics (`cacheKeyParams`) are untouched, per the issue. This is
purely the shape of the parameter.

---

## #373: two-parameter `View` render signature

### Reproduction result

The issue required reproducing two claims before redesigning. Both were checked
against current source with mutation-checked type tests.

**The `Acc` inference claim does NOT reproduce. That half of the issue closes.**
Calling the accumulating `.View()` with `initial` and `reduce` and no explicit
type argument infers `Acc` correctly:

```ts
live.View(
  (args) => { if (args.status === 'open') { const d: number[] = args.data; } return null; },
  { initial: [] as number[], reduce: (acc, chunk) => [...acc, chunk.n] }
);
```

`args.data` is `number[]` on the `open` arm. Asserting `string[]` instead fails
with `Type 'number[]' is not assignable to type 'string[]'`, which confirms the
file was genuinely typechecked rather than silently skipped. (Note for anyone
re-running this: `.test-d.ts` files are excluded from `tsconfig.test.json` and
only run under `pnpm test:types`, so a repro written as `.test-d.ts` and checked
with `tsc -p tsconfig.test.json` passes vacuously.)

**The namespace collision DOES reproduce, in two distinct flavours**, both worse
than the issue describes:

1. A caller prop named `data` silently becomes the nonsense intersection
   `number[] & string`. No error, no indication which side won.
2. A caller prop named `status` collapses the **entire** render argument to
   `never`, because the intersection distributes across the state union and
   `'loading' & 'busy'` is `never`. The author sees
   `Property 'status' does not exist on type 'never'` with nothing pointing at
   the real cause.

### Design

Replace the flattened intersection with a two-parameter signature, in
`packages/iso/src/define-loader.ts`:

```ts
type AccumulatingView<T> = <Acc, P extends Record<string, unknown> = {}>(
  render: (state: StreamState<Acc>, props: P) => ComponentChildren,
  opts: {
    initial: Acc;
    reduce: (acc: Acc, chunk: Serialize<T>) => Acc;
    errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren);
  }
) => FunctionComponent<P>;

type SingleValueView<T> = <P extends Record<string, unknown> = {}>(
  render: (state: LoaderState<Serialize<T>>, props: P) => ComponentChildren,
  opts?: {
    errorFallback?: ComponentChildren | ((err: Error, reset: () => void) => ComponentChildren);
  }
) => FunctionComponent<P>;
```

`state` is always the discriminated union and can collide with nothing; `props`
is whatever `P` the caller supplies. No key can alias into the stream state, and
the `never` collapse becomes structurally impossible.

Breaking for any caller destructuring the flattened argument. All call sites in
`apps/site` and every docs example using the render-prop form must be updated in
the same PR.

`Acc` inference is unaffected: it still infers from `initial` and `reduce` in the
options object, which the signature change does not touch.

### Out of scope

`StreamState`'s shape and the `reduce` contract are unchanged, per the issue.

---

## #374: `NavLink` prefetch integration

### Design

Additive props on `NavLinkProps` in `packages/iso/src/nav-link.tsx`:

```ts
/** Prefetch trigger for `prefetchLoaders`. Default: no prefetching. */
prefetch?: 'hover' | 'visible' | false;
/** Loaders to prefetch for this link's target route. */
prefetchLoaders?: AnyLoaderRef | ReadonlyArray<AnyLoaderRef>;
```

A strategy prop rather than a boolean, so `'visible'` needs no second prop and no
breaking widening later. `'hover'` is the intended common case; there is no
framework-wide default trigger, so a link's behaviour stays readable at its call
site.

Implementation wraps the existing `usePrefetch(href, refs)` unchanged:

- `'hover'`: hover-intent on `pointerenter` with a debounce, cancelled on
  `pointerleave` before the delay elapses. Also bind `focus` so keyboard
  navigation gets the same warming.
- `'visible'`: an `IntersectionObserver` on the anchor, firing once when it
  enters the viewport, then disconnecting.

Both are strictly additive to `activeClass`, `inactiveClass`, `match`, `exact`,
and `transition`; none of that behaviour changes. The existing `onClick`
composition and `willSoftNavigate` gate are untouched.

### Why loaders are explicit rather than auto-resolved

Auto-resolving "every loader for this route" from the href alone would be better
DX, and was evaluated. It is not reachable within this issue's scope. The
client-side `serverLoaders` stub
(`loaderStubSource` in `packages/vite/src/stub-templates.ts`) is a `Proxy` over
an empty target carrying only a `get` trap and no `ownKeys` trap, so its loader
names are not enumerable on the client. `Object.keys()` on it returns `[]`.
Auto-resolution would require the Vite plugin to newly expose the statically
mined loader-name list (`loadersMeta`) to the client runtime, which is new
build-pipeline machinery well beyond "a convenience integration over the existing
hook". If wanted, that is a separate issue.

### Connection-aware signals

Not gated on `prefers-reduced-data` or the Network Information API. Prefetching
here is opt-in per link and per trigger, and `'visible'` is the only trigger that
could fire without user intent. The framework's baseline rule scopes to
primitives, and Network Information API support is not broad enough to build
behaviour on. Revisit if `'visible'` proves costly in practice.

### Out of scope

`usePrefetch`'s own contract is unchanged, per the issue.

---

## #376: `emitClientAsset` via `honoPreact({ assets })`

### Problem

There is no framework-supported way to say "emit this generated file into the
client build output and serve the same bytes in dev". Every app hand-rolls a
`generateBundle`/`emitFile` half plus a `configureServer` middleware half and
keeps them in sync by hand. `apps/site/vite.config.ts` does exactly this for
`llms.txt` and `llms-full.txt`, so the framework is dogfooding a gap in its own
plugin surface.

### API shape

An option on the existing framework plugin rather than a standalone plugin
factory:

```ts
honoPreact({
  adapter: cloudflareAdapter(),
  css: { global: 'src/styles/root.css' },
  assets: {
    'llms.txt': () => generateLlmsFiles(nav, docsDir).llmsTxt,
    'llms-full.txt': async () => (await buildCorpus()).text,
  },
});
```

A record of output file name to a thunk returning `string | Uint8Array`, or a
promise of either. The file name is relative to the client output directory, so
`'llms.txt'` serves at `/llms.txt`.

### Evaluation timing

The two halves deliberately differ, and the difference is the point:

- **Build:** each thunk is called exactly once, during the client environment's
  bundle generation, and its result is emitted via `emitFile`. Never per-request.
- **Dev:** each thunk is called per request. Regenerating on every hit is what
  makes an edit show up without a dev-server restart, which is the behaviour the
  site's hand-rolled version approximates today with a manual cache plus a
  watcher invalidation. Per-request evaluation removes the need for that
  bookkeeping entirely.

Thunks may be async; both halves await.

### Dev serving details

- Content type is derived from the file extension, defaulting to
  `application/octet-stream` for unknown extensions. `.txt` maps to
  `text/plain; charset=utf-8`, matching what the site sets by hand today.
- **Middleware ordering is the known hazard.** `node-dev-server.ts` already
  documents that registering in the returned post hook lands after
  `spaFallbackMiddleware` and 404s. The asset middleware must therefore be
  registered in the pre-hook position, ahead of both the SSR middleware and
  Vite's own fallbacks, so a requested asset path is never swallowed by the
  catch-all route. A test asserting a dev request for an emitted asset returns
  the thunk's bytes and not the SSR not-found page is required.

### Adapter parity

Cloudflare serves client output through the ASSETS binding; Node serves it via
`serveStatic`. A plain file emitted into the client output directory is served
identically by both, and the site already proves the Cloudflare half in
production for `llms.txt`. Both paths get a test.

Root-level paths such as `/sw.js` are the case #340 (PWA) is gated on. The
design supports them: a file name with no directory component emits at the client
output root and serves from `/`. No adapter-specific handling is introduced here,
and confirming root emission is what unblocks #340.

### Dogfood requirement

The change is not done until `apps/site/vite.config.ts` drops its hand-rolled
`emit-llms-txt` plugin (the `closeBundle` half, the `configureServer` half, the
manual cache, and the watcher invalidation) and uses `assets` instead. If the
helper cannot express what the site already does, the design is wrong and comes
back here.

Note the site's current build half uses `closeBundle` with a manual
`writeFileSync` into `dist/client`, guarded on `this.environment.name ===
'client'`. The framework version uses `emitFile` in the client environment
instead, which is the correct Rollup-native path and does not need the manual
`mkdirSync`.

---

## Testing

Per repo convention, tests target the caller rather than the pure function, and
every regression test is mutation-checked.

**PR 1 (iso):**

- `match()`: type-level tests that an exhaustive map compiles, a missing arm does
  not, each handler receives its narrowed member, and the `loading` handler
  cannot read `data`. Runtime tests that dispatch reaches the right handler for
  both `LoaderState` and `StreamState`, and that the `_` overload catches
  unlisted arms.
- `invalidate`: behavioural parity tests for all three replacement spellings
  through `useAction` and `<Form>`, plus the `MutateResult` `navigated` arm
  invalidating its declared loaders.
- `View` signature: type tests that a caller prop named `data` or `status` no
  longer collides, using the exact two reproductions above as regression cases,
  written as plain checked `.ts` (not `.test-d.ts`, per the exclusion noted
  earlier) or as `.test-d.ts` run under `pnpm test:types`.
- `NavLink` prefetch: hover debounce fires once after the delay, cancels on early
  leave, focus triggers it, `'visible'` fires once on intersection and
  disconnects, and none of the existing active-class or transition behaviour
  changes.

**PR 2 (vite):**

- Build half emits the file into the client output at the right path with the
  thunk's bytes, and calls each thunk exactly once.
- Dev half serves the file with the right content type, calls the thunk per
  request (two requests, two calls), and is not swallowed by the SSR catch-all.
- Async thunks work in both halves.
- The site build still produces `/llms.txt` and `/llms-full.txt` after the
  dogfood swap.

The page-render smoke suite (`pnpm test:smoke`, `run-smoke` label) is required
before merge for PR 2, since it changes dev-server middleware ordering and build
output, which is exactly the module-graph and build-pipeline class of fault unit
tests cannot reproduce.

---

## Docs

- `match()` becomes the documented default for consuming loader state, with the
  falsy-value trap explained. Existing `switch (status)` examples stay valid.
- The `invalidate` change touches every documented call site.
- The `View` render-prop signature change touches every docs example using the
  render-prop form.
- `NavLink` prefetch is documented alongside the existing active-link docs
  (`apps/site/src/pages/docs/active-links.mdx`) and cross-referenced from
  `link-prefetch.mdx`.
- `assets` is documented on the `honoPreact()` options reference.
- Per repo convention, docs describe what is, with no migration breadcrumbs.
  Breaking changes are recorded in the release notes, not in prose next to the
  API.

Docs coverage gates are opt-in: only types named in a docs code span are checked,
and naming a type opts in all its members. Naming `InvalidateInput` or
`NavLinkProps` in a span therefore commits to documenting every member.

---

## Issue outcomes

| Issue | Outcome |
| --- | --- |
| #371 | Implemented in PR 1 |
| #372 | Implemented in PR 1, breaking |
| #373 | Collision half implemented in PR 1, breaking. `Acc` inference half closed as not reproducing. |
| #374 | Implemented in PR 1 |
| #375 | Closed wontfix on the 2.54 KB measurement. New issue filed for the core-app registry imports. |
| #376 | Implemented in PR 2 |
