# Unify streaming consumption into `loader.View` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). The core task is hydration-sensitive and must be verified in a real browser (the `/demo` harness), which subagents cannot drive, so this plan is executed inline by the controller, not blind-subagent TDD. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the bare `loader.useStream` hook with an accumulating `loader.View` mode so live streams hydrate cleanly via the same Suspense + `useId` machinery as every other loader consumer.

**Architecture:** `LoaderHost`/`useLoaderRunner` gain live-awareness (SSR renders the fallback directly, no loader run, no suspend; client takes the existing no-preload fetch branch, suspends until the first chunk, folds chunks) and an optional `{ initial, reduce }` accumulator. `.View` exposes the accumulating form. `useStream` is removed.

**Tech Stack:** preact / preact-iso (`renderToStringAsync` SSR), Vitest + happy-dom, the running site dev server + firefox-devtools MCP for hydration verification.

## Global Constraints

- No em-dashes in prose, comments, commit messages.
- A `live` loader's fn must NEVER be invoked during SSR (`renderToStringAsync` awaits thrown promises; an infinite generator would hang the document). SSR for a live loader renders the fallback directly.
- Clean hydration requires the live `LoaderHost` to render a `useId`-anchored element on BOTH the SSR pass (fallback) and the client pass (suspended fallback, then resolved), so Preact adopts the SSR DOM.
- `.View` stays the single consumption convention. No new top-level hook.
- Run from the worktree root. Pre-push CI mirror is 7 steps (build, format:check, typecheck, test:types, test:coverage, test:integration, site build).
- This work revises PR #133 on branch `worktree-persist-as-layout-spike`; commit onto it.

## Current state to build on (exact)

- `define-loader.ts:74-83` `View<P>(render: (args: P & { data: T; error; reload }) => Children, opts?: { fallback?; errorFallback? }): ComponentType<P>`.
- `define-loader.ts:241-285` the ref methods: `useData()`/`Boundary`/`View` each `throw` when `live`; `useStream(opts){ return useLoaderStream(ref, opts) }`.
- `define-loader.ts:65` `useStream<Acc>(opts: UseStreamOptions<T, Acc>): UseStreamResult<Acc>` on `LoaderRef`.
- `loader.tsx:29-80` `LoaderHost({ loader, location, fallback, errorFallback, children })` → `useLoaderRunner(loaderRef, location, id)` → `<Suspense fallback><DataReader reader overrideData><Envelope>{children}</Envelope></DataReader></Suspense>`.
- `use-loader-runner.tsx` returns `{ reader, overrideData, error, reload, reloading }`; non-preload first-render branch (~L183-222) calls `runLoader` (client → `/__loaders` fetch, suspends via `wrapPromise`); `onChunk` does `setOverrideData(value)` (overwrite); the live ref's fn is only reached on the direct-fn (SSR) path of `runLoader` (loader-runner.ts L85+).
- `StreamStatus = 'connecting' | 'open' | 'closed' | 'error'` (keep); `UseStreamOptions`/`UseStreamResult`/`useLoaderStream` (remove).

---

### Task 1: Core, live-aware `LoaderHost` + accumulation (hydration de-risk)

**This is the load-bearing task. Build it, then VERIFY IN THE BROWSER before proceeding.**

**Files:**
- Modify: `packages/iso/src/internal/use-loader-runner.tsx` (add live-aware SSR skip + `{ initial, reduce }` accumulation + status)
- Modify: `packages/iso/src/internal/loader.tsx` (`LoaderHost`: accept `accumulate`/`fallback` for live; SSR direct-fallback; thread `status`)
- Temporary: `apps/site/src/components/demo/ActivityBar.tsx` (a throwaway `.Boundary`-style wiring just to drive the browser check)

- [ ] **Step 1: `useLoaderRunner` live-aware + accumulation.**
  - Add optional 4th arg `accumulate?: { initial: unknown; reduce: (acc: unknown, chunk: unknown) => unknown }`.
  - When `loaderRef.live && !isBrowser()`: return a state whose `reader` resolves synchronously to a sentinel meaning "render fallback" (do NOT call `runLoader`; do NOT throw a promise). Surface `status: 'connecting'`.
  - When `loaderRef.live && isBrowser()`: take the existing no-preload fetch branch (it already suspends on the first chunk and pumps `onChunk`). When `accumulate` is set, replace `setOverrideData(value)` with `setOverrideData(prev => reduce(prev === undefined ? initial : prev, value))` for BOTH the first value and each `onChunk`, so every chunk folds. Derive `status` (`connecting` until first chunk, then `open`; `closed` on `onEnd`; `error` on error).
  - Return `status` alongside `{ reader, overrideData, error, reload, reloading }`.
