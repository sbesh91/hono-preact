# SSR Navigation Mode: Per-Route HTML Navigation

**Date:** 2026-05-06
**Status:** Draft

## Problem

Today, every client-side navigation to a route with a server loader posts JSON to `/__loaders` (via the Vite stub at `packages/vite/src/server-only.ts`). The route then renders on the client. This is fine for app-shell pages, but it has structural drawbacks for content-heavy routes:

- **Two round trips of work for the same data.** The server already has a render path that can produce HTML; the client fetches data, then renders the same component a second time.
- **Suspense fallback flicker on every navigation.** The loader fires after mount, so the new route paints with its `fallback` until JSON arrives.
- **No HTML-first navigation option.** Authors can drop out of the SPA by using a real `<a target="_self">`, but that tears down the whole app and re-hydrates from scratch, losing any persistent layout state.

We want a per-route opt-in that keeps the SPA shell mounted, fetches a server-rendered HTML fragment for the page, and hydrates it as an island. Loaders still run, but on the server during the same fragment render, and their data rides along in the response so the client never makes a separate `/__loaders` call for that navigation.

## Goal

A `<Route>` element can declare `navigate="ssr"`. When set, client-side navigations to that route fetch an HTML fragment from the same URL (with an `X-HP-Navigate: fragment` header), splice the HTML into a stable mount point, and hydrate the page as a Preact island. The persistent layout above the route stays mounted. Loader data is preloaded via the existing DOM-based preload channel, so the hydrated tree renders synchronously without firing `/__loaders`.

`navigate` defaults to `'spa'`. SPA-mode behavior is unchanged.

We are explicitly **not** doing islands-style code-splitting (page component code still ships to the client to support hydration). We are also not committing to streaming in v1; we leave the wire format forward-compatible for a future streaming pass.

## Target Shape

### Authoring

```tsx
// iso.tsx
import { Route, Router, lazy } from '@hono-preact/iso';

const Home = lazy(() => import('./pages/home.js'));
const Docs = lazy(() => import('./pages/docs.js'));

<Router>
  <Route path="/" component={Home} />                              {/* SPA, today's behavior */}
  <Route path="/docs/*" component={Docs} navigate="ssr" />         {/* SSR-mode */}
</Router>
```

