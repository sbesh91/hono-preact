# Framework bug: client-middleware redirect during hydration double-mounts routes

**Date:** 2026-05-30
**Status:** Root-caused, NOT fixed. Trigger removed in the demo; needs a dedicated fix.
**Severity:** P1 (routing path). Latent: only triggers when a client middleware redirects on initial page load.

## Symptom

On a same-document load where a client middleware redirects (e.g. an auth
guard bouncing to `/demo/login`), the browser ends up rendering BOTH the
original route and the redirect target stacked in the same `<main>`, instead of
only the target. The previous route's DOM is never removed.

Discovered while fixing the demo login flow: once login succeeded (see the
`form.tsx` action-identity fix), landing on `/demo/projects` with the client
guard redirecting showed projects + login together.

## Reproduction (before the demo guard fix)

1. Fresh browser (no `localStorage['demo:authed']`), valid session cookie.
2. Load `/demo/projects` directly (server guard passes, SSR renders projects).
3. Client hydrates; `requireSessionClient` sees no flag and redirects to
   `/demo/login`.
4. Result: both the projects page and the login page render in `<main>`.

SSR HTML for `/demo/projects` is clean (only projects); the duplication is
entirely client-side.

## Root cause

The interaction between hono-preact's redirect handling and preact-iso v3's
`Router` route-retention:

1. On initial load, the route's `PageMiddlewareHost`
   (`packages/iso/src/internal/page-middleware-host.tsx`) runs client
   middleware asynchronously and SUSPENDS. During hydration Preact keeps the
   server-rendered DOM (projects) on screen while suspended.
2. The middleware chain resolves to a `redirect` outcome. `HostConsumer`
   returns `null` for the redirecting route and schedules
   `route(redirectTo)` in a `useEffect`.
3. preact-iso's `Router` (`node_modules/.../preact-iso/src/router.js`) keeps
   the previous route's committed DOM as `prev` while the incoming route loads
   (router.js ~line 211, `prev.current = p`, dropped to `null` only once the
   new route un-suspends). The timing of the hydration-suspended redirect plus
   the effect-driven `route()` leaves the previous (projects) committed DOM
   mounted alongside the login route.

The bug lives in preact-iso's Router (a pinned GitHub-tarball dependency:
`preact-iso@github:preactjs/preact-iso#v3`), exposed by hono-preact performing
the client redirect via an effect + `route()` after the original route has
already committed its hydrated DOM.

## Candidate fixes (not yet implemented)

- **hono-preact workaround (preferred to evaluate first):** in
  `PageMiddlewareHost`/`HostConsumer`, detect a redirect that fires on the
  initial load (before any client-side navigation has occurred) and perform a
  hard navigation (`window.location.assign(redirectTo)`) instead of SPA
  `route()`. A full document replacement guarantees no stale route DOM. Keep
  SPA `route()` for redirects that fire during subsequent client navigations
  (no committed-then-retained tree to leak). Needs a way to distinguish
  "initial-load redirect" from "post-navigation redirect" (the route-change
  dispatcher already tracks `firstDispatchSeen` in
  `packages/iso/src/internal/route-change.ts`).
- **Upstream:** confirm whether preact-iso v3 has fixed or can fix the
  retention of a previous route whose component resolved to `null` during a
  hydration-suspended transition.

## Why not fixed now

- It is rooted in a pinned third-party dependency and sits on the P0 routing
  path; a rushed change risks routing regressions.
- The demo guard fix (`login.tsx` sets `demo:authed` at sign-in) removed the
  only trigger, so a framework change can no longer be verified against the
  demo without re-introducing a temporary trigger and a dedicated repro
  harness.

## Demo-level mitigation already shipped

`apps/site/src/pages/demo/login.tsx` now sets `localStorage['demo:authed']`
as the sign-in form submits, so the client guard passes on the post-login
landing and never issues the initial-load redirect that exposes this bug.
