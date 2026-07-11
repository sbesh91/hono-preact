# REVIEW.md

The canonical checklist for reviewing a PR or working diff in `hono-preact`.
`CLAUDE.md` points here; update this file (not that section) when the criteria
change.

## Stance

Review as a seasoned full-stack JavaScript web-framework developer. The bar is
framework-grade: this code does not ship to one app, it ships into every app
built on `hono-preact`, `hono-preact-ui`, and `create-hono-preact`. A regression
or a sloppy abstraction here multiplies across every consumer and is expensive
to walk back once released. Bias toward the long-term health of the framework
over the convenience of the diff. "Smaller now, upgrade later" is not a reason;
pick the right design on merit.

Be concrete. Cite `file:line`. Triage every finding by severity (see the rubric
at the end). Do not perform agreement; if something is wrong, say so and show
why.

## How to run a review

1. Get the diff. `gh pr diff <n>` for a PR, or `git diff origin/main...HEAD` for
   a local branch. Read the whole diff before commenting on any part of it.
2. Establish the pre-PR baseline for parity work. Find the merge-base sha and
   read deleted or renamed files via git history (`git show <pre-PR-sha>:path`),
   not just the diff hunks.
3. Walk the six lenses below, then the repo-specific must-checks, then confirm
   the CI-parity gate.
4. Report by severity. A P0 blocks merge.

## The six lenses

### 1. Performance

- **Hot paths.** Routing/match, loader fetch and serialize, SSR render, the
  hydration path, and nav-transition scheduling run on every request or every
  navigation. Look for accidental O(n^2), per-request work that could be hoisted
  to module init or build time, and allocations in those loops.
- **SSR streaming.** Backpressure must be honored (multi-loader streaming
  backpressure has regressed before). Do not buffer the whole document when it
  can stream; preserve TTFB.
- **Hydration cost.** Minimize client work on mount. Watch for the
  Suspense+hydration double-mount trap on client redirects. Do not hydrate
  content that is static.
- **Caching and dedup.** Loader cache hits, request dedup, no redundant fetches
  on navigation. Confirm nav/view-transition scheduling does not force
  synchronous layout.
- **Animation.** Never re-measure mid-animation (FLIP jitter); read once, then
  animate.

### 2. Maintainability

- **No god-files.** Single responsibility per module. The repo's stated value is
  modularity over brevity; code golf jeopardizes the long term. Large functions
  that mix concerns (e.g. a render-and-stream-and-shell monolith) should be
  factored into named modules.
- **Casts are smells.** Prefer reshaping the type over an `as`. See the
  `Type casts` section of `CLAUDE.md` for the standard reshapes (symbol-keyed
  reads, literal widening, post-check predicates) and the genuinely acceptable
  cast boundaries (untrusted JSON, FormData, user-module structural reads). A
  cast prescribed in a plan ships as a cast unless a reviewer catches it.
- **Public/internal boundary.** New surface should not leak into the public
  barrel casually; runtime-only internals belong behind the `/internal/runtime`
  doors. Keep package barrels curated.
- **Naming and contracts.** Consistent naming across `iso`/`ui`/`server`;
  standardized prop and data-attribute contracts. Do not introduce a second name
  for an existing concept.
- **Comments are claims, not proof.** Do not trust a comment that says "X is
  preserved" or "folded in elsewhere"; treat it as a hypothesis and verify the
  code it points to.
- **Docs describe what is, not what changed.** No "replaces the legacy X" /
  "formerly Y" breadcrumbs in `apps/site` docs.
- **Error messages.** New failure modes should fail with a sharp, actionable
  message, in keeping with the rest of the framework.

### 3. Effective testing

- **TDD.** Tests precede the implementation they cover.
- **A passing regression test proves nothing on its own.** A test that passes
  against the unmodified code is not a regression test. Mutation-check it: break
  the code, confirm the test fails, restore.
- **Cross-package reach.** A change to a public API must run the *consuming*
  packages' suites via `pnpm test:coverage`; build and typecheck skip test
  files, so a green build hides consumer breakage.
- **Verify claims yourself.** Do not accept a "this test fails" or "pre-existing
  failure" claim secondhand; run it.
- **Right test for the layer.** Type contracts get `*.test-d.ts` under
  `pnpm test:types`; dev-server and WebSocket behavior gets the isolated
  `pnpm test:integration`; everything else is unit-tested.
- **Test behavior, not implementation.** When a refactor moves code, retarget
  the existing tests; do not delete them. Cover the new branch's edge cases
  (timeouts, redirects, error envelopes, empty/zero states).

### 4. Modularity

- **Factor, don't inline.** Codegen, request-handling, and resolver concerns
  belong in named single-responsibility modules, not inline mega-functions.
- **Dedup only what is genuinely identical.** Shared positioner/option-group/
  hook abstractions are good when the call sites are byte-identical in behavior;
  do not force-merge code that has diverged or will diverge for different jobs.
- **Dependency wiring.** A new runtime dependency must also be declared on the
  umbrella package and added to every build `--filter` that needs it (a package
  silently falling out of the `@hono-preact/*` filter has bitten the site build
  before). A new `vite` runtime dep goes on the `hono-preact` umbrella too.
- **One unit of work per change.** Each primitive carries its own spec/plan/PR;
  unrelated cleanups do not ride along silently.

### 5. Bundle size