`definePage` is unchanged; mode is purely a routing-layer concern. `Route` becomes a thin wrapper from `@hono-preact/iso` (rather than a direct re-export of `preact-iso`'s `Route`). `Router` and `lazy` continue to re-export `preact-iso`'s primitives unchanged. The wrapper adds ~30 LOC of custom code, far less than the 243 LOC of routing machinery removed in commit `4239bab`.

### Server response (fragment mode)

For an `'ssr'` route navigation, the same URL the route already serves returns a JSON envelope when the request carries `X-HP-Navigate: fragment`:

```jsonc
{
  "events": [
    {
      "type": "envelope",
      "html": "<...rendered <Page> subtree, including <section id='loader-${moduleKey}' data-loader='...'>...</section>...>",
      "head": { "title": "...", "metas": [...], "links": [...] }
    }
  ]
}
```

The envelope is wrapped in an `events` array even in v1 (single event). This is the degenerate-stream form of the future streaming protocol; the client's apply logic dispatches by `type` from day one, so phase 2 streaming adds events without rewriting the client.

Loader data is **not** carried separately in the envelope. The server's Envelope component already renders `data-loader={JSON.stringify(data)}` onto the wrapper element. With moduleKey-based ids (see "Loader id and hydration handoff" below), the spliced HTML self-encodes loader data at the matching DOM id, and the client's existing DOM-based preload channel resolves it synchronously during hydrate. Phase 2's deferred loaders arrive as separate `{type: 'loader-fill'}` events that imperatively write `data-loader` onto the already-spliced wrapper.

`GuardRedirect` thrown during fragment render produces `{"events":[{"type":"redirect","location":"/login"}]}` rather than HTTP 302, since `fetch` follows redirects transparently and would break the envelope shape.

Other 4xx/5xx responses fall back to a hard navigation (`location.assign(url)`) on the client.

## Architecture

### Components

**`Route`** (new thin wrapper, `packages/iso/src/route.tsx`)

```tsx
export type NavigateMode = 'spa' | 'ssr';

export type RouteProps<P = unknown> = {
  path?: string;
  default?: boolean;
  component: ComponentType<P>;
  navigate?: NavigateMode;
};

export function Route<P>({ component, navigate, path, ...rest }: RouteProps<P>) {
  if (navigate === 'ssr' && path) {
    registerRouteMode(path, 'ssr');
    const HostedComponent = (loc: P) => (
      <PageHost component={component} location={loc} />
    );
    return <PreactIsoRoute path={path} component={HostedComponent} {...rest} />;
  }
  return <PreactIsoRoute path={path} component={component} {...rest} />;
}
```

The wrapper:
- registers the path → mode in a module-level registry on render (idempotent for stable path/navigate),
- substitutes `component` with a `PageHost` adapter when `navigate === 'ssr'`,
- passes through to `preact-iso`'s `Route` otherwise.

`Router` (re-exported from `preact-iso`) walks children and reads `vnode.props.path`/`vnode.props.default`/`vnode.props.component` exactly as today. Our `Route` wrapper sets the same prop shape, so `Router` matches and renders without modification.

**`PageHost`** (new, `packages/iso/src/page-host.tsx`)

The hydrate island for SSR-mode routes. Renders in one of two modes:

1. **Pre-island mode** (initial paint, and any time before the first SSR fragment arrives for this host): renders `<Component {...location} />` directly. The server-rendered initial document hydrates through this code path with no special handling. Equivalent to what `preact-iso`'s `Route` would have rendered without our wrapper.
2. **Island mode** (after the first client-side SSR navigation lands): renders `<div ref dangerouslySetInnerHTML={{ __html: lastHtml }} />`. The outer Preact tree commits the div with stable `__html` and never touches its children. A separate hydrate root is attached to that div via `preactHydrate(<Component {...location} />, hostDiv)`.

`PageHost` subscribes to the navigator (see below) for new fragments. On each fragment it transitions to island mode (if not already), updates `lastHtml` imperatively (setting `hostDiv.innerHTML = html` directly to bypass Preact diff), and re-runs `preactHydrate` against the new DOM with a fresh component vnode.

Cross-route SSR-to-SSR navigations unmount the old `PageHost` (different `<Route>` matches) and mount a new one. The new `PageHost` starts in pre-island mode and immediately transitions to island mode because the navigator already has the fragment.

**`Navigator`** (new, `packages/iso/src/navigator.ts`)

A single module that owns SSR-mode navigation:

- Maintains the path-mode registry (`registerRouteMode(path, mode)` / `lookupRouteMode(url)`).
- Maintains a single in-flight `AbortController`.
- Installs a capture-phase document `click` listener at module load. The listener replicates `preact-iso`'s exclusion rules (modifier keys, `target=_blank`, cross-origin, `download` attribute) and bails out unless the link's URL matches a registered SSR route.
- For SSR clicks: `preventDefault`; abort any in-flight; fetch URL with `X-HP-Navigate: fragment`; on response, dispatch the events:
  - `envelope`: apply `head` patch; hand `html` to the matching `PageHost` (subscribers indexed by path); navigate via `useLocation().route(url)` so `LocationProvider`'s reducer updates URL state and history.
  - `redirect`: re-enter `navigator.navigate(location)` (recursive, with the redirect target).
  - any unrecognized type or non-2xx HTTP: fall back to `location.assign(url)`.
- Exposes a `navigate(url)` for programmatic callers (guards, action handlers) so they get the same SPA-vs-SSR treatment as click-driven navigation.

**Server fragment renderer** (extended, `packages/server/src/render.tsx`)

- `renderPage(c, node, options?)` gains an optional `mode: 'document' | 'fragment'` (default `'document'`).
- In `'fragment'` mode, the existing prerender pipeline runs to capture head tags via the same hoofd dispatcher and to run loaders via the same `runRequestScope` (imported from `@hono-preact/iso/internal`, as today).
- The user's `<App>` tree is rendered as today; the `<Page>` component participates by capturing its own subtree to a request-scoped side channel (see "Page subtree capture" below) and rendering nothing into the outer string.
- The outer HTML string is discarded; only the captured subtree string + dispatcher state ship. Loader values do not need separate serialization because they are already inlined as `data-loader` attributes on the captured subtree's wrapper elements.

### Data flow: SSR-mode click

```
  user click on <a href="/docs/bar">
        |
        v
  capture-phase click listener (installed by navigator)
        |
        +-- registry lookup: /docs/bar -> 'ssr'
        |
        v
  preventDefault; navigator.navigate('/docs/bar')
        |
        +-- abort previous in-flight, if any
        +-- fetch('/docs/bar', { headers: { 'X-HP-Navigate': 'fragment' } })
        |
        v
  server route handler (existing app.get('*'))
        +-- detects header; calls renderPage(c, <Layout/>, { mode: 'fragment' })
        +-- prerender(<Layout/>) under runRequestScope
              +-- <Page> for matched route runs its loader; Envelope renders
                  the wrapper with id="loader-${moduleKey}" and data-loader=JSON
              +-- captured HTML for the page subtree includes that wrapper
              +-- envelope.head from hoofd dispatcher
        |
        v
  client receives envelope
        +-- for each event:
              +-- 'envelope':
                    apply head patch (title, metas, links)
                    pushState(url); poke LocationProvider
                    notify PageHost subscribed to /docs/* with the html
        |
        v
  PageHost transitions to (or stays in) island mode
        +-- imperatively set hostDiv.innerHTML = html
        +-- preactHydrate(<Component {...location} />, hostDiv)
              +-- Loader reads preloaded data from DOM, no /__loaders fetch
              +-- hydration matches DOM, no fallback flicker
```

### Page subtree capture

The fragment endpoint needs to extract the `<Page>` subtree's HTML from a render of the full `<Layout>` tree, without parsing the resulting HTML string. Approach: side-channel render.

- `<Page>` reads a request-scoped flag (set by `renderPage` when `mode === 'fragment'`).
- When the flag is set, `<Page>` runs `prerender` on its own children (a nested prerender), captures the result string to a request-scoped slot, and renders nothing into the outer tree.
- The outer prerender continues so loaders still execute via `runRequestScope` and head tags accumulate via the shared hoofd dispatcher.
- After the outer prerender completes, `renderPage` reads the captured string and dispatcher state, builds the envelope, and returns.

Risk: the inner `prerender` shares the outer `HoofdProvider` only if the dispatcher is provided via context to both renders. Today `renderPage` wraps the render in `<HoofdProvider value={dispatcher}>`. The inner prerender of `<Page>`'s children inherits the outer context through the React-style context chain even across nested `prerender` calls (preact-iso's `prerender` re-uses the realm-wide context registry).

