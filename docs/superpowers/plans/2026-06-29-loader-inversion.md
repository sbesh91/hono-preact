# Loader Inversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bare `defineLoader` the route-independent loader and `serverRoute` the only route-binding machinery, folding streaming (the dissolved `defineStream`) back into the loader model so there are three RPC shapes (loaders / sockets+rooms / actions).

**Architecture:** Route-binding is composition (`serverRoute(r).loader` vs bare `defineLoader`); streaming is inferred from the body (async generator vs `Promise<T>`); SSR-vs-client-only for streams is the explicit `{ live }` flag. One server engine (`loadersHandler` on `/__loaders`) branches on a runtime route marker stamped by `serverRoute`. Consumption is unified under `.View`/`useData`, usable outside the router.

**Tech Stack:** TypeScript, Preact, Hono, Vite (Babel AST transforms), Vitest, pnpm workspace monorepo.

**Design spec:** `docs/superpowers/specs/2026-06-29-loader-inversion-design.md`
**Spike findings:** recorded in `.superpowers/sdd/progress.md` (route-independent `.View` is a bounded change; the only blocker is `LoaderHost`'s no-location throw; SSR run-vs-skip re-keys from `accumulate` onto `live`; the runner/Mechanism-B/pump/cache are router-independent and tolerate empty location).

## Global Constraints

- **Three RPC shapes only:** loaders (route-bound via `serverRoute`, or standalone via `defineLoader`), sockets+rooms, actions. No `serverStreams`, no `/__streams`.
- **Auth is a definition property, never a call-site one.** A route-bound loader resolves its page-tier `use` from its OWN declared route (the runtime route marker), and is rejected if its declared route does not resolve — never run through a guard-less chain (the #178 lesson). Route-independent loaders compose `[app, unit]` only.
- **`live` is read only by the SSR host** to skip pumping the generator (client-only). Default `false`. It is not a wire concern.
- **Streaming ⟺ async-generator body.** The public `ReadableStream`-return streaming form is dropped (a generator can `yield*` an adapted stream internally).
- **Clean break, pre-1.0, no deprecation shims.** Migrate the codebase's route-coupled loaders to `serverRoute` in the same task that lands the breaking ctx change.
- **No em-dashes** in code, comments, or commit messages (project rule).
- **Pre-push CI (run in order before any push):** `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`, `pnpm gen:agents-corpus`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:types`, `pnpm test:coverage` (or `pnpm test`), `pnpm test:integration`, `pnpm --filter site build`. If `format:check` fails, run `pnpm format`.
- **Test command:** the iso/server/vite packages have NO per-package `test` script. Run focused tests with `npx vitest run <pattern>` from the worktree root; typecheck a package with `pnpm --filter @hono-preact/<pkg> exec tsc --noEmit`. The iso/server tsconfigs EXCLUDE `src/**/__tests__/**`, so type-annotation nits in test files are not CI-checked.
- **Commit trailer:** end each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Git hygiene:** work only on branch `worktree-feat-defineStream-127`; never create branches / checkout / reset / rebase / amend. Verify `git branch --show-current` before each commit and that your commit is HEAD after.

## File Structure

**Deleted (Task 1, dissolving #127):** `packages/iso/src/define-stream.ts`,
`packages/iso/src/use-event-stream.ts`, `packages/iso/src/internal/sse-subscription.ts`,
`packages/server/src/streams-handler.ts`, `packages/server/src/__tests__/streams-handler.test.ts`,
`packages/iso/src/__tests__/define-stream*.ts*`,
`packages/iso/src/__tests__/use-event-stream.test.tsx`,
`packages/iso/src/internal/__tests__/sse-subscription.test.ts`,
`apps/site/src/components/demo/activity.server.ts`,
`apps/site/src/pages/docs/event-streams.mdx`. The `serverStreams` codegen, `STREAMS_RPC_PATH`/`FORM_STREAM_FIELD`, and `/__streams` registration revert with the range.

**Retained from #127:** `packages/iso/src/internal/sse-events.ts` (lifted SSE classification, still shared by the loader path) and its test — keep these, re-derive if the revert removes them.

**Modified (the inversion):**
- `packages/iso/src/define-loader.ts` — route-independent ctx + opts; streaming discriminant from return type; `{ live }`; drop route-form + params/schemas.
- `packages/iso/src/server-route.ts` — `.loader` accepts `{ live }`; remove `.liveLoader`; add `liveStream` export; stamp the runtime route marker.
- `packages/iso/src/internal/loader.tsx` — `LoaderHost` no-location tolerance (route marker), `DataReader` SSR-skip re-keyed on `live`.
- `packages/iso/src/internal/loader-runner.ts` / `use-loader-runner.tsx` — tolerate empty location; cache-key by module::name for route-independent.
- `packages/server/src/loaders-handler.ts` — chain composition from the unit's route marker.
- `packages/vite/src/module-key-plugin.ts` — thread the runtime route marker for `serverRoute(...)` calls.
- `apps/site/src/**/*.server.ts` — migrate route-coupled loaders to `serverRoute`; convert the activity bar to a route-independent `defineLoader`.
- `apps/site/src/pages/docs/loaders.mdx` — document the inversion.

---

### Task 1: Dissolve the #127 `defineStream` surface (revert to the loader baseline)

**Files:** revert the #127 implementation across iso/server/vite/site (see File Structure). Keep `docs/superpowers/specs/*` and `docs/superpowers/plans/*` (the inversion design + this plan). Keep `internal/sse-events.ts`.

**Interfaces:**
- Produces: a branch whose loader surface equals the pre-#127 baseline (origin/main `83555bc`) plus the design docs. `defineStream`/`useEventStream`/`serverStreams`/`/__streams`/`streamsHandler` no longer exist.

- [ ] **Step 1: Identify the #127 implementation commit range**

Run: `git log --oneline 83555bc..HEAD | rg -v "docs\(spec\)|docs\(plan\)"`
Expected: the implementation commits `cbd3726`(contract) through `b6c0503`(demo), plus `fc101a2`(event-streams docs), `57428d0`(cleanup), `426e217`(docs fix). The two design-doc commits (`646c73d` spec / `28b9b11` plan for #127, `48e6b06` inversion spec) are NOT reverted.

- [ ] **Step 2: Revert the implementation, keeping `sse-events.ts` and the design docs**

The cleanest path is a single revert commit of the implementation tree changes. Because `sse-events.ts` (Task 3 of #127) must be KEPT, do not blanket-revert it.

```bash
# Restore the iso/server/vite/site source trees to the baseline, then re-keep sse-events.
git checkout 83555bc -- packages/iso/src packages/server/src packages/vite/src apps/site/src
git checkout HEAD -- packages/iso/src/internal/sse-events.ts packages/iso/src/internal/__tests__/sse-events.test.ts
# loader-fetch.ts must still import from sse-events (the Task-3 refactor); re-apply that one import if the checkout reverted it.
```

Then delete the now-orphaned event-streams doc and its exports-coverage allowlist entries (if the baseline checkout did not remove them):

```bash
rm -f apps/site/src/pages/docs/event-streams.mdx
```

- [ ] **Step 3: Verify `loader-fetch.ts` still consumes `sse-events`**

Run: `rg -n "classifySseEvent|from './sse-events" packages/iso/src/internal/loader-fetch.ts`
Expected: it imports `classifySseEvent` and `SSEMessage` from `./sse-events.js` (the kept refactor). If the checkout reverted `loader-fetch.ts` to the inline `classifyLoaderEvent`, re-apply the import + call-site change so the baseline + the kept `sse-events.ts` are consistent.

- [ ] **Step 4: Confirm the stream surface is gone**

Run: `rg -n "defineStream|useEventStream|serverStreams|STREAMS_RPC_PATH|streamsHandler" packages/ apps/ || echo CLEAN`
Expected: `CLEAN` (no references), except any inside `docs/superpowers/specs` (allowed).

- [ ] **Step 5: Run the full suite + typecheck (back to baseline green)**

Run: `npx vitest run packages 2>&1 | rg "Test Files|Tests "` then `pnpm gen:agents-corpus && pnpm typecheck`
Expected: all green (the baseline loader suite + the kept sse-events test). `gen:agents-corpus` first so the corpus-dependent scaffold tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "revert(127): dissolve defineStream/useEventStream surface back to the loader baseline

Keeps the lifted internal/sse-events.ts and the design specs. The streaming
primitive is reshaped into the loader model in the following tasks.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Runtime route marker on `serverRoute` refs

**Files:**
- Modify: `packages/iso/src/define-loader.ts` (add `__routeId?: string` to `LoaderRef` + `DefineLoaderOptions`)
- Modify: `packages/iso/src/server-route.ts` (pass the route id into the ref it builds)
- Modify: `packages/iso/src/internal/contract.ts` (add `ROUTE_ID_OPTION = '__routeId'`)
- Modify: `packages/vite/src/module-key-plugin.ts` (thread `__routeId` into `serverRoute(...).loader(...)` calls, as it does `__loaderName`)
- Test: `packages/iso/src/__tests__/server-route-marker.test.ts`, and extend `packages/vite/src/__tests__/` module-key tests.

**Interfaces:**
- Produces: `LoaderRef.__routeId?: string` (the route pattern a loader is bound to, or `undefined` for route-independent); `ROUTE_ID_OPTION` constant; `serverRoute('/r/:id').loader(fn)` returns a ref with `__routeId === '/r/:id'` at runtime.
- Consumes: existing `DefineLoaderOptions.__moduleKey`/`__loaderName` threading pattern.

- [ ] **Step 1: Write the failing test**

```ts
// packages/iso/src/__tests__/server-route-marker.test.ts
import { describe, it, expect } from 'vitest';
import { serverRoute } from '../server-route.js';
import { defineLoader } from '../define-loader.js';

describe('runtime route marker', () => {
  it('serverRoute().loader stamps __routeId at runtime', () => {
    const ref = serverRoute('/movies/:id').loader(async () => 1);
    expect(ref.__routeId).toBe('/movies/:id');
  });
  it('bare defineLoader has no __routeId (route-independent)', () => {
    const ref = defineLoader(async () => 1);
    expect(ref.__routeId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npx vitest run server-route-marker`
Expected: FAIL (`__routeId` undefined for the serverRoute case).

- [ ] **Step 3: Add `__routeId` to the ref + opts**

In `packages/iso/src/define-loader.ts`: add `readonly __routeId?: string;` to `LoaderRef`, add `__routeId?: string;` to `DefineLoaderOptions`, and set `__routeId: opts?.__routeId` in the `ref` object literal.

In `packages/iso/src/server-route.ts`, change `loader: (fn, opts) => defineLoader(route, fn, opts)` to pass the route id explicitly into opts: `loader: (fn, opts) => defineLoader(route, fn, { ...opts, __routeId: route })` (and the same for `liveLoader`'s internal `defineLoader` call — `__routeId: route`).

In `packages/iso/src/internal/contract.ts`, add `export const ROUTE_ID_OPTION = '__routeId';` documented like `LOADER_NAME_OPTION`.

- [ ] **Step 4: Thread `__routeId` in the vite module-key plugin**

In `packages/vite/src/module-key-plugin.ts`, the plugin already injects `__moduleKey`/`__loaderName` into `serverLoaders` entries. For a `serverRoute('/path').loader(...)` call the route id is a string literal argument to `serverRoute`; the runtime `serverRoute` already forwards it. No NEW threading is required if `serverRoute` sets `__routeId` itself (Step 3). Confirm with a test that a built `serverRoute().loader` ref keeps `__routeId` after the plugin runs (add a case to the existing module-key plugin test asserting the transformed code still constructs the ref with the route id).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run server-route-marker module-key` then `pnpm --filter @hono-preact/iso exec tsc --noEmit && pnpm --filter @hono-preact/vite exec tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/server-route.ts packages/iso/src/internal/contract.ts packages/iso/src/__tests__/server-route-marker.test.ts packages/vite/src
git commit -m "feat(iso): runtime route marker (__routeId) on serverRoute loaders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Loaders handler composes the chain from the route marker

**Files:**
- Modify: `packages/server/src/loaders-handler.ts`
- Test: extend `packages/server/src/__tests__/loaders-handler.test.ts` (or add `loaders-handler-route-marker.test.ts`)

**Interfaces:**
- Consumes: `LoaderEntry` gains `routeId?: string` (read from `ref.__routeId` in `buildLoadersMap`).
- Produces: the handler composes `[app, resolvePageUse(routeId), unit]` for a route-bound loader (`routeId` present) and `[app, unit]` for a route-independent loader (`routeId` absent). A route-bound loader whose `routeId` does not resolve to a known route is rejected with 500 (never run guard-less).

- [ ] **Step 1: Write the failing tests**

Add to the handler test: (a) a route-independent loader (no `__routeId`) runs with `[app, unit]` and the page resolver is NOT consulted; (b) a route-bound loader (`__routeId` set) runs with `[app, page, unit]`. Use real `defineServerMiddleware` and assert call order (mirror the existing P0 chain-order test pattern in the suite).

```ts
it('route-independent loader composes [app, unit] (no page tier)', async () => {
  const calls: string[] = [];
  const app = mw('app', calls), unit = mw('unit', calls), page = mw('page', calls);
  // glob: a module with a bare defineLoader (no __routeId) carrying `unit`
  // resolvePageUse returns [page] for any path; assert it is NOT called.
  // ... build app, request /__loaders with { module, loader, location } ...
  expect(calls).toEqual(['app', 'unit']);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run loaders-handler`
Expected: FAIL (today the handler always composes the page tier by `location.path`).

- [ ] **Step 3: Read `routeId` in `buildLoadersMap` and branch composition**

In `buildLoadersMap`, add `routeId: ref.__routeId` to the `LoaderEntry`. In the handler, replace the unconditional `resolvePageUse: pageUseResolver.byPath, path: validatedLocation.path` with:

```ts
const routeBound = typeof entry.routeId === 'string';
const { serverMw, observers, resolvedTimeoutMs, timeoutSignal, signal } =
  await composeServerChain<'loader'>({
    requestSignal: c.req.raw.signal,
    unitTimeoutMs: entry.timeoutMs,
    defaultTimeoutMs,
    appConfig,
    // Route-bound: resolve guards from the loader's OWN declared route, not the
    // client-sent path. Route-independent: no page tier.
    resolvePageUse: routeBound ? resolvePageUse : () => [],
    path: routeBound ? entry.routeId! : '',
    unitUse: entry.use,
  });
```

And, for a route-bound loader whose declared route resolves to an EMPTY page chain because it is unknown, fail loudly rather than silently dropping guards: if `routeBound` and `resolvePageUse(entry.routeId!)` throws or the route is not in the manifest, return a 500 (the resolver's contract; `assertPageUseResolver` already guards an absent resolver). Add a test that an unknown declared route is rejected.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run loaders-handler` then `pnpm --filter @hono-preact/server exec tsc --noEmit`
Expected: PASS, clean (existing route-loader tests still pass since they carry a route via the manifest).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/loaders-handler.ts packages/server/src/__tests__
git commit -m "feat(server): loaders handler composes chain from the route marker (route-bound vs standalone)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `LoaderHost` tolerates route-independent (no-location) loaders

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx` (the no-location branch)
- Modify: `packages/iso/src/internal/__tests__/loader.test.tsx` (update the no-location-throw test)
- Test: `packages/iso/src/__tests__/route-independent-view.test.tsx` (new, from the spike)

**Interfaces:**
- Consumes: `LoaderRef.__routeId`.
- Produces: `LoaderHost` synthesizes an empty location for a route-independent loader (`__routeId` absent) instead of throwing; a route-bound loader (`__routeId` present) with no resolvable location STILL throws (its guards depend on the route).

- [ ] **Step 1: Write the failing test (from the spike, now permanent)**

```tsx
// @vitest-environment happy-dom  — packages/iso/src/__tests__/route-independent-view.test.tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { env } from '../is-browser.js';

const originalEnv = env.current;
afterEach(() => { env.current = originalEnv; });

it('route-independent live loader .View renders connecting on SSR with NO RouteLocationsProvider', () => {
  let invoked = 0;
  async function* live() { invoked++; yield { n: 1 }; }
  const ref = defineLoader<{ n: number }>(live, { __moduleKey: 'standalone-1', live: true });
  const Bar = ref.View<number[]>(
    (s) => <p>{(s.status === 'connecting' ? [] : s.data).join(',')}|{s.status}</p>,
    { initial: [], reduce: (acc, c) => [...acc, c.n] }
  );
  const App = () => (<LocationProvider><Bar /></LocationProvider>); // no RouteLocationsProvider
  env.current = 'server';
  const container = document.createElement('div');
  render(<App />, container);
  expect(invoked).toBe(0);
  expect(container.textContent).toContain('connecting');
  render(null, container);
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run route-independent-view`
Expected: FAIL with `Loader for module 'standalone-1' has no location` (loader.tsx).

- [ ] **Step 3: Relax the throw, gated on the route marker**

In `packages/iso/src/internal/loader.tsx`, replace the unconditional throw (the `if (!location) { throw ... }` block) with:

```tsx
const resolved = (locationProp ?? ctxLocation) as RouteHook | undefined;
if (!resolved && loaderRef.__routeId !== undefined) {
  // Route-bound loader with no resolvable location: its page-tier guards depend
  // on the route, so refuse rather than run without them.
  throw new Error(
    `Route-bound loader for module '${loaderRef.__moduleKey ?? '<unkeyed>'}' (route ` +
      `'${loaderRef.__routeId}') has no location; ensure it is consumed under its route.`
  );
}
// Route-independent loader: synthesize an empty location (the runner tolerates
// empty pathParams/searchParams; the cache key becomes module::name only).
const location: RouteHook = (resolved ?? {
  path: '',
  pathParams: {},
  searchParams: {},
}) as RouteHook;
```

- [ ] **Step 4: Update the old no-location-throw test**

In `packages/iso/src/internal/__tests__/loader.test.tsx`, the test `throws with remediation naming the route server module when no location is provided` asserts the OLD behavior. Change it to drive a ROUTE-BOUND loader (set `__routeId` on the ref) so the throw still fires for the route-bound case, and add a sibling assertion that a route-independent loader (no `__routeId`) does NOT throw.

- [ ] **Step 5: Run the spike test + the loader suites**

Run: `npx vitest run route-independent-view loader define-loader loader-view loader-streaming page define-page`
Expected: all PASS (the spike validated 471/472 with this exact change; the one prior failure is the throw-test you just updated).

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/internal/__tests__/loader.test.tsx packages/iso/src/__tests__/route-independent-view.test.tsx
git commit -m "feat(iso): LoaderHost tolerates route-independent loaders (synthetic location), keeps throw for route-bound

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Re-key SSR run-vs-skip on `live` (not the `accumulate` form)

**Files:**
- Modify: `packages/iso/src/internal/loader.tsx` (`DataReader` + the `accumulate` prop threading) and/or `use-loader-runner.tsx`
- Test: `packages/iso/src/__tests__/define-loader-live-ssr.test.tsx` (extend) + a new finite-streaming-SSR case

**Interfaces:**
- Consumes: `LoaderRef.live` (already on the ref).
- Produces: on SSR, a `live: true` streaming loader renders `connecting` and does NOT run its generator (regardless of consumption form); a `live: false` streaming loader runs and bakes its first chunk (streaming SSR). Today this decision is keyed on `accumulate`; re-key it on `live`.

- [ ] **Step 1: Write the failing test**

Add a test: a `live: false` streaming loader consumed via the accumulating `.View(render, { initial, reduce })` form, rendered on SSR, DOES invoke the generator and bakes the first chunk (anchor `data`), proving SSR-streaming is no longer suppressed merely by using the accumulating form. And confirm the existing `live: true` no-run test still holds.

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run define-loader-live-ssr`
Expected: FAIL for the new case (today `accumulate` suppresses the SSR run irrespective of `live`).

- [ ] **Step 3: Thread `live` into `DataReader`'s decision**

In `loader.tsx`, pass the loader's `live` flag to the SSR path. `DataReader` currently branches on `accumulate`; change the suppression condition to the loader's `live` flag: when `live`, render `toStreamState('connecting', { present: false }, null)` with anchor `{ kind: 'none' }` (no generator run); when not `live`, run the reader and bake (`{ status: 'success', data: raw }`, anchor `{ kind: 'data', value: raw }`) — keeping the accumulating projection where `accumulate` is set for the shape of `data`. Concretely, give `DataReader` a `live?: boolean` prop sourced from `loaderRef.live` in `LoaderHost`, and use `live` (not `accumulate`) for the connecting/none branch; keep `accumulate` only for projecting the streamed value shape.

- [ ] **Step 4: Run the SSR suites**

Run: `npx vitest run define-loader-live-ssr loader-streaming loader-view`
Expected: PASS (live still no-runs on SSR; non-live streaming now SSR-pumps).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/internal/loader.tsx packages/iso/src/internal/use-loader-runner.tsx packages/iso/src/__tests__/define-loader-live-ssr.test.tsx
git commit -m "feat(iso): SSR run-vs-skip keyed on the live flag, not the .View form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Definition-surface break + codebase migration (the breaking task)

**Files:**
- Modify: `packages/iso/src/define-loader.ts` (route-independent ctx + opts; streaming discriminant from return type; `{ live }`; remove route-form overload + `paramsSchema`/`searchSchema`/`params` from bare opts)
- Modify: `packages/iso/src/server-route.ts` (`.loader` accepts `{ live }`; remove `.liveLoader` method; add `liveStream` export)
- Modify: `packages/iso/src/index.ts` (export `liveStream`; drop any removed type exports)
- Modify: every `apps/site/src/**/*.server.ts` that uses `defineLoader(({ location }) => …)` or `defineLoader('/r/:id', …)` → migrate to `serverRoute(r).loader(...)`; route-independent ones stay bare.
- Test: `packages/iso/src/__tests__/define-loader.test-d.ts` (overload + ctx assertions), `packages/iso/src/__tests__/live-stream.test.ts`

**Interfaces:**
- Produces:
  - `defineLoader<T>(fn: (ctx: StandaloneCtx) => Promise<T>, opts?: StandaloneOpts): LoaderRef<T, false>` and `defineLoader<T>(fn: (ctx: StandaloneCtx) => AsyncGenerator<T>, opts?: StandaloneOpts): LoaderRef<T, true>` where `StandaloneCtx = { c: Context; signal: AbortSignal; call: ServerCaller['call'] }` and `StandaloneOpts = { live?: boolean; cache?; use?; timeoutMs? }`. No `location`, no route-form, no schemas.
  - `serverRoute(r).loader(fn, opts?)` where `opts` adds `searchSchema`/`paramsSchema`/`params`/`{ live }`.
  - `liveStream<T, C>({ topic, load }): (ctx: C) => AsyncGenerator<T>` — a pure generator helper (yield `load(ctx)`, re-run on `topic(ctx)` publish), composed via `defineLoader(liveStream(...), { live: true })` / `route.loader(liveStream(...), { live: true })`.
  - `serverRoute(r).liveLoader` is removed.

- [ ] **Step 1: Write the failing type-level test**

```ts
// packages/iso/src/__tests__/define-loader.test-d.ts
import { expectTypeOf } from 'vitest';
import { defineLoader, serverRoute } from '../index.js';

// bare defineLoader ctx has NO location
defineLoader(async (ctx) => {
  expectTypeOf(ctx).not.toHaveProperty('location');
  expectTypeOf(ctx).toHaveProperty('c');
  expectTypeOf(ctx).toHaveProperty('signal');
  return 1;
});
// generator body -> live-capable ref (accumulating .View)
const s = defineLoader(async function* () { yield 1; });
expectTypeOf(s.View).toBeFunction();
// route-form on defineLoader is GONE:
// @ts-expect-error defineLoader no longer takes a route string
defineLoader('/movies/:id', async () => 1);
// serverRoute supplies typed params:
serverRoute('/movies/:id').loader(async ({ location }) => {
  expectTypeOf(location.pathParams.id).toEqualTypeOf<string>();
  return 1;
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npx vitest run --typecheck.only define-loader.test-d`
Expected: FAIL (bare ctx still has `location`; route-form still accepted).

- [ ] **Step 3: Reshape `defineLoader`**

In `packages/iso/src/define-loader.ts`:
- Replace `LoaderCtx` for the bare form with `StandaloneCtx = { c: Context; signal: AbortSignal; call: ServerCaller['call'] }` (the `serverRoute` route form keeps the location-bearing `LoaderCtx`).
- Remove the route-form overloads (`defineLoader(route, fn, opts)`); `serverRoute` calls an INTERNAL route-binding helper (e.g. keep a private `defineRouteLoader(routeId, fn, opts)` used only by `server-route.ts`, not exported).
- Drive the `Live` discriminant from the fn return type: overload `(ctx) => AsyncGenerator<T>` → `LoaderRef<T, true>`, `(ctx) => Promise<T>` → `LoaderRef<T, false>`. Remove `live` from controlling the `.View` form's TYPE (the body shape does); keep `live` as a runtime SSR flag on the ref/opts.
- Remove `paramsSchema`/`searchSchema`/`params` from the bare `DefineLoaderOptions`; they live on the `serverRoute(r).loader` opts only.

- [ ] **Step 4: Reshape `server-route.ts` + add `liveStream`**

In `packages/iso/src/server-route.ts`:
- `loader(fn, opts)` keeps the route-bound ctx and now accepts `{ live }` (remove the `Omit<…, 'live'>`).
- Delete the `liveLoader` method and `LiveLoaderOptions`.
- Add and export `liveStream`:

```ts
import { subscribeTopic } from './internal/subscribe-topic.js';
import type { Topic } from './define-channel.js';

export function liveStream<T, C extends { signal: AbortSignal }>(opts: {
  topic: (ctx: C) => Topic<unknown>;
  load: (ctx: C) => Promise<T>;
}): (ctx: C) => AsyncGenerator<T, void, unknown> {
  return async function* (ctx) {
    yield await opts.load(ctx);
    for await (const _ of subscribeTopic(opts.topic(ctx), ctx.signal)) {
      yield await opts.load(ctx);
    }
  };
}
```

Export `liveStream` from `packages/iso/src/index.ts`.

- [ ] **Step 5: Write a runtime test for `liveStream`**

```ts
// packages/iso/src/__tests__/live-stream.test.ts — assert it yields load() then re-yields on publish.
```

(Use a fake `topic`/`subscribeTopic` or the existing channel test doubles; assert the first value is `load()`'s result and a publish triggers a re-`load`.)

- [ ] **Step 6: Migrate the codebase's route-coupled loaders**

Enumerate consumers: `rg -ln "defineLoader\(" apps/site/src --glob '*.server.ts'`. For EACH file, apply the mechanical transform:
- A loader that reads `location` (e.g. `defineLoader(async ({ location }) => get(location.pathParams.id))`) → wrap the module in `const route = serverRoute('<the route's path>');` and call `route.loader(async ({ location }) => …)`. The route path is the one the file's `server:` entry sits under in `routes.ts`.
- A loader that uses `defineLoader('/r/:id', fn)` (route-form) → `serverRoute('/r/:id').loader(fn)`.
- A route-INDEPENDENT loader (no `location`, e.g. the activity generator) → leave as bare `defineLoader` (add `{ live: true }` if it is an unbounded client-only subscription).
- A `serverRoute(r).liveLoader({ topic, load })` call → `route.loader(liveStream({ topic, load }), { live: true })`.

Representative before/after (movie.server.ts):

```ts
// before
export const serverLoaders = {
  summary: defineLoader(async ({ location }) => getMovie(location.pathParams.id)),
  cast: defineLoader(async function* ({ location }) { yield* streamCast(location.pathParams.id); }),
};
// after
const route = serverRoute('/movies/:id');
export const serverLoaders = {
  summary: route.loader(async ({ location }) => getMovie(location.pathParams.id)),
  cast: route.loader(async function* ({ location }) { yield* streamCast(location.pathParams.id); }),
};
```

- [ ] **Step 7: Run typecheck + the full suite + site build**

Run: `pnpm typecheck && npx vitest run packages && pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm --filter site build`
Expected: green. Typecheck surfaces any unmigrated `location` use on a bare loader (a compile error pointing exactly at what to migrate) — fix each by moving it under `serverRoute`.

- [ ] **Step 8: Commit**

```bash
git add packages/iso/src apps/site/src
git commit -m "feat(iso)!: defineLoader is route-independent; serverRoute is the only route binding; liveStream helper

BREAKING: bare defineLoader ctx has no location; the route-form and bare
params/schemas are removed (use serverRoute). serverRoute.liveLoader is replaced
by liveStream composed into .loader. Streaming is inferred from the body; { live }
controls SSR vs client-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Convert the demo activity bar to a route-independent streaming loader

**Files:**
- Modify: `apps/site/src/pages/demo/projects-shell.server.ts` (or wherever the activity loader now lives post-revert) + `apps/site/src/components/demo/ActivityBar.tsx`
- Test: the existing `ActivityBar` unit + SSR tests (update to the route-independent form)

**Interfaces:** consumes the route-independent `defineLoader` + `.View`.

- [ ] **Step 1** Read the current (post-revert) activity loader + bar. After Task 1, the activity bar is back on the pre-#127 `defineLoader(async function* …)` live-loader `.View` form. Confirm it is route-INDEPENDENT (no `location`) and consumed via `.View` outside the router (it renders in the layout/persist host).

- [ ] **Step 2** Ensure it carries `{ live: true }` (unbounded subscription, client-only) and is consumed via the accumulating `.View(render, { initial, reduce })`. If the post-revert form already matches, this task is a no-op verification + a test asserting it renders outside a route. If it currently sits under a route's `serverLoaders` purely for discovery, move its `*.server.ts` to be colocated with the component (route-independent), relying on glob discovery being out of scope — so for THIS plan, keep it discoverable by leaving its `server:` entry but making the loader route-independent (no `__routeId`).

- [ ] **Step 3** Run: `npx vitest run ActivityBar && pnpm --filter site build`. Expected: green; the bar streams as before.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src
git commit -m "refactor(site): demo activity bar as a route-independent streaming loader

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentation — rewrite the loaders guide for the inversion

**Files:**
- Modify: `apps/site/src/pages/docs/loaders.mdx`
- Confirm: `apps/site/src/pages/docs/__tests__/exports-coverage.test.ts` passes (no `defineStream`/`useEventStream` to document or allowlist any more)

**Interfaces:** none (docs).

- [ ] **Step 1** Read the local docs skill (`.claude/skills/add-docs-page.md`) and the current `loaders.mdx`.

- [ ] **Step 2** Rewrite `loaders.mdx` to document: `serverRoute(r).loader` for route-bound (typed params, page-tier auth), bare `defineLoader` for route-independent, streaming inferred from the body, the `{ live }` flag + the streaming-lifecycle matrix (finite SSRs; route-bound or independent generator SSR-streams unless `live: true`, which is client-only), `liveStream`, and consumption via `.View`/`useData`. No migration breadcrumbs (describe what IS). CSS/Tailwind CodeTabs parity if used. No em-dashes.

- [ ] **Step 3** Run: `pnpm gen:agents-corpus && npx vitest run exports-coverage && pnpm --filter site build`. Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/pages/docs/loaders.mdx
git commit -m "docs(site): rewrite loaders guide for the route-binding inversion (#127)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Full pre-push CI gate + final review

**Files:** none (verification).

- [ ] **Step 1** Run, in order:

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

Expected: all green. If `format:check` fails, `pnpm format`, review, amend the relevant commit.

- [ ] **Step 2** Review the public-API surface diff: `defineStream`/`useEventStream`/`serverStreams`/`/__streams` are GONE; `defineLoader` is route-independent; `serverRoute` is the route binder; `liveStream` is added; `serverRoute.liveLoader` is gone. Confirm it matches the spec's "Public API surface delta."

- [ ] **Step 3** Do NOT push. Report the eight CI steps green; the branch (which already holds PR #212) is reshaped onto the inversion and ready for the user's review.

---

## Self-Review

**Spec coverage:**
- Inversion (defineLoader route-independent, serverRoute route-bound) → Tasks 4, 6. ✓
- Three orthogonal axes (route / streaming-from-body / `{ live }`) → Task 6 (define + body discriminant + live), Task 5 (live SSR semantics). ✓
- `liveStream` helper, `.liveLoader` removed → Task 6. ✓
- Unified `.View`/`useData` outside the router → Tasks 4, 5 (spike-validated). ✓
- One server engine, RPC folding, runtime route marker, guard-from-declared-route → Tasks 1 (delete streamsHandler/__streams), 2 (marker), 3 (handler). ✓
- What dissolves from #127 → Task 1. ✓
- Clean-break migration → Task 6 (step 6), Task 7. ✓
- Docs sync → Task 8. ✓
- Stacked follow-up (registration removal + serverRoute.action) → out of scope per spec; not a task here (documented in the spec). ✓

**Placeholder scan:** Task 6 step 6 (migration) enumerates files via `rg` and gives the concrete mechanical transform with before/after code rather than a per-file listing — this is a stated repetitive transform, not a "handle the rest" placeholder. Task 7 step 2 branches on the post-revert state (verify-or-move), which the implementer resolves by reading the actual file. No "TODO/TBD/add error handling" placeholders remain.

**Type consistency:** `__routeId` (Task 2) is consumed by Tasks 3 (`entry.routeId`) and 4 (`loaderRef.__routeId`). `StandaloneCtx`/`StandaloneOpts` (Task 6) match the spec. `liveStream` signature is consistent between Task 6 step 4 (definition) and the spec. `LoaderRef<T, Live>` discriminant becomes body-inferred in Task 6, consistent with Task 5's `live` runtime flag (separate concern: type discriminant = body shape; runtime SSR flag = `live`).

**Risk note carried from the spike:** the route-independent `.View` change (Tasks 4, 5) is the de-risked core — proven to be a bounded `LoaderHost`/`DataReader` change with no regression to the 471 route-bound tests. Task 6 (the breaking surface + migration) is the largest and should get the most careful review; its safety net is `pnpm typecheck`, which flags every unmigrated `location` use as a compile error.
