# Middleware PR Review Follow-ups

Captured from the deep code review of PR #53 (feat/loader-action-middleware) on 2026-05-21. Five parallel reviewers swept the iso primitives, server dispatch, vite plugins, client decoding + demo, and tests + cross-cutting concerns. This plan groups every finding (CRITICAL → LOW) into 6 parallelizable agent slices so the work can be picked up fresh.

The review is the source of truth for the **why** of each item; this plan is the **what to change** in dependency order. Findings are tagged `[Rn#m]` where `n` is the reviewer slice (1=iso primitives, 2=server, 3=vite, 4=client/demo, 5=tests/cross-cutting) and `m` is the finding number within that report.

## Sequencing

The 6 agent groups (A–F below) touch disjoint file sets and can run in parallel under git-worktree isolation. After each agent returns, merge its branch into `feat/loader-action-middleware` sequentially; resolve any cross-agent test regressions at the merge.

If running sequentially instead, the prudent order is **A → C → B → E → D → F**: dispatcher and type fixes first (A) so client-decoding work (C) has a stable target; then the SSR outcome plumbing (B) which depends on outcomes' final shape; server compose (E) which can change the generated entry signature; subpath + docs (D) which needs E's final shape; vite plugin cleanup (F) last.

Tests are owned by the agent that owns the code. Each agent runs `pnpm typecheck && pnpm vitest run <its scope> && pnpm prettier --check <its files>` before committing.

---

## Agent A — iso primitives, types, dispatcher

**Files:** `packages/iso/src/internal/use-types.ts`, `packages/iso/src/define-app.ts`, `packages/iso/src/internal/middleware-runner.ts`, `packages/iso/src/internal/__tests__/middleware-runner.test.ts`.

### A1. `PageUse` / `AppUse` accept middleware of any scope at type-level [R1#2, R1#4, R1#14] — CRITICAL

`Use<S, ...>` distributes over `S` when `S` is a union (`Scope = 'page' | 'loader' | 'action'`), so `PageUse = Use<Scope, true>` expands to `ServerMiddleware<'page'> | ServerMiddleware<'loader'> | ServerMiddleware<'action'> | ...`. Result: `definePage({ use: [defineServerMiddleware<'loader'>(...)] })` typechecks. At runtime the host casts to `ServerMiddleware<'page'>` and the loader-mw fn body reading `ctx.module` / `ctx.loader` gets `undefined`.

Same defect on `AppUse` — `defineApp({ use: [defineServerMiddleware<'action'>(...)] })` typechecks. `render.tsx` invokes with `scope: 'page'` ctx.

**Fix:** Replace `Use<Scope, true>` with the non-distributive form:

```ts
export type PageUse = ReadonlyArray<
  | ServerMiddleware<'page'>
  | ClientMiddleware
  | StreamObserver<unknown, never>
>;
export type AppUse = PageUse; // app-level runs in page scope per render.tsx
```

Or, if a wider intent is needed, wrap in tuple-tagged conditional: `[S] extends [Scope] ? ServerMiddleware<S> : never`.

### A2. Double-next isn't detected [R1#7, R5#17] — MEDIUM

`middleware-runner.ts:33-37` flips `nextCalled = true` synchronously and never guards against a second call. A buggy middleware `await next(); await next();` runs the inner twice silently.

**Fix:** Add symmetric guard alongside the forgotten-next check:

```ts
const next = async () => {
  if (nextCalled) {
    throw new Error(
      `Middleware called next() twice. Each middleware must call next() exactly once...`
    );
  }
  nextCalled = true;
  await runChain(index + 1);
};
```

Apply to both `dispatchServer` and `dispatchClient`.

### A3. Test: middle-mw outcome short-circuit [R5#6] — MEDIUM

Add a test asserting that when a page-layer middleware throws an outcome:
- the inner (unit) middleware does NOT run,
- the outer (root) middleware's `after` block DOES run (so cleanup happens),
- the outcome reaches the dispatcher's `kind: 'outcome'` return.

### A4. Test: double-next detection [R5#4] — MEDIUM

Add a test asserting the new double-next guard fires with a structured error.

### A5. Test: non-outcome error from inner [R5#4] — LOW

Existing tests only cover deny thrown from inner. Add a generic `Error` thrown from inner; assert it propagates (rethrown, not swallowed).

### A6. Test: signal abort mid-chain [R5#4] — LOW