If nested `prerender` turns out to interact poorly with shared loader scope or hoofd dispatcher, fall back to sentinel comments around `<Page>`'s output (`<!--hp:page-start-->...<!--hp:page-end-->`) and string-extract between them. The side-channel approach is preferred.

### Loader id and hydration handoff

The existing preload channel works through the DOM: `getPreloadedData(id)` (now exported from `@hono-preact/iso/internal`) reads `document.getElementById(id).dataset.loader`. The id is currently produced by `useId()` in `Loader`, propagated via `LoaderIdContext`, and rendered by `Envelope` onto the wrapper element.

`useId()` is tree-position-based. Server-side fragment render places `<Page>` deep inside `<Layout>`; client-side island hydrate places `<Page>` at the root of a fresh `preactHydrate` call. Tree positions differ, so `useId()` produces different ids. The DOM lookup would fail, and Preact's hydrate would also report a mismatch on the wrapper's `id` attribute.

**Resolution:** switch the Loader/Envelope id source from `useId()` to a moduleKey-derived id.

- `LoaderRef.__id` is `Symbol.for('@hono-preact/loader:${moduleKey}')` (set by `defineLoader`).
- `Loader` derives a stable wire id from `loaderRef.__id.description` (e.g., `loader-${moduleKey}`).
- `Envelope` consumes `LoaderIdContext` as today; the value is the moduleKey-derived id rather than `useId()`.
- `getPreloadedData` and `deletePreloadedData` are unchanged in shape (they still take a string id).

