# Framework bug: client-middleware redirect during hydration double-mounts routes

**Date:** 2026-05-30 (resolved 2026-05-31)
**Status:** FIXED on the consumer side. Root cause is expected Preact behavior, not an upstream bug.
**Severity:** P1 (routing path). Latent: only triggers when a client middleware redirects (or renders an alternative) on initial page load.

## Symptom

On a same-document load where a client middleware redirects (e.g. an auth
guard bouncing to `/demo/login`), the browser ends up rendering BOTH the
original route and the redirect target stacked in the same `<main>`, instead of
only the target. The previous route's DOM is never removed.

Discovered while fixing the demo login flow: once login succeeded (see the
`form.tsx` action-identity fix), landing on `/demo/projects` with the client
guard redirecting showed projects + login together.

## Reproduction

1. Fresh browser (no `localStorage['demo:authed']`), valid session cookie.
2. Load `/demo/projects` directly (server guard passes, SSR renders projects).
3. Client hydrates; `requireSessionClient` sees no flag and redirects to
   `/demo/login`.
4. Result: both the projects page and the login page render in `<main>`.

SSR HTML for `/demo/projects` is clean (only projects); the duplication is
entirely client-side. Validated end-to-end in a real browser with a patched-vs-
stock Preact A/B (a temporary `/ztest` route with a client-only always-redirect
middleware): the orphaned-marker count goes from 1 (stock) to 0 (fixed).

## Root cause (REVISED 2026-05-31)

The original write-up blamed preact-iso v3's `Router` route-retention. That was
WRONG. A standalone repro with plain Preact `hydrate()` + `<Suspense>` and ZERO
preact-iso reproduces the orphan, which localized the cause to **Preact's
Suspense + hydration**:

1. `PageMiddlewareHost` wraps the middleware chain in `<Suspense>`. On the
   initial load the boundary suspends during hydration (the async client chain
   runs) and then resolves to content that does NOT match the server-rendered
   DOM, e.g. `null` for a redirect, or a different component for `render()`.
2. Preact deliberately preserves the server-rendered DOM on such a hydration
   mismatch and surfaces a visible failure rather than throwing the DOM away.
   That orphaned server DOM is what preact-iso's Router then stacks the redirect
   target on top of. The Router is an amplifier, not the cause.

This was confirmed with the Preact maintainers (Jovi De Croock): it is
**expected behavior**. Suspense boundaries that resolve to something on the
server and nothing on the client are a known, unsupported case; the scalable
marker-based hydration architecture lives in preactjs/preact#4442 (v11). An
exploratory upstream patch (preactjs/preact#5107) was closed for this reason.
The fix therefore belongs on the consumer (hono-preact) side.

## Fix (shipped): defer the initial-load client chain to post-hydration

In `packages/iso/src/internal/page-middleware-host.tsx`, `PageMiddlewareHost`
chooses a render strategy once per mount (`isBrowser() &&
!hasClientNavigated()`, captured in a ref so hook order stays stable):

- **Initial document load -> `DeferredHost`:** render the server `children`
  during hydration (so the hydrated DOM matches SSR and nothing is orphaned),
  then run the client chain in a `useEffect` and apply the outcome
  post-hydration: `redirect` -> SPA `route()`, `render(Alt)` -> `useState` swap,
  `deny` -> throw, pass -> keep children.
- **Server render and post-navigation client renders -> `SuspenseHost`:** the
  prior behavior (suspend on the chain, render the outcome). No hydration to
  mismatch here. `HostConsumer`'s redirect effect is a plain `route()`.

This removes the mismatch at the root, so the orphan can no longer occur, and it
covers ALL client outcome types (not just `redirect`). It supersedes the earlier
hard-navigation idea, which was correct but narrow (redirect-only) and heavy (a
full page reload). Trade-off: a brief flash of SSR content before a client
redirect/swap, but that content is already on screen from SSR, so it is not a
regression. The only unhandled case is a SERVER `render(Alt)` plus a different
client outcome, which is a genuine user-code mismatch and out of scope.

## History

- The demo-level mitigation (`login.tsx` sets `localStorage['demo:authed']` at
  sign-in) removed the only demo trigger and still ships; it is independent of
  this framework fix.
- The framework fix is on PR #63
  (`fix(iso): avoid client-redirect double-mount by deferring initial-load
  middleware to post-hydration`).