- **The size gate is real.** The PR-only `client-size` CI job measures framework
  runtime per feature and UI components (gzip, marginal over core / ui-core) and
  posts a sticky comment. Read it. An unexplained increase is a finding.
- **Pay only for what you use.** Does this add to the client payload for users
  who never touch the feature? Modules must be tree-shakeable and side-effect
  free (`/* @__PURE__ */` annotations where a bundler needs the hint). No eager
  import that drags optional or server-only code into the common chunk.
- **Server stays off the client.** `.server` files and the `/internal/runtime`
  doors keep server code out of the client bundle; importing `serverLoaders`
  into client code is the documented, build-enforced mechanism
  (`serverLoaderValidationPlugin`), but watch for an accidental client import of
  a server module.
- **Platform over dependency.** Prefer a web-platform API to a new dependency
  when it is close in ergonomics; every dep is bytes plus a maintenance surface.
- **Code-split route data** and lazy-load where it pays for itself.

### 6. Effective use of web platform features

- **Lean on the platform.** This framework is built on View Transitions,
  Speculation Rules, `TransformStream` streaming/SSE, `URL.parse`, FormData and
  progressive-enhancement forms, WebSocket, top-layer/Popover, `@starting-style`,
  and native navigation. Prefer the platform primitive to a reimplementation.
- **Check Baseline support before relying on an API.** Not everything is
  Baseline: `subscribeViewTransitionTypes` fires only inside
  `startViewTransition`, so nav-gating uses a `popstate` + `pushState` wrap
  instead. Honor the documented browser-support constraint for UI primitives.
- **Progressive enhancement is first class.** Forms must work without client JS;
  the JS layer enhances, it does not gate.
- **Navigation side effects.** URL writes interact with the router and the
  view-transition scheduler in non-obvious ways: the scheduler classifies a
  flush as a navigation by comparing pathname + search, so a hash-only write
  (an in-page anchor) never animates, and an in-app `<a>` to a non-route URL
  soft-navigates to not-found unless it is a native-nav link
  (`target`/`download`). Flag any new URL write or in-app link that has not
  accounted for both. Two residual hazards to check: a same-path hash link
  produces no navigated flush, so a scroll-on-fragment effect must key on
  location (e.g. `useLocation().url`), not on the view-transition lifecycle
  (`afterSwap`/`afterTransition`), which never fires for it; and
  `skipNextNavTransition` should be armed keyed to its target URL unless the
  call site genuinely wants the wildcard (unkeyed) arm, since a keyed arm
  self-clears on a mismatched navigation instead of stranding onto the wrong
  one.
- **Accessibility.** `hono-preact-ui` is a headless primitives library: verify
  ARIA roles, id wiring (e.g. `listboxId`), focus management, and keyboard
  navigation for any interactive primitive.

## Repo-specific must-checks

These ride on top of the six lenses and have each blocked a merge before.

- **Replacement parity.** When a PR replaces or rewrites a subsystem (handler,
  hook, plugin, generated entry, resolver), enumerate every behavior the
  predecessor had and verify each one survives in the replacement. Read the
  deleted or renamed files via git history. Do not trust comments that claim a
  behavior is preserved; confirm by reading the code they point to.
- **Cross-cutting concerns end-to-end.** For each request path the PR touches,
  trace middleware composition, auth/permission gates, caching, observability
  hooks, and error reporting all the way through the new path and compare to the
  pre-PR path. A silently dropped middleware layer, especially anything auth- or
  permission-adjacent, is a **P0** that blocks merge.
- **Public-API and breaking-change surface.** Diff the public export surface
  against the last release tag. Some breaking changes are *invisible* in that
  diff and still require a release note: a removed method on a kept type (e.g.
  `LoaderCache.wrap`), an `engines.node` bump, or a type reshape that changes the
  serialized wire format (`Serialize<T>`). If it can break a consumer, it needs a
  release note.
- **Docs sync.** A `packages/` change that adds, renames, or removes a public
  symbol must update `apps/site/src/pages/docs/` in the same PR (the
  `keep-docs-fresh` hook warns on this). Regenerate the bundled docs corpus
  (`pnpm gen:agents-corpus`). Note the appendix-sync gate checks subpaths, not
  export names, so a stale `AGENTS.md` export list can pass CI green; check it by
  hand.

## Pre-merge gate: CI parity

The reviewer confirms the eight checks that mirror `.github/workflows/ci.yml`
have been run locally, in order (full detail in `CLAUDE.md`):

1. build framework packages (`@hono-preact/*` + `hono-preact` + `hono-preact-ui`)
2. `pnpm gen:agents-corpus`
3. `pnpm format:check`  (the single most-missed step; trivially fixable with `pnpm format`)
4. `pnpm typecheck`
5. `pnpm test:types`
6. `pnpm test:coverage`
7. `pnpm test:integration`
8. `pnpm --filter site build`

Lighthouse, `client-size`, and the docs preview run in CI only; read their PR
comments rather than running them locally.

## Severity rubric

- **P0 (blocks merge):** dropped auth/permission middleware layer; lost behavior
  parity in a replaced subsystem; SSR/hydration regression; data corruption;
  public API broken without a release note; security issue.
- **P1 (fix before merge, or file and justify):** performance regression on a
  hot path; bundle-size increase without justification; new behavior shipped
  without tests; a cast that should have been a type reshape; a missing
  Baseline-support guard.
- **P2 / nit:** naming, style, comment and doc polish, non-load-bearing
  simplifications.