This change applies to pages with a loader. Pages without a loader use `NoLoaderFrame`, which still uses `useId()` (no preload channel needed, no cross-render id stability requirement).

The same module ID is the routing key for `/__loaders`, the cache identity for `cacheRegistry`, and now the wire/DOM identifier for preload. One stable identifier across the whole stack.

A direct consequence: the envelope JSON does not need to carry loader values separately. The server's render of `<Page>` produces HTML that already contains `<wrapper id="loader-${moduleKey}" data-loader="...">...</wrapper>`. Splice the HTML, run `preactHydrate`, and `Loader`'s synchronous `getPreloadedData` finds the data on the just-spliced wrapper. No separate write-side preload API is needed.

### Lazy components

Because `navigate` is read off the `<Route>` JSX prop (not the resolved component), lazy components present no cold-start problem. The path-mode registry is populated on first render of `<Route>` regardless of whether the lazy chunk has resolved. The page chunk still has to load on first navigation, but that is the existing lazy cost; no additional latency is added by SSR mode.

### Forward compatibility for streaming

Three v1 commitments preserve a streaming path:

1. **Versioned navigate header.** `X-HP-Navigate: fragment` is v1. A future `X-HP-Navigate: fragment-stream` opts into a streaming response. Old clients keep working.
2. **Envelope wrapped in `events`.** The single-event JSON above is the degenerate stream. Phase 2 emits multiple events (NDJSON or chunked transfer) without changing the client's dispatch shape.
3. **Stable moduleKey ids in the wire.** Phase 2's deferred-loader fills (`{type: 'loader-fill', moduleKey, key, data}`) write `data-loader` onto the already-spliced wrapper element by id. The id is the addressing primitive.

Phase 2 (deferred loaders) and phase 3 (streaming HTML + selective hydration) are explicit non-goals for v1. See "Out of scope" below.

## Edge Cases

- **Initial document load.** Handled by pre-island mode in `PageHost`. The full document hydrates through the existing pipeline with no special path. Island mode flips on after the first client-side SSR navigation lands.
- **Programmatic navigation.** `useLocation().route(url)` callers go through `navigator.navigate()` to get the same SPA-vs-SSR treatment as click-driven navigation. The navigator's `navigate(url)` either dispatches the fragment fetch (SSR) or delegates to `preact-iso`'s `route()` (SPA).
- **Browser back / forward.** v1 refetches the fragment on `popstate` for SSR routes. A small `Map<url, envelope>` LRU cache is a phase 2 optimization; not in v1.
- **Same-route URL change** (e.g. `/docs/foo` → `/docs/bar`, both matching `/docs/*`). `PageHost` stays mounted, receives a new envelope, updates innerHTML imperatively, re-runs `preactHydrate` against the new DOM and a fresh component vnode.
- **SSR → SPA-mode navigation** (cross-route). Different `<Route>` matches → different host. `PageHost` unmounts, plain component mounts. Standard Preact reconciliation.
- **SPA → SSR-mode navigation** (cross-route). Symmetric: plain component unmounts, `PageHost` mounts. The new `PageHost` starts in pre-island mode and immediately transitions to island mode after the navigator delivers the fragment.
- **Forms and actions.** `defineAction` posts to `/__actions` regardless of navigate mode; nothing about that flow couples to SPA-vs-SSR.
- **Prefetch.** `prefetch()` today warms loader caches over JSON. Phase 2 extension warms fragment envelopes for SSR routes. v1 leaves `prefetch()` SPA-only and documents the gap.
- **Redirects mid-fragment.** Server emits a `{type: 'redirect'}` event in the envelope. Navigator re-enters `navigate()` with the redirect target, applying the same SPA-vs-SSR logic.
- **Errors mid-fragment.** Non-2xx response: client falls back to a hard `location.assign(url)` so the user still ends up where they expected, just via a full document load.
- **Modifier keys, target=_blank, cross-origin.** The capture-phase listener honors the same exclusion rules as `preact-iso`'s `handleNav`: anything that would normally bypass SPA routing also bypasses SSR routing. Source-of-truth helper lives in the navigator.
- **Hoofd reconciliation.** The envelope's `head` is applied imperatively before hydrate. Hoofd hooks inside the hydrating tree re-register on mount; hoofd's reconciliation should converge without flicker. Worth a focused test; if it double-applies, gate the imperative step on first paint and let hoofd own subsequent updates.
- **`dangerouslySetInnerHTML` isolation.** `PageHost` relies on Preact respecting `__html` as a "do not touch children" contract on subsequent rerenders of the outer tree. This is current Preact behavior; a regression test pins it. We must never re-render the outer div with a changed `__html` prop during island mode (we mutate `innerHTML` imperatively instead).