- [ ] **Step 2: `LoaderHost` SSR direct-fallback + status.** For a `live` loader on `!isBrowser()`, render the `fallback` inside the same `LoaderIdContext`/`Envelope`-anchored structure (so the element carries the `useId`) WITHOUT going through a suspending reader. On the client, render the normal `<Suspense fallback>` path. Thread `status` into the `DataReader`/render args (a new `LoaderStatusContext` or extend `LoaderDataContext` value to `{ data, status }`).
- [ ] **Step 3: Temporary browser wiring.** Wire `ActivityBar` to consume the live loader through `LoaderHost` with `{ initial: [], reduce }` + a `<ConnectingBar/>` fallback (rough is fine; this is to drive the check). Remove the `isBrowser` guard.
- [ ] **Step 4: Build + run + VERIFY HYDRATION IN BROWSER.**
  - `pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build`
  - Site dev server (already running on :5173, else `pnpm --filter site dev`).
  - Via firefox-devtools MCP: log in at `/demo/login`, land on `/demo/projects`, screenshot.
  - Expected: EXACTLY ONE activity bar (no overlapping empty orphan), accent dot once connected, count climbing. Inspect the DOM (`take_snapshot selector .demo-activity-bar`) to confirm a single element.
  - If TWO bars / orphan persists: STOP. The SSR-direct-fallback approach did not adopt the SSR DOM; escalate to reconsider the fallback `useId` anchoring (the spec's flagged risk).
- [ ] **Step 5: Commit the verified core.**
  ```bash
  git add packages/iso/src/internal/use-loader-runner.tsx packages/iso/src/internal/loader.tsx apps/site/src/components/demo/ActivityBar.tsx
  git commit -m "feat(iso): live-aware LoaderHost (SSR fallback) + chunk accumulation"
  ```

---

### Task 2: `.View` accumulating API + guard rework

**Files:**
- Modify: `packages/iso/src/define-loader.ts` (`LoaderRef.View` overload; ref `View`/`Boundary` guard rework; pass `{ initial, reduce }` + `fallback` through)
- Modify: `packages/iso/src/internal/view-renderer.tsx` (surface `status` to the render fn)
- Test: `packages/iso/src/__tests__/define-loader-view-stream.test.tsx` (create)

**Interfaces:**
- Produces: `loader.View<Acc, P>(render: (args: P & { data: Acc; status: StreamStatus; error; reload }) => Children, opts: { initial: Acc; reduce: (acc: Acc, chunk: T) => Acc; fallback?; errorFallback? }): ComponentType<P>` alongside the existing single-value overload. For a `live` loader, the single-value form throws; the accumulating form is required.

- [ ] **Step 1: Overload `LoaderRef.View`** with the accumulating signature (data `Acc`, plus `status`). Keep the existing single-value overload.
- [ ] **Step 2: Rework the ref guards.** `.View`/`.Boundary` no longer throw for `live`; instead, `.View` for a `live` loader throws ONLY when `initial`+`reduce` are absent ("a live loader must be consumed via `loader.View(render, { initial, reduce })`"). `Boundary` passes `accumulate`/`fallback` to `LoaderHost`. Keep `useData()` throwing for `live`.
- [ ] **Step 3: Surface `status`** from `useLoaderRunner` through `ViewRenderer` into the render args (streaming form only).
- [ ] **Step 4: Tests** (`define-loader-view-stream.test.tsx`, happy-dom + the `dripSseResponse` SSE-mock harness): every chunk reaches `reduce` (accumulation, no coalescing loss); `status` transitions connecting → open → closed; the single-value `.View` form on a live loader throws; the accumulating form does not.
- [ ] **Step 5:** `npx vitest run packages/iso/src/__tests__/define-loader-view-stream.test.tsx` → PASS. Commit.

---

### Task 3: Migrate the demo bar to `.View`

**Files:**
- Modify: `apps/site/src/components/demo/ActivityBar.tsx` (final form via `.View`)
- Modify: `apps/site/src/components/demo/__tests__/ActivityBar.test.tsx` (retarget off the `useStream` mock)

- [ ] **Step 1:** Rewrite `ActivityBar` to its final form: `const ActivityFeed = activityLoader.View<ActivityEvent[]>(({ data, status }) => <BarUI .../>, { initial: [], reduce, fallback: <ConnectingBar/> })`. No `isBrowser` guard, no `useStream`.
- [ ] **Step 2:** Retarget the test: the bar's rendering test mocks the `.View`-produced component's inputs (or the loader module) and asserts the rendered feed/count/expand from given `data`/`status`. Keep it a rendering test (transport covered in Task 2).
- [ ] **Step 3:** `cd apps/site && npx tsc --noEmit && cd ../..`; `npx vitest run apps/site/src/components/demo/__tests__/ActivityBar.test.tsx` → PASS. Browser re-verify one bar. Commit.

---

### Task 4: Remove `useStream`

**Files:**
- Delete: `packages/iso/src/internal/use-loader-stream.tsx`, `packages/iso/src/internal/__tests__/use-loader-stream.test.tsx`
- Modify: `packages/iso/src/define-loader.ts` (remove `useStream` from `LoaderRef` + the ref; remove the `useLoaderStream` import + the type re-exports for `UseStreamOptions`/`UseStreamResult`; keep `StreamStatus`)
- Modify: `packages/iso/src/index.ts` (drop `UseStreamOptions`/`UseStreamResult` exports; keep `StreamStatus`)

- [ ] **Step 1:** `git rm` the two files.
- [ ] **Step 2:** Remove `useStream` from the `LoaderRef` interface and the ref object; remove the `useLoaderStream` import and the `UseStreamOptions`/`UseStreamResult` re-exports (keep `StreamStatus`, now produced by `use-loader-runner`/a small types module). Update the barrel.
- [ ] **Step 3:** `rg -n "useStream|UseStreamOptions|UseStreamResult|useLoaderStream" packages apps` → no matches (except `StreamStatus`). Build framework dist; `npx vitest run packages/iso` → PASS. Commit.

---

### Task 5: Docs, release note, CI mirror, final verification

**Files:**
- Modify: `apps/site/src/pages/docs/live-loaders.mdx` (document `.View` accumulation, not `useStream`)
- Modify: `docs/superpowers/specs/2026-06-18-v0.8-release-notes.md` (if still present, swap `useStream` for `.View` accumulation; otherwise skip per the earlier release-note decision)
- Modify: `client-size-report.json` (regenerate)

- [ ] **Step 1:** Update `live-loaders.mdx`: the consumption example is `loader.View({ initial, reduce, fallback })`; remove `useStream` references; no em-dashes; no migration breadcrumbs.
- [ ] **Step 2:** Read `.claude/skills/add-docs-page.md` and conform; ensure `live`, `.View` accumulation, and `StreamStatus` are documented (exports-coverage gate).
- [ ] **Step 3:** Regenerate llms (site build) + `node scripts/measure-client-size.mjs`.
- [ ] **Step 4: Full 7-step CI mirror:**
  ```bash
  pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
  pnpm format:check
  pnpm typecheck
  pnpm test:types
  pnpm test:coverage
  pnpm test:integration
  pnpm --filter site build
  ```
  All green (run `pnpm format` if format:check fails).
- [ ] **Step 5: Final browser verification** of the production-ish path (one bar, accumulates, connected), then commit docs + baselines.

## Self-Review

**Spec coverage:** `.View` accumulating mode → Task 2; `LoaderHost` live-aware SSR-fallback + accumulation → Task 1; guard rework → Task 2; remove `useStream` → Task 4; demo migration → Task 3; hydration verification (load-bearing) → Task 1 Step 4 + Task 3 + Task 5; docs/release/CI → Task 5. All spec sections covered.

**Placeholder scan:** Task 1's core is intentionally iterative (browser-verified), not blind TDD, this is called out in the header and is appropriate for a hydration-sensitive change; every other task has concrete files/commands. No `TODO`/`add error handling`.

**Type consistency:** `StreamStatus` is the single status type throughout; the `.View` accumulating signature (`data: Acc`, `reduce: (acc: Acc, chunk: T) => Acc`, `initial: Acc`, plus `status`) is consistent across Tasks 1-3. `useStream`/`UseStreamOptions`/`UseStreamResult` are removed consistently in Task 4.

## Open questions (resolve during Task 2)

- The `.View` overload typing so `data` is `Acc` (accumulating) vs `T` (single-value) without an `as` cast. Prefer two real overload signatures keyed on the presence of `initial`+`reduce`.
- `status` is streaming-only (not added to the single-value render args), to avoid churn.