Asserts AbortSignal aborting partway propagates correctly (or document the chosen behavior — the dispatcher currently doesn't read the signal).

### A7. Unawaited-next detection [R1#8] — LOW

A middleware that fire-and-forgets `next()` (no await) flips `nextCalled = true` but lets its own body resolve before the chain settles. Add an assertion that `next()`'s returned promise must settle before the mw fn resolves (e.g. wrap next in a Promise that the mw must complete observation of). Lower priority; flag for follow-up.

---

## Agent B — page host + RouteBoundary + SSR outcome flow

**Files:** `packages/iso/src/page.tsx`, `packages/iso/src/internal/route-boundary.tsx`, `packages/iso/src/internal/page-middleware-host.tsx`, `packages/iso/src/internal/__tests__/page-middleware-host.test.tsx` (new tests), `packages/server/src/__tests__/render-honocontext.test.tsx`.

### B1. `RouteBoundary` ErrorBoundary swallows page-scope outcomes [R1#1] — CRITICAL

`Page` wraps `<PageMiddlewareHost>` in `<RouteBoundary>`. RouteBoundary's `ErrorBoundary` catches every throw, coerces to `new Error(String(value))`, and renders the fallback. On SSR, `HostConsumer` rethrows `redirect` and `deny` outcomes so renderPage's outer catch can translate them — but the ErrorBoundary intercepts first.

**Fix (option A, preferred):** In `RouteBoundary`'s ErrorBoundary, detect `isOutcome(error)` and rethrow:

```tsx
componentDidCatch(err) {
  if (isOutcome(err)) throw err; // let outer dispatcher translate
  this.setState({ error: err });
}
```

**Fix (option B):** Restructure `Page` so `<PageMiddlewareHost>` wraps `<RouteBoundary>` instead of the other way around. Verify all consumers of `errorFallback`.

### B2. `PageMiddlewareHost` re-dispatches the chain on every render [R1#3] — CRITICAL

`page-middleware-host.tsx:118` evaluates `wrapPromise(startChain(...))` every render before `useRef` decides whether to keep it. `startChain` synchronously fires `dispatchClient`/`dispatchServer`, so any client middleware (auth checks, analytics, redirects) runs O(renders) instead of O(navigations).

**Fix:** Lazy ref pattern:

```tsx
const resultRef = useRef<RefValue['current'] | null>(null);
const prevPath = useRef(location.path);
if (resultRef.current === null || prevPath.current !== location.path) {
  prevPath.current = location.path;
  resultRef.current = wrapPromise(startChain(use, location, honoCtx));
}
```

### B3. `HostConsumer` calls `route()` as a render-time side effect [R1#6] — MEDIUM

`page-middleware-host.tsx:93-97` calls `useLocation().route(outcome.to)` while returning `null` from render. Side effects in render are forbidden by Suspense semantics; combined with B2 this can fire `route()` repeatedly during a render loop.

**Fix:** Move the redirect into a `useEffect` keyed on the outcome identity. Return `null` from render unconditionally; the effect schedules the navigation.

### B4. `startChain` throws synchronously on missing `HonoRequestContext` [R1#9] — MEDIUM

`page-middleware-host.tsx:57-62`. The throw is sync, not inside the returned Promise, so `wrapPromise` never receives a Promise; the error coerces to a generic Error via the ErrorBoundary instead of the explicit "renderPage must wrap..." message.

**Fix:** Return `Promise.reject(new Error('...'))` instead of throw, OR make this a hard precondition documented in a top-of-file comment.

### B5. `HostConsumer` `isRender(outcome)` swap doesn't key the alternative component [R1#19] — LOW

Re-entering with a fresh render outcome won't remount when the previous Alt is the same Component instance. Add `<Alt key={renderId}/>` or document the equality-by-reference semantics.

### B6. Test: SSR deny outcome through renderPage [R5#1, R5#20] — MEDIUM

Add a test asserting a `deny(403)` thrown by a page-scope server middleware during SSR produces an HTTP 403 response with the message body. The redirect branch is covered by `render-honocontext.test.tsx:43`; deny is not.

### B7. Test: SSR render outcome through renderPage defensive 500 [R5#1] — LOW

Assert that a `render(Component)` outcome accidentally reaching the root chain in `renderPage` returns a 500 (since `render` is page-scope only and shouldn't appear at root). This is the dead-code defense in `translateRootOutcome`'s third branch.

### B8. Test: PageMiddlewareHost re-entry on path change [R5#3] — MEDIUM

Asserts that navigating between paths runs the new path's middleware, not a stale chain.

### B9. Test: client-side `route()` redirect from middleware [R5#3] — LOW

The existing render branch is tested; the client redirect branch is not.

---

## Agent C — outcomes + client decoding + action mutation

**Files:** `packages/iso/src/outcomes.ts`, `packages/iso/src/action.ts`, `packages/iso/src/internal/loader-fetch.ts`, `packages/iso/src/__tests__/action.test.tsx` (or new test file), `packages/iso/src/internal/__tests__/loader-fetch.test.ts`.

### C1. `deny(status)` with no message produces a generic client error [R4#1, R5#2] — MEDIUM

`JSON.stringify` drops `undefined`, so the envelope arrives without `message`. The client checks `body.__outcome === 'deny' && typeof body.message === 'string'`; the string-typeof check fails and falls back to `"Loader failed with status 403"` / `"Action failed with status 403"`.

**Fix (option A):** Default the deny message in the constructor:

```ts
export function deny(a, b?) {
  // ...
  return {
    __outcome: 'deny',
    status: a,
    message: b ?? `Denied (${a})`,
    headers: undefined,
  };
}
```

**Fix (option B):** In the client decoders, fall back to a deny-aware label when `__outcome === 'deny'` but message is missing.

### C2. `defineAction` mutates the user's function with `.use` [R1#12] — MEDIUM

`action.ts:46-50` does `stub.use = opts.use` directly on the fn. Frozen module exports throw in strict ESM; HMR-frozen modules may also reject.

**Fix:** Either (a) wrap the fn in an object that carries `.use` alongside `fn`, or (b) use `Object.defineProperty(fn, 'use', { value: opts.use, configurable: true })`. Option (b) is the smaller diff. The actions-handler at `actions-handler.ts:230` reads via `(fn as { use?: ReadonlyArray<unknown> }).use` — that read-path works with both options.

### C3. Outcome headers in JSON envelopes are dead bytes [R1#10] — MEDIUM

`loaders-handler.ts:128-140` and `actions-handler.ts:57-65` write headers to the response via `c.header(...)` (good) AND embed them in the JSON envelope `{ __outcome:'redirect', to, status, headers }`. The client reads only `to` and calls `window.location.assign(to)`. The embedded headers are dead bytes.

**Fix:** Drop `headers` from the envelope payload. Keep the `c.header()` calls so they ride the response.

### C4. Same-origin trust on redirect target [R5#19] — MEDIUM

Both client paths trust the JSON response's `to` string and call `window.location.assign(to)` without origin checking. The framework's own handlers emit safe values; a malicious server or a misconfigured proxy injecting JSON could push the client anywhere.

**Fix:** Either document the trust boundary, or add a same-origin check (default to same-origin; allow an opt-in escape for cross-origin redirects).

### C5. Outcome returned (not thrown) from inner is not normalized [R2#15] — MEDIUM

`middleware-runner.ts:28` does `innerResult = await args.inner()` and never checks `isOutcome`. A loader that does `return redirect('/login')` (instead of `throw`) sends the outcome JSON shape as a regular 200 response, bypassing the wire envelope translation.

**Fix:** In the handler `inner: async () => entry.fn(...)` closure (loaders-handler.ts:229-231, actions-handler.ts:268-274), check `isOutcome(result)` and `throw result` to unify with the existing catch. Alternatively, document that throw is the only supported way.

### C6. Redirect-outcome collision risk on plain loader data [R4#2] — LOW

A loader that genuinely returns data shaped `{ __outcome: 'redirect', to: <string> }` will navigate the browser instead of resolving. Lower likelihood than legacy `{ __redirect }` but the magic key is still a normal-looking field.

**Fix (opt):** Add a wire-version sentinel like `__envelope: 'hono-preact/redirect'`, or rely on a response header (`X-Hono-Preact-Outcome: redirect`) instead of body-key sniffing.

### C7. Test: action client decoding of deny envelope [R5#2] — MEDIUM

Cover the `body.message` over `body.error` precedence. Mock fetch returning `{ __outcome: 'deny', message: 'Forbidden' }` at status 403; assert the thrown Error carries the deny message.

### C8. Test: action client decoding of redirect envelope [R5#2] — MEDIUM

Symmetric to `loader-fetch.test.ts:35`. Assert `window.location.assign` is called with the deny's `to`.

### C9. Test: action FormData submission outcome decoding [R4#8 (clean) verification] — LOW

Currently clean per the review. Add an explicit test so the symmetric path is pinned for regression.

### C10. Comment cleanup: action.ts trust-boundary note [R5#19] — LOW

Add a comment explaining why the redirect peek uses `response.clone().json()`.

---

## Agent D — umbrella subpath + docs cleanup + dead exports

**Files:** `packages/hono-preact/package.json`, `packages/hono-preact/src/page.ts` (new), `packages/iso/src/page-only.ts`, `packages/iso/src/index.ts`, `packages/hono-preact/__tests__/exports.test.ts`, `vitest.config.ts`, `apps/site/src/pages/docs/middleware.mdx`, `packages/iso/src/internal.ts`, `packages/hono-preact/README.md`.

### D1. `hono-preact/page` subpath is documented but doesn't exist [R5#11] — CRITICAL

The docs tell users `import { redirect, deny, render } from 'hono-preact/page'`. The umbrella `package.json` has no `./page` export. The iso `/page` subpath only exports `render` + `isRender`, not `redirect`/`deny`. First user copy-paste breaks.

**Fix:**
1. Add `./page` to `packages/hono-preact/package.json` exports field, pointing at `dist/page.js` / `dist/page.d.ts`.
2. Create `packages/hono-preact/src/page.ts` that re-exports from `@hono-preact/iso/page`.
3. Extend `packages/iso/src/page-only.ts` to also re-export `redirect`, `deny`, `isOutcome`, `isRedirect`, `isDeny` (everything a page-scope file needs in one import). Keep `render` and `isRender` page-only-exclusive.
4. Update the umbrella build's `scripts/consolidate.mjs` if it gates which subpaths to consolidate.

### D2. Add the `hono-preact/page` vitest alias [R5#12] — MEDIUM

`vitest.config.ts` aliases `@hono-preact/iso/page` but not `hono-preact/page`. Add the umbrella alias so future tests that follow the docs resolve correctly.

### D3. `exports.test.ts` doesn't assert the predicates [R5#13] — MEDIUM

Public API includes `isOutcome`, `isRedirect`, `isDeny`, `isRender` (exported from `packages/iso/src/index.ts:86-89` and documented in structure.mdx). The exports test doesn't assert them. Add assertions. Also add the new `./page` subpath assertion.

### D4. `isRender` exported from both `index.ts` and `page-only.ts` [R5#14] — LOW

Pick one canonical path. Probably `index.ts` for the predicate (scope-agnostic) and `page-only.ts` for the constructor (`render`). Document the choice in `page-only.ts`'s header.

### D5. Middleware docs claim mismatch on import paths [R5#11] — CRITICAL (paired with D1)

`apps/site/src/pages/docs/middleware.mdx:178,193,323` (and the worked-examples section) tell users to import `redirect`/`deny`/`render` all from `hono-preact/page`. If D1 chooses the "only `render` lives in the page subpath" approach, update the docs to split: `redirect`/`deny` from root, `render` from `/page`.

### D6. `internal.ts` docstring still references `guards` [R5#9] — LOW

Update the file-header comment to describe middleware composition instead of guards.

### D7. `packages/hono-preact/README.md` still lists `guards` [R5#10] — LOW

Update the "what's in this package" line to say middleware.

### D8. `RECOGNIZED_USE_EXPORTS` and `hasNamedUseExport` dead surface [R3#1, R5#8] — LOW

`packages/vite/src/server-loaders-parser.ts` exports these but nothing reads them outside the test. Either wire them into `server-only.ts` and `server-loader-validation.ts` as a single source of truth (see F2), or drop them. If wiring, do it in Agent F's pass; if dropping, do it here.

### D9. Verify docs/middleware.mdx examples still compile [follow-up to D1, D5] — MEDIUM

After D1+D5, scan every code block in middleware.mdx for `import { ... } from 'hono-preact'` or `from 'hono-preact/page'` and verify each named import exists in the chosen export shape.

---

## Agent E — server compose + tiebreaker + dev rebuild + route-tree ancestor walk + stream observers + demo cleanup

**Files:** `packages/server/src/route-server-modules.ts`, `packages/iso/src/define-routes.tsx`, `packages/server/src/loaders-handler.ts`, `packages/server/src/actions-handler.ts`, `packages/server/src/sse.ts`, `packages/iso/src/internal/loader-runner.ts`, `packages/vite/src/server-entry.ts`, `packages/server/src/__tests__/middleware-chain.test.ts`, `apps/site/src/pages/demo/*.server.ts`.

### E1. `byPath` ambiguity when multiple patterns at same depth match [R2#1] — CRITICAL

`route-server-modules.ts:170-180` picks the longest-segment match but ties are broken by Map iteration order. For URL `/admin/users/me` matching both literal `/admin/users/me` and param `/admin/users/:id`, the winner is undefined. preact-iso prefers literals at runtime, so the page rendered won't match the gates that fire.

**Fix:** Score each pattern: literal segment = 2, param = 1, wildcard = 0. Pick the highest score. For the example, `/admin/users/me` scores 6, `/admin/users/:id` scores 5 — literal wins, matching preact-iso.

### E2. `patternIsAncestor` uses URL-prefix, not route-tree-prefix [R4#3] — CRITICAL

`patternIsAncestor('/demo/projects', '/demo/projects/:projectId/issues/:issueId')` returns true via segment-prefix matching. But `/demo/projects` and `/demo/projects/:projectId` are *siblings* in the demo route tree, not parent/child. Net effect: `requireSession` runs twice on every nested issue request.

**Fix:** Change `collectServerRoutes` in `packages/iso/src/define-routes.tsx` to emit ancestry explicitly:

```ts
export type ServerRoute = {
  path: string;
  server: LazyServerImport;
  ancestors: ReadonlyArray<LazyServerImport>; // outer-first, excluding self
};
```

The walker tracks the stack of server thunks from root to the current node; each emitted entry captures its true tree-walk ancestors.

Then `makePageUseResolvers` composes by `[...ancestors, self]` instead of by URL-prefix matching across all entries. Drop `patternIsAncestor` entirely.

### E3. Stream observers are never fanned out [R1#5] — CRITICAL

`fanStart/fanChunk/fanEnd/fanError/fanAbort` are exported from `internal.ts` but no caller exists in `loader-runner.ts`, `loaders-handler.ts`, `actions-handler.ts`, or `sse.ts`. Observers attached via `defineStreamObserver(...)` silently do nothing.

**Fix:** Wire observer fanout into:
1. `loaders-handler.ts` streaming response (`sseGeneratorResponse` / `sseReadableStreamResponse`): wrap the generator/stream consumer so each chunk fires `fanChunk(observers, ctx, chunk, i)`. Fire `fanStart` before the first chunk, `fanEnd` on completion, `fanError` on throw, `fanAbort` on signal.
2. `actions-handler.ts` streaming response: same shape.
3. `iso/internal/loader-runner.ts` SSR-inline streaming path: same shape so SSR-side streaming also fires observers.

Tests must assert that an observer in `use: [obs]` receives the start/chunk/end events end-to-end.

### E4. `makePageUseResolvers` ignores `dev: true` [R2#4] — MEDIUM

The handlers honor `dev` and rebuild their maps per request; the resolver caches `buildPromise` forever. Editing `pageUse` in dev doesn't take effect.

**Fix:** Accept `dev?: boolean` as a second arg to `makePageUseResolvers`. When `dev`, set `buildPromise = null` on every resolver call. Update `server-entry.ts`'s generated source to pass `dev` through.

### E5. Non-array `pageUse` is silently dropped [R2#3] — MEDIUM

`route-server-modules.ts:122-124` does `Array.isArray(mod.pageUse) ? ... : null`. `pageUse = mySingleMw` (no brackets) silently disables the gate.

**Fix:** Two parts:
1. Build-time: `serverLoaderValidationPlugin` should fail the build if `pageUse`/`loaderUse`/`actionUse` are not array literals (this work lives in Agent F as F3, cross-reference).
2. Runtime: when the resolver loads a module with `mod.pageUse` non-array AND non-null/undefined, throw with a descriptive message at the first `byPath`/`byModuleKey` call rather than silently dropping.

### E6. Resolver lookup is O(routes × patterns) per request [R2#9] — LOW

`byPath` linear-scans every key in `composedByPath`. For small apps invisible; at scale a precomputed trie or a request-keyed memo would help. Defer; just leave a comment noting the perf characteristic.

### E7. `loaderUse` / `actionUse` allowlisted but never wired [R3#2] — MEDIUM

Server-only stubs them to `[]`; validation accepts them; parser recognizes them. No handler reads them at runtime. A user who writes `export const loaderUse = [mw]` gets a silent no-op.

**Fix:** Decide:
- (a) Drop them from the allowlist (only `pageUse` exists for v0.1; user attaches per-unit middleware via `defineLoader(fn, { use })` / `defineAction(fn, { use })`).
- (b) Wire them. The natural semantic is "applies to every loader/action in this `.server.*` file" — i.e. a file-level layer between `pageUse` and per-unit `use`. Adds a 4th composition step.

Recommended: (a) drop them; document `defineLoader({ use })` as the only per-unit path.

### E8. Render outcome from app middleware produces a sanitized 500 [R2#5] — MEDIUM

`render.tsx:65-68` returns a generic 500 when a render outcome leaks from app-level middleware. The intent is right, but the user sees nothing helpful in dev.

**Fix:** Add an `onError` option to `renderPage` (parallel to the handlers' `onError`), OR emit `console.warn` in dev when `outcome.__outcome === 'render'` lands here. Surface "render outcome in app-level middleware — render is page-scope only" so the user can find the misuse.

### E9. `dispatchServer` is invoked with `scope: 'page'` for the app chain [R1#11] — MEDIUM

`render.tsx:123-156` dispatches app-level middleware with `scope: 'page'` ctx, conflating app and page scope. A user's mw that checks `ctx.scope === 'page'` to mean "this is page render, not action/loader" fires for the app run too.

**Fix:** Either:
- (a) Introduce a fourth scope `'app'` and tag the app-level dispatch with it (requires extending `Scope` and updating all the conditional types).
- (b) Document explicitly that app-level mw inspecting `scope` sees `'page'` here, and recommend not branching on scope at app level.

Recommended: (b) for v0.1 (smaller diff); revisit if a real use case emerges.

### E10. Latent layout-and-empty-path-child map clobber [R2#2] — LOW

`collectServerRoutes` emits two `ServerRoute` entries with identical `path` when a layout group at `/admin` AND its first child `{ path: '', server }` both have `server`. `composedByPath.set(path, ...)` is called twice; last write wins.

**Fix:** With E2's route-tree ancestry change, this becomes a route-table validation: either error at `defineRoutes` time ("two server modules at the same route path") or coalesce ancestors deterministically.

### E11. Self-as-ancestor implicit in `patternIsAncestor` [R2#11] — LOW

Currently relies on `patternIsAncestor(self, self) === true` to include the route's own pageUse. Obsolete after E2 (true ancestors are explicit).

### E12. `bindRequestScope` default-identity is unreachable in streaming path [R2#13] — LOW

`render.tsx:88-90`. The default is never exercised because outcome short-circuit returns before streaming setup. Delete the default or add a comment that it exists only to satisfy TS.

### E13. Demo: drop redundant `pageUse` from nested leaves [R4#3 follow-up] — LOW (post E2)

After E2's route-tree fix, `/demo/projects`'s `pageUse` no longer composes onto `/demo/projects/:projectId/issues/:issueId`. The demo's `issue.server.ts` and `project-issues.server.ts` still need their own `pageUse` since `/demo/projects/:projectId` (the layout) has no `.server.ts`. So actually no change to the demo's pageUse exports is needed — but verify the test asserts the chain runs once per request, not twice.

### E14. Test: literal-vs-param tiebreaker (E1) [R5#5] — MEDIUM

Add a test with two route entries at the same depth — `/admin/users/me` (literal) and `/admin/users/:id` (param) — and assert the URL `/admin/users/me` picks the literal's pageUse.

### E15. Test: route-tree ancestor composition (E2) [R5#5] — MEDIUM

Add a test with a layout at `/admin` (with `server`+`pageUse`) and a sibling layout-group `/admin/users/:userId` (no `server`, with child `/admin/users/:userId/edit` with `server`+`pageUse`). Assert that `pageUse` of `/admin` composes into the edit leaf, but `pageUse` of `/admin/users` (if it had one) would NOT compose into `/admin/orders/:id`. URL-prefix would have incorrectly composed.

### E16. Test: `makePageUseResolvers` retry-on-error (resolver retry path) [R5#18] — MEDIUM

The docstring claims a failed build doesn't permanently poison the resolver. Add a test where the first `server()` call rejects; the second call succeeds; assert the second build's result is cached.

### E17. Test: empty `serverRoutes` [R5#5] — LOW

`makePageUseResolvers([])` should return empty arrays from both `byPath` and `byModuleKey`. One smoke test.

### E18. Test: querying a layout's own pattern directly [R5#5] — LOW

Assert `byPath('/admin')` returns the layout's own `pageUse` (since it has no further ancestors).

### E19. Test: dev mode rebuilds the resolver (E4) — MEDIUM

Assert that with `dev: true`, two consecutive `byPath` calls load the underlying server module twice (i.e. the resolver doesn't cache across calls).

### E20. Test: stream observer fanout end-to-end (E3) — CRITICAL

Add an integration test that attaches a `defineStreamObserver` to a streaming loader, dispatches through `loadersHandler`, and asserts `onStart` → `onChunk` × N → `onEnd` fire in order with the right arguments. Symmetric for actions.

### E21. Generated entry signature change [supports E2/E4] — MEDIUM

If E2 changes `ServerRoute` shape to include `ancestors`, and E4 adds `dev` to `makePageUseResolvers`, the generated entry in `server-entry.ts:generateCoreAppModule` must be updated to thread the new shape. Update tests in `server-entry.test.ts` accordingly.

### E22. Remove `makePageUseResolvers` from public surface? [R2#6] — LOW

The only consumer outside tests is the generated entry. Consider moving it to `hono-preact/server/internal` or noting in a code comment that this is framework-private. Defer if it complicates the consolidate.mjs publish step.

### E23. Drop the `as ReadonlyArray<Middleware>` cast in handler chain composition [R2#7] — LOW

`loaders-handler.ts:237`, `actions-handler.ts:235`. The cast lies (the array can contain observers). Drop and let `partitionUse` type its input as `ReadonlyArray<Middleware | StreamObserver<unknown, never>>`.

### E24. Tighten `LoaderRef.use` type [R2#13] — LOW

Currently `ReadonlyArray<unknown>`. Tighten to `ReadonlyArray<Middleware | StreamObserver<unknown, never>>` to advertise the contract the handlers depend on.

---

## Agent F — vite plugins consolidation + diagnostics + cleanup

**Files:** `packages/vite/src/server-only.ts`, `packages/vite/src/server-loader-validation.ts`, `packages/vite/src/server-loaders-parser.ts`, `packages/vite/src/server-entry.ts`, `packages/vite/src/__tests__/server-only-plugin.test.ts`, `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`, `packages/vite/src/__tests__/server-loaders-parser.test.ts`, `packages/vite/src/__tests__/server-entry.test.ts`.

### F1. Three lists of recognized `.server.*` exports drift independently [R3#4, R5#15] — MEDIUM

`server-only.ts:273` hard-coded error string, `server-loader-validation.ts:6` Set, `server-loaders-parser.ts:16` Set. All agree today; future addition to one will silently miss the others.

**Fix:** Hoist a shared `RECOGNIZED_SERVER_EXPORTS` constant in (e.g.) a new `packages/vite/src/server-exports-contract.ts`. Import it everywhere. Update all three test files to assert via the shared constant.

If Agent E settles on dropping `loaderUse`/`actionUse` (E7 option a), the shared list shrinks to `serverLoaders`, `serverActions`, `pageUse`.

### F2. Wire `hasNamedUseExport` into the validation path [R3#1, R5#8] — LOW (paired with F1)

If `RECOGNIZED_USE_EXPORTS` and `hasNamedUseExport` stay, use them in `server-loader-validation.ts` instead of the inline Set check. Otherwise drop them (D8). Pick one.

### F3. Validate `pageUse` is an array literal at build time [E5 partner] — MEDIUM

`server-loader-validation.ts` should fail the build when a `.server.*` file exports `pageUse` (or `loaderUse`/`actionUse`) with a value that isn't an `ArrayExpression`. Detect via the existing Babel AST walk. This catches the typo `pageUse = mySingleMw` at build time rather than relying on the runtime guard (E5).

### F4. `appConfig` user file must be a default export [R3#9] — MEDIUM

`server-entry.ts:30`. The generated module does `import appConfig from '${appConfigAbsPath}'`. If a user wrote `export const appConfig = defineApp({...})` instead of `export default`, the import is `undefined` and the middleware silently never runs.

**Fix:** Add a `buildStart` diagnostic that parses the user's `app-config.ts` looking for an `ExportDefaultDeclaration`. If absent, fail the build with a clear "app-config.ts must default-export the result of defineApp(...)".

### F5. `appConfig: string` plugin option is required-typed but defaulted [R3#11] — LOW

`server-entry.ts:237`. `ServerEntryPluginOptions.appConfig` is typed as required (no `?`). `hono-preact.ts:38` always supplies the default. Either make it optional with an internal default, or drop the "absence treated as empty" JSDoc.

### F6. Guard-strip whole-call replacement fn arity [R3#5] — LOW

The replacement is `fn: () => Promise.resolve()` (arity 0). A user inspecting `mw.fn` outside the framework will see the wrong shape. Change to `fn: (_ctx, next) => next()` for better simulation of the documented `(ctx, next) => Promise<void | Outcome>` shape. Framework path doesn't call `mw.fn` (filter on `runs` excludes wrong-env), so this is cosmetic but matches documentation.

### F7. Server-only `.server.*` skip vs the server-bundle's defineClientMiddleware imports [R3#6] — LOW

`guard-strip.ts` excludes `.server.*` files from rewriting in both bundles. Server-bundle includes `.server.*` natively. Verify no user can land a `defineClientMiddleware` in a `.server.*` file that survives to the server bundle (probably impossible by validation, but worth a comment).

### F8. Insertion-order brittleness in validation error message [R3#3] — LOW

`server-loader-validation.ts:11-13`. The list is iterated in Set insertion order. Stable per spec but a future reorder won't be caught. Add an ordered-list regex test: `expect(error).toMatch(/serverActions.*serverLoaders.*pageUse/)`.

### F9. `serverActions` Proxy stub identity [R3#15] — LOW

`server-only.ts:248-256`. Each `.get(action)` returns a new ActionStub object; `serverActions.create !== serverActions.create` across reads. Not new in this PR. Worth a comment.

### F10. Sweep for legacy refs in vite plugin source [R3#17] — LOW

Cleanup pass: any leftover prose in vite plugin files mentioning `defineActionGuard`, `actionGuards`, etc. should be scrubbed (excluding negative-assertion tests).

### F11. Test: validation rejects `pageUse = singleMw` (F3 partner) — MEDIUM

After F3, add a test asserting non-array `pageUse` fails the build with a clear message.

### F12. Test: appConfig must be default-exported (F4 partner) — MEDIUM

After F4, add a test asserting a `app-config.ts` without `export default` fails the build.

---

## Cross-agent verification (post-merge)

After all 6 agents land:

1. `pnpm typecheck` — clean.
2. `pnpm vitest run` — all green.
3. `pnpm test:integration` — all green.
4. `pnpm format:check` — clean.
5. `pnpm build` — all packages + apps/site build.
6. Smoke the demo: `pnpm dev`, click through `/demo/login` → projects → issue. Verify the auth gate fires exactly once per request (E13 check). Try closing an issue you don't own; verify the deny message lands as `Error.message` in the optimistic action's onError (C7 sanity).
7. Manually verify `docs/middleware` renders and every import path in the page resolves at type-check.

## What's intentionally out of scope

These came up in the review as design observations but aren't fixed here:

- The dispatcher doesn't read `AbortSignal` (A6 is a test gap; the underlying behavior is by design).
- Adding an `'app'` scope for app-level mw (E9 picks docs-only resolution).
- Replacing the linear `byPath` scan with a trie (E6 is a perf note).
- The legacy `loaderUse`/`actionUse` allowlist if Agent E picks the "drop them" path (E7).
- Same-origin redirect validation in the client (C4 picks docs-only resolution, deferred for v0.2).

## Open coordination questions

- **D vs E share `server-entry.ts`?** No — D doesn't touch it. E owns all server-entry.ts changes.
- **A vs C share `outcomes.ts`?** No — only C touches outcomes.ts; A leaves it alone.
- **E vs F share validation work?** F3 (validation plugin) and E5 (runtime guard) are intentionally paired. F3 catches misuse at build; E5 catches it at runtime if F3 missed.
- **Worktree merge order?** A → C → B → E → D → F minimizes test regressions (each builds on the previous's stable types/exports).