## Out of Scope (v1)

- Deferred loader resolution (`defer`-style API on `defineLoader`). Phase 2.
- Streaming HTML response with selective per-boundary hydration. Phase 3.
- Islands-architecture code-splitting (omitting page component code from the client bundle).
- Fragment cache for back/forward. Phase 2 if measurements warrant.
- `prefetch()` support for SSR routes. Phase 2.
- Build-time mode manifest. Not needed because mode lives on `<Route>`, not the lazy page.
- `<a data-no-spa>` or other per-link overrides. Routes own the mode.
- Route-level mode override on a per-mount basis where the same component appears under multiple `<Route>` declarations. Authors set `navigate` per route declaration; if they want one component in two modes they put it under two `<Route>` declarations.

## Risks and Open Questions

- **Public surface placement.** `Loader`, `Envelope`, `getPreloadedData`/`deletePreloadedData`, `runRequestScope`, and the context objects are now `@hono-preact/iso/internal`. Our changes touch some of those (Loader's id source, Envelope's id propagation), but only as in-package edits. The new authoring/runtime API surface (`Route` wrapper, `PageHost`, `Navigator`) belongs on the main entrypoint alongside `Page`/`definePage`, not in `internal`.
- **Nested `prerender`.** Whether running `prerender` on `<Page>`'s children inside an outer `prerender` cleanly shares the hoofd dispatcher and request scope. If not, fall back to sentinel-extraction. This is the most important pre-implementation question.
- **Outer rerender stomping the island.** Preact's `dangerouslySetInnerHTML` semantics around stable `__html` need a regression test. Mitigation in design: never re-render `PageHost`'s outer div with a new `__html` value during island mode (mutate `innerHTML` imperatively).
- **History coordination with preact-iso.** `LocationProvider` listens to `popstate` and to `click` events. Pushing state programmatically without going through `LocationProvider`'s reducer means its `url` state can get out of sync. Concretely, `LocationProvider`'s `route(url)` API is the right entry point: calling it dispatches into the reducer, which updates the location and (for a `pushState` path) updates history. The navigator should call `useLocation().route(url)` rather than touching `history.pushState` directly.
- **moduleKey collisions.** Two loaders sharing a moduleKey would produce the same wire id. The Vite plugin derives moduleKey from the file path, so collisions can only occur if two `defineLoader` calls live in the same file (currently allowed but unusual). Add a dev-mode warning if a moduleKey is registered twice.
- **Pages without loaders in SSR mode.** Still meaningful: server returns rendered HTML, client splices and hydrates. No preload data on the wrapper, no DOM lookup at hydrate time. `PageHost` works the same way; `useId()`-based ids inside `NoLoaderFrame` differ between server and client, but they aren't used for any cross-render lookup.

## Acceptance Criteria

- A route declared `navigate="ssr"` and mounting a page with a loader, when navigated to client-side via an `<a>` click, produces no `/__loaders` request.
- The same navigation produces exactly one `fetch` to the route URL with `X-HP-Navigate: fragment`.
- The persistent layout above the route stays mounted across the navigation (no remount of `DocsLayout` or equivalent).
- Server-rendered HTML appears in the DOM before the page's component code runs on the client (verifiable via DevTools Performance timeline or a probe).
- Initial document load of the same route works unchanged: full document SSR, normal hydration, no double-render.
- A SPA-mode route mounted alongside SSR-mode routes behaves exactly as it does today.
- Lazy `<Route>` components configured `navigate="ssr"` work on first navigation (no cold-start fallback to SPA).
- A loader's wire id matches across server fragment render, client document hydrate, and client island hydrate. The DOM-based preload channel resolves loader data synchronously in all three.
