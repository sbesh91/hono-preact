# SSR Navigation Mode: Per-Route HTML Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-route opt-in (`navigate="ssr"`) that fetches a server-rendered HTML fragment on client-side navigation, splices it into a stable mount point, and hydrates as an island. Loader data rides in the fragment HTML via the existing DOM-based preload channel; no separate `/__loaders` round trip.

**Architecture:** Reintroduce a thin `Route` wrapper from `@hono-preact/iso` that registers a path → mode entry and substitutes a `PageHost` adapter when `navigate="ssr"`. A `Navigator` module installs a capture-phase click listener, fetches `URL` with `X-HP-Navigate: fragment`, and notifies `PageHost` to transition into island mode (imperative `innerHTML = html` + `preactHydrate` against a stable host div). On the server, `renderPage` detects the header, sets a fragment-mode context, and `<Page>` wraps its rendered subtree in a `<hp-page-fragment>` sentinel that `renderPage` extracts. The wire envelope is `{ events: [{ type: 'envelope', html, head }] }`; loader values live in `data-loader` attributes on the captured wrapper element. Loader/Envelope use a moduleKey-derived id (not `useId`) so wire ids stay stable across server fragment render and client island hydrate.

**Tech Stack:** TypeScript, Preact, preact-iso (`Router`/`Route`/`lazy`/`LocationProvider`/`exec`/`prerender`), Hono (server), Vite, Vitest, happy-dom, @testing-library/preact.

**Spec:** `docs/superpowers/specs/2026-05-06-ssr-navigation-mode-design.md`

---

## Pre-flight context for the executing engineer

Read these files first to understand the surfaces you'll touch:

- `packages/iso/src/index.ts`: public surface; currently re-exports `preact-iso`'s `Route`/`Router`/`lazy`. We will replace the `Route` re-export with our wrapper.
- `packages/iso/src/internal.ts`: escape-hatch surface with `Loader`, `Envelope`, `getPreloadedData`/`deletePreloadedData`, `runRequestScope`, contexts, etc.
- `packages/iso/src/define-page.tsx`: `definePage` returns `FunctionComponent<RouteHook>` (unchanged by this plan).
- `packages/iso/src/define-loader.ts`: `LoaderRef.__id` is `Symbol.for('@hono-preact/loader:${moduleKey}')`.
- `packages/iso/src/loader.tsx`: `<Loader>` currently calls `useId()` for the preload channel id; we will switch to a moduleKey-derived id.
- `packages/iso/src/envelope.tsx`: reads `LoaderIdContext`, renders the `id`/`data-loader` attributes on the wrapper.
- `packages/iso/src/page.tsx`: composes `RouteBoundary > Guards > Loader > Envelope`. Will gain a fragment-mode branch that wraps in `<hp-page-fragment>`.
- `packages/iso/src/contexts.ts`: `LoaderIdContext`, `LoaderDataContext`, `GuardResultContext`.
- `packages/iso/src/preload.ts`: DOM-based preload channel; reads `document.getElementById(id).dataset.loader`.
- `packages/iso/src/cache.ts`: `runRequestScope` (AsyncLocalStorage on Node/Workers).
- `packages/server/src/render.tsx`: `renderPage` uses `prerender` from `preact-iso/prerender`.
- `apps/app/src/server.tsx`: `app.get('*', ...)` calls `renderPage(c, <Layout context={c} />)`.
- `apps/app/src/iso.tsx`: central route table using preact-iso's `Route` today.
- `node_modules/preact-iso/src/router.js`: for reference; `Route = props => h(props.component, props)`, click interception lives in `LocationProvider`, `exec` is exported.

Run `pnpm test` from repo root before starting; confirm all tests pass.

This is additive plus one breaking internal change: the `Loader` id source moves from `useId()` to `loaderRef.__id.description`. Any test asserting on the specific id format breaks; update those assertions.

---

## File Structure

### New files (packages/iso)
- `packages/iso/src/navigator.ts`: mode registry, capture-phase click handler, fetch + dispatch, subscribe API for PageHost.
- `packages/iso/src/page-host.tsx`: `<PageHost>` component with pre-island and island modes.
- `packages/iso/src/route.tsx`: `<Route>` wrapper from `@hono-preact/iso` (replaces the `preact-iso` re-export).
- `packages/iso/src/fragment-mode.ts`: `FragmentModeContext` and helpers.
- `packages/iso/src/__tests__/navigator.test.ts`
- `packages/iso/src/__tests__/page-host.test.tsx`
- `packages/iso/src/__tests__/route.test.tsx`
- `packages/iso/src/__tests__/fragment-mode.test.tsx`

### Modified files (packages/iso)
- `packages/iso/src/loader.tsx`: derive wire id from `loaderRef.__id.description` instead of `useId()`.
- `packages/iso/src/page.tsx`: wrap rendered subtree in `<hp-page-fragment>` when fragment-mode context is set.
- `packages/iso/src/index.ts`: drop `Route` re-export from `preact-iso`; export our `Route` wrapper plus new authoring/runtime API (`PageHost`, `navigator`-related hooks if exposed).
- `packages/iso/src/__tests__/loader.test.tsx`: update id assertions if any.

### Modified files (packages/server)
- `packages/server/src/render.tsx`: branch on `X-HP-Navigate: fragment`; render in fragment mode and return JSON envelope.
- `packages/server/src/__tests__/render.test.tsx`: new tests for fragment-mode response.

### Modified files (apps/app)
- `apps/app/src/iso.tsx`: switch one route to `navigate="ssr"` for end-to-end verification.
- `apps/app/src/__tests__/...`: optional integration test (recommend a unit-style test in `packages/iso/src/__tests__/integration.test.tsx` instead).

### Files NOT touched
- `packages/iso/src/define-page.tsx`: `definePage` is unchanged.
- `packages/iso/src/define-loader.ts`: `defineLoader` is unchanged.
- `packages/server/src/loaders-handler.ts`, `actions-handler.ts`: unchanged.
- `packages/vite/src/*`: unchanged.

---

## Task 1: Loader id moves to moduleKey-derived

**Files:**
- Modify: `packages/iso/src/loader.tsx`
- Test: `packages/iso/src/__tests__/loader.test.tsx`

The wire id (used by `Envelope` for the wrapper element and by `getPreloadedData` for DOM lookup) must be stable between server fragment render and client island hydrate. `useId()` is tree-position-based and won't match. Switch to `loader-${moduleKey}` derived from `loaderRef.__id.description`.

- [ ] **Step 1: Write the failing test**

Add to `packages/iso/src/__tests__/loader.test.tsx` (or wherever loader tests live; create the file if absent):

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { defineLoader } from '../define-loader.js';
import { Loader } from '../loader.js';
import { Envelope } from '../envelope.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

const loc = { path: '/x', url: '/x', searchParams: {}, pathParams: {} } as any;

describe('Loader wire id', () => {
  it('derives the preload-channel id from loaderRef moduleKey, not useId', async () => {
    const ref = defineLoader<{ ok: true }>(async () => ({ ok: true }), {
      __moduleKey: 'src/pages/movies',
    });
    const { container } = render(
      <Loader loader={ref} location={loc}>
        <Envelope as="section">child</Envelope>
      </Loader>
    );
    // Wait one tick for Suspense to resolve.
    await new Promise((r) => setTimeout(r, 0));
    const wrapper = container.querySelector('section');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.id).toBe('loader-src-pages-movies');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test loader
```

Expected: FAIL. current id format is from `useId()`, something like `:r0:` or `P0`.

- [ ] **Step 3: Add the id derivation helper inside `loader.tsx`**

Edit `packages/iso/src/loader.tsx`. Replace `const id = useId();` in the `Loader` component with a moduleKey-derived id:

```tsx
import type { LoaderRef } from './define-loader.js';

const LOADER_ID_PREFIX = '@hono-preact/loader:';

function deriveLoaderDomId(ref: LoaderRef<unknown>): string {
  const desc = ref.__id.description ?? '';
  const moduleKey = desc.startsWith(LOADER_ID_PREFIX)
    ? desc.slice(LOADER_ID_PREFIX.length)
    : 'unkeyed';
  // DOM id chars: HTML allows anything but whitespace; replace path-unfriendly
  // characters with hyphens for selector-safe ids.
  const safe = moduleKey.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `loader-${safe}`;
}
```

Then in the `Loader` body, replace `const id = useId();` with `const id = deriveLoaderDomId(loader);`. Remove the `useId` import if it's no longer used.

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test loader
```

Expected: PASS.

- [ ] **Step 5: Run the rest of the iso test suite**

```bash
pnpm --filter @hono-preact/iso test
```

Expected: all tests pass. If any test asserts on the older `useId`-based wrapper id, update it to `loader-<safe-moduleKey>`.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/loader.tsx packages/iso/src/__tests__/loader.test.tsx
git commit -m "refactor(iso): derive Loader DOM id from loaderRef moduleKey

The preload channel needs a stable id across server fragment render
and client island hydrate. useId() is tree-position-based and cannot
provide that. Derive 'loader-\${moduleKey}' from loaderRef.__id.description
so server and client agree on the wrapper's id whether the page renders
inside a full document tree or as an isolated island."
```

---

## Task 2: FragmentModeContext

**Files:**
- Create: `packages/iso/src/fragment-mode.ts`
- Test: `packages/iso/src/__tests__/fragment-mode.test.tsx`

A boolean Preact context, set by `renderPage` in fragment mode and read by `<Page>` to swap rendering behavior. Lives in iso so both `<Page>` (iso) and `renderPage` (server) can consume it.

- [ ] **Step 1: Write the failing test**

`packages/iso/src/__tests__/fragment-mode.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import { FragmentModeContext } from '../fragment-mode.js';

describe('FragmentModeContext', () => {
  it('defaults to false', () => {
    let observed: boolean | undefined;
    function Probe() {
      observed = useContext(FragmentModeContext);
      return null;
    }
    render(<Probe />);
    expect(observed).toBe(false);
  });

  it('reads true when wrapped in a provider with value=true', () => {
    let observed: boolean | undefined;
    function Probe() {
      observed = useContext(FragmentModeContext);
      return null;
    }
    render(
      <FragmentModeContext.Provider value={true}>
        <Probe />
      </FragmentModeContext.Provider>
    );
    expect(observed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test fragment-mode
```

Expected: FAIL. module does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/iso/src/fragment-mode.ts`:

```ts
import { createContext } from 'preact';

export const FragmentModeContext = createContext<boolean>(false);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test fragment-mode
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/fragment-mode.ts packages/iso/src/__tests__/fragment-mode.test.tsx
git commit -m "feat(iso): add FragmentModeContext for SSR fragment rendering"
```

---

## Task 3: `<Page>` wraps rendered subtree in sentinel under fragment mode

**Files:**
- Modify: `packages/iso/src/page.tsx`
- Test: `packages/iso/src/__tests__/page.test.tsx` (extend or create)

When `FragmentModeContext` is `true`, `<Page>` wraps its rendered subtree in `<hp-page-fragment>...</hp-page-fragment>`. The server's `renderPage` extracts content between these markers from the prerendered string. Custom-element name (must contain a dash) renders as-is in HTML.

- [ ] **Step 1: Write the failing test**

Add to `packages/iso/src/__tests__/page.test.tsx` (create if absent, with the same `@vitest-environment happy-dom` header used elsewhere):

```tsx
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { Page } from '../page.js';
import { FragmentModeContext } from '../fragment-mode.js';

const loc = { path: '/x', url: '/x', searchParams: {}, pathParams: {} } as RouteHook;

describe('<Page> under fragment mode', () => {
  it('wraps its rendered subtree in <hp-page-fragment>', () => {
    function Inner() {
      return <p>body</p>;
    }
    const html = renderToString(
      <LocationProvider>
        <FragmentModeContext.Provider value={true}>
          <Page location={loc}>
            <Inner />
          </Page>
        </FragmentModeContext.Provider>
      </LocationProvider>
    );
    expect(html).toContain('<hp-page-fragment>');
    expect(html).toContain('</hp-page-fragment>');
    expect(html).toMatch(/<hp-page-fragment>.*<p>body<\/p>.*<\/hp-page-fragment>/s);
  });

  it('does not wrap when fragment mode is false (default)', () => {
    function Inner() {
      return <p>body</p>;
    }
    const html = renderToString(
      <LocationProvider>
        <Page location={loc}>
          <Inner />
        </Page>
      </LocationProvider>
    );
    expect(html).not.toContain('<hp-page-fragment');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test page
```

Expected: FAIL. `<Page>` does not yet branch on `FragmentModeContext`.

- [ ] **Step 3: Add the fragment-mode branch in `<Page>`**

Edit `packages/iso/src/page.tsx`. Add `useContext(FragmentModeContext)` and wrap the existing JSX return in `<hp-page-fragment>` when true:

```tsx
import { useContext, useId } from 'preact/hooks';
import { FragmentModeContext } from './fragment-mode.js';

export function Page<T>({
  loader, location, cache, serverGuards, clientGuards,
  fallback, errorFallback, Wrapper, children,
}: PageProps<T>): JSX.Element {
  const id = useId();
  const isFragment = useContext(FragmentModeContext);

  const tree = (
    <RouteBoundary fallback={fallback} errorFallback={errorFallback}>
      <Guards server={serverGuards} client={clientGuards} location={location}>
        {loader ? (
          <Loader loader={loader} location={location} cache={cache} fallback={fallback}>
            <Envelope as={Wrapper}>{children}</Envelope>
          </Loader>
        ) : (
          <NoLoaderFrame id={id} as={Wrapper}>
            {children}
          </NoLoaderFrame>
        )}
      </Guards>
    </RouteBoundary>
  );

  if (isFragment) {
    // Custom element name (must contain a dash) renders as-is.
    // renderPage extracts between these markers in fragment mode.
    return <hp-page-fragment>{tree}</hp-page-fragment> as unknown as JSX.Element;
  }
  return tree;
}
```

If TypeScript complains about the unknown `hp-page-fragment` element, declare it once at the top of the file:

```tsx
declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'hp-page-fragment': { children?: ComponentChildren };
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test page
```

Expected: PASS for both new tests, and all existing `<Page>` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/page.tsx packages/iso/src/__tests__/page.test.tsx
git commit -m "feat(iso): wrap Page output in <hp-page-fragment> under fragment mode"
```

---

## Task 4: `renderPage` fragment-mode branch

**Files:**
- Modify: `packages/server/src/render.tsx`
- Test: `packages/server/src/__tests__/render.test.tsx` (create if absent)

`renderPage` checks `X-HP-Navigate: fragment` on the request. If set, it sets `FragmentModeContext` to `true`, prerenders the user's tree, extracts the content between `<hp-page-fragment>` markers, and returns a JSON envelope.

- [ ] **Step 1: Write the failing test**

`packages/server/src/__tests__/render.test.tsx`:

```tsx
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { renderPage } from '../render.js';

describe('renderPage fragment mode', () => {
  it('returns a JSON envelope when X-HP-Navigate: fragment is set', async () => {
    const app = new Hono();
    app.get('/test', (c) =>
      renderPage(
        c,
        <html>
          <body>
            <hp-page-fragment>
              <section id="loader-foo" data-loader="{&quot;ok&quot;:true}">hello</section>
            </hp-page-fragment>
          </body>
        </html>
      )
    );
    const res = await app.request('/test', {
      headers: { 'X-HP-Navigate': 'fragment' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('envelope');
    expect(body.events[0].html).toContain('loader-foo');
    expect(body.events[0].html).toContain('hello');
    expect(body.events[0].html).not.toContain('hp-page-fragment');
  });

  it('returns full HTML document when header is absent', async () => {
    const app = new Hono();
    app.get('/test', (c) =>
      renderPage(c, <html><body><p>hi</p></body></html>)
    );
    const res = await app.request('/test');
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<!doctype html>');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/server test
```

Expected: FAIL. fragment-mode branch does not exist.

- [ ] **Step 3: Implement the fragment-mode branch**

Edit `packages/server/src/render.tsx`:

```tsx
import type { Context } from 'hono';
import type { VNode } from 'preact';
import { createDispatcher, HoofdProvider } from 'hoofd/preact';
import { prerender } from 'preact-iso/prerender';
import { GuardRedirect, env } from '@hono-preact/iso';
import { runRequestScope } from '@hono-preact/iso/internal';
import { FragmentModeContext } from '@hono-preact/iso/internal';

// (existing escapeHtml/toAttrs helpers stay here)

export async function renderPage(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string }
): Promise<Response> {
  const isFragment = c.req.header('X-HP-Navigate') === 'fragment';
  if (isFragment) return renderFragment(c, node);
  return renderDocument(c, node, options);
}

const FRAGMENT_OPEN = '<hp-page-fragment>';
const FRAGMENT_CLOSE = '</hp-page-fragment>';

async function renderFragment(c: Context, node: VNode): Promise<Response> {
  const dispatcher = createDispatcher();
  const previousEnv = env.current;
  env.current = 'server';

  let html: string;
  try {
    ({ html } = await runRequestScope(() =>
      prerender(
        <FragmentModeContext.Provider value={true}>
          <HoofdProvider value={dispatcher}>{node}</HoofdProvider>
        </FragmentModeContext.Provider>
      )
    ));
  } catch (e: unknown) {
    if (e instanceof GuardRedirect) {
      return c.json({
        events: [{ type: 'redirect', location: e.location }],
      });
    }
    throw e;
  } finally {
    env.current = previousEnv;
  }

  const start = html.indexOf(FRAGMENT_OPEN);
  const end = html.indexOf(FRAGMENT_CLOSE);
  if (start < 0 || end < 0 || end < start) {
    // No fragment marker found. Either the matched route did not render <Page>,
    // or the marker was stripped. Fall back to instructing the client to do a
    // hard navigation.
    return c.json({ events: [{ type: 'fallback' }] }, 200);
  }
  const captured = html.slice(start + FRAGMENT_OPEN.length, end);

  const { title, metas = [], links = [] } = dispatcher.toStatic();
  return c.json({
    events: [
      {
        type: 'envelope',
        html: captured,
        head: { title, metas, links },
      },
    ],
  });
}

async function renderDocument(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string }
): Promise<Response> {
  // (existing renderPage body, unchanged: copy what was there)
  ...
}
```

You also need `FragmentModeContext` to be exported from `@hono-preact/iso/internal`. Add to `packages/iso/src/internal.ts`:

```ts
export { FragmentModeContext } from './fragment-mode.js';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/server test
```

Expected: PASS for both fragment-mode and document-mode tests.

- [ ] **Step 5: Run all server + iso tests to confirm no regression**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/render.tsx packages/iso/src/internal.ts packages/server/src/__tests__/render.test.tsx
git commit -m "feat(server): add fragment-mode branch to renderPage

When X-HP-Navigate: fragment is set, prerender under FragmentModeContext,
extract content between <hp-page-fragment> markers, and return a JSON
envelope shaped { events: [{ type: 'envelope', html, head }] }. Loader
data is already in the captured HTML's data-loader attributes via the
existing Envelope render path; no separate loaders map needed."
```

---

## Task 5: Navigator core (registry and subscription API)

**Files:**
- Create: `packages/iso/src/navigator.ts`
- Test: `packages/iso/src/__tests__/navigator.test.ts`

The navigator owns a path-mode registry, a buffer of latest fragment per path, and a subscribe API for `PageHost`. We start with the registry/subscribe surface; click handler and fetch land in Tasks 6 and 7.

- [ ] **Step 1: Write the failing test**

`packages/iso/src/__tests__/navigator.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerRouteMode,
  lookupRouteMode,
  clearRegistry,
  setLatestFragment,
  subscribeToFragment,
  clearLatestFragment,
} from '../navigator.js';

beforeEach(() => {
  clearRegistry();
  clearLatestFragment();
});

describe('navigator route mode registry', () => {
  it('returns "spa" for unregistered paths', () => {
    expect(lookupRouteMode('/anything')).toBe('spa');
  });

  it('returns "ssr" for an exact registered path', () => {
    registerRouteMode('/docs', 'ssr');
    expect(lookupRouteMode('/docs')).toBe('ssr');
  });

  it('matches preact-iso path patterns with parameters', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    expect(lookupRouteMode('/docs/intro')).toBe('ssr');
    expect(lookupRouteMode('/blog/x')).toBe('spa');
  });

  it('matches /docs/* rest patterns', () => {
    registerRouteMode('/docs/*', 'ssr');
    expect(lookupRouteMode('/docs/a')).toBe('ssr');
    expect(lookupRouteMode('/docs/a/b/c')).toBe('ssr');
  });
});

describe('navigator fragment buffer + subscription', () => {
  it('delivers the latest fragment to a new subscriber for that path', () => {
    setLatestFragment('/docs/*', '<section>hi</section>');
    let received: string | null = null;
    const unsub = subscribeToFragment('/docs/*', (html) => { received = html; });
    expect(received).toBe('<section>hi</section>');
    unsub();
  });

  it('notifies all current subscribers when a new fragment arrives', () => {
    const seen: string[] = [];
    const unsub = subscribeToFragment('/docs/*', (html) => seen.push(html));
    setLatestFragment('/docs/*', 'A');
    setLatestFragment('/docs/*', 'B');
    expect(seen).toEqual(['A', 'B']);
    unsub();
  });

  it('does not deliver fragments for other paths', () => {
    const seen: string[] = [];
    const unsub = subscribeToFragment('/docs/*', (h) => seen.push(h));
    setLatestFragment('/blog/*', 'X');
    expect(seen).toEqual([]);
    unsub();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test navigator
```

Expected: FAIL. module does not exist.

- [ ] **Step 3: Implement the navigator core**

Create `packages/iso/src/navigator.ts`:

```ts
import { exec } from 'preact-iso';

export type NavigateMode = 'spa' | 'ssr';

const routeModes = new Map<string, NavigateMode>();
const subscribers = new Map<string, Set<(html: string) => void>>();
const latestFragments = new Map<string, string>();

export function registerRouteMode(path: string, mode: NavigateMode): void {
  routeModes.set(path, mode);
}

export function clearRegistry(): void {
  routeModes.clear();
}

/**
 * Look up the navigate mode for a URL by matching against registered paths.
 * Defaults to 'spa' when no registered path matches.
 */
export function lookupRouteMode(url: string): NavigateMode {
  for (const [pattern, mode] of routeModes) {
    if (exec(url, pattern, {})) return mode;
  }
  return 'spa';
}

export function setLatestFragment(path: string, html: string): void {
  latestFragments.set(path, html);
  const subs = subscribers.get(path);
  if (subs) for (const fn of subs) fn(html);
}

export function clearLatestFragment(): void {
  latestFragments.clear();
}

export function subscribeToFragment(
  path: string,
  handler: (html: string) => void
): () => void {
  let set = subscribers.get(path);
  if (!set) {
    set = new Set();
    subscribers.set(path, set);
  }
  set.add(handler);
  // Replay latest fragment if one is buffered.
  const latest = latestFragments.get(path);
  if (latest !== undefined) handler(latest);
  return () => {
    const s = subscribers.get(path);
    if (s) {
      s.delete(handler);
      if (s.size === 0) subscribers.delete(path);
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test navigator
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/navigator.ts packages/iso/src/__tests__/navigator.test.ts
git commit -m "feat(iso): add navigator route-mode registry and fragment subscription API"
```

---

## Task 6: Navigator click interceptor

**Files:**
- Modify: `packages/iso/src/navigator.ts`
- Modify: `packages/iso/src/__tests__/navigator.test.ts`

A capture-phase document `click` listener that runs before `preact-iso`'s. Mirrors `preact-iso`'s exclusion rules (modifier keys, target=_blank, cross-origin, download). For SSR-route hits: `preventDefault` and call `navigate(url)` (which will be implemented in Task 7).

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/navigator.test.ts`:

```ts
import { vi } from 'vitest';
import {
  installClickInterceptor,
  uninstallClickInterceptor,
  __setNavigateForTesting,
} from '../navigator.js';

describe('navigator click interceptor', () => {
  let navigateSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    clearRegistry();
    navigateSpy = vi.fn();
    __setNavigateForTesting(navigateSpy);
    installClickInterceptor();
  });
  afterEach(() => {
    uninstallClickInterceptor();
    __setNavigateForTesting(null);
  });

  function clickAnchor(href: string, init?: Partial<MouseEventInit>): MouseEvent {
    const a = document.createElement('a');
    a.href = href;
    document.body.appendChild(a);
    const ev = new MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, ...init,
    });
    a.dispatchEvent(ev);
    a.remove();
    return ev;
  }

  it('intercepts SSR-route same-origin plain clicks', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const ev = clickAnchor(window.location.origin + '/docs/intro');
    expect(ev.defaultPrevented).toBe(true);
    expect(navigateSpy).toHaveBeenCalledWith('/docs/intro');
  });

  it('does not intercept SPA-route clicks', () => {
    const ev = clickAnchor(window.location.origin + '/profile');
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not intercept clicks with modifier keys', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const ev = clickAnchor(window.location.origin + '/docs/intro', { metaKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not intercept cross-origin clicks', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const ev = clickAnchor('https://example.com/docs/intro');
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not intercept target=_blank', () => {
    registerRouteMode('/docs/:slug', 'ssr');
    const a = document.createElement('a');
    a.href = window.location.origin + '/docs/intro';
    a.target = '_blank';
    document.body.appendChild(a);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    a.remove();
    expect(ev.defaultPrevented).toBe(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test navigator
```

Expected: FAIL. interceptor functions do not exist.

- [ ] **Step 3: Implement the click interceptor**

Append to `packages/iso/src/navigator.ts`:

```ts
let installed = false;
let testingNavigate: ((url: string) => void) | null = null;

export function __setNavigateForTesting(fn: ((url: string) => void) | null): void {
  testingNavigate = fn;
}

function dispatchNavigate(url: string): void {
  if (testingNavigate) testingNavigate(url);
  else navigate(url); // implemented in Task 7
}

function shouldInterceptClick(event: MouseEvent): { url: string } | null {
  if (event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  if (event.button !== 0) return null;
  const target = event.composedPath().find(
    (el): el is HTMLAnchorElement =>
      el instanceof HTMLAnchorElement && !!el.href
  );
  if (!target) return null;
  if (target.origin !== location.origin) return null;
  if (target.hasAttribute('download')) return null;
  if (target.target && !/^_?self$/i.test(target.target)) return null;
  const href = target.getAttribute('href');
  if (!href || /^#/.test(href)) return null;
  return { url: target.href.replace(location.origin, '') };
}

function onClickCapture(event: MouseEvent): void {
  const decision = shouldInterceptClick(event);
  if (!decision) return;
  if (lookupRouteMode(decision.url) !== 'ssr') return;
  event.preventDefault();
  dispatchNavigate(decision.url);
}

export function installClickInterceptor(): void {
  if (installed) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('click', onClickCapture, true);
  installed = true;
}

export function uninstallClickInterceptor(): void {
  if (!installed) return;
  document.removeEventListener('click', onClickCapture, true);
  installed = false;
}

// Auto-install on first SSR registration in the browser.
const originalRegister = registerRouteMode;
export const registerRouteMode_AutoInstall = (path: string, mode: NavigateMode) => {
  originalRegister(path, mode);
  if (mode === 'ssr') installClickInterceptor();
};
```

Replace the original `registerRouteMode` body so it auto-installs:

```ts
export function registerRouteMode(path: string, mode: NavigateMode): void {
  routeModes.set(path, mode);
  if (mode === 'ssr') installClickInterceptor();
}
```

(Drop the `registerRouteMode_AutoInstall` helper from the previous draft; we just inline the auto-install into the canonical function.)

Also add a stub `navigate` function so the file type-checks:

```ts
export function navigate(url: string): void {
  // Implemented in Task 7.
  throw new Error('navigator.navigate() not yet implemented');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test navigator
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/navigator.ts packages/iso/src/__tests__/navigator.test.ts
git commit -m "feat(iso): add capture-phase click interceptor to navigator

Listener installs lazily the first time an SSR route registers and
mirrors preact-iso's link-click exclusion rules (modifiers, target,
cross-origin, download). For SSR-route hits, preventDefault and
hand off to navigate() (stub for now)."
```

---

## Task 7: Navigator fetch + dispatch

**Files:**
- Modify: `packages/iso/src/navigator.ts`
- Modify: `packages/iso/src/__tests__/navigator.test.ts`

`navigate(url)` aborts any in-flight request, fetches `url` with `X-HP-Navigate: fragment`, and dispatches each event in the response. `envelope` events apply head patches and call `setLatestFragment`. `redirect` events recursively call `navigate`. `fallback` or non-2xx fall back to `location.assign(url)`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/iso/src/__tests__/navigator.test.ts`:

```ts
import { navigate } from '../navigator.js';

describe('navigator.navigate()', () => {
  beforeEach(() => {
    clearRegistry();
    clearLatestFragment();
  });

  it('fetches URL with X-HP-Navigate: fragment and applies envelope', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        events: [{
          type: 'envelope',
          html: '<section id="loader-foo" data-loader="{}">x</section>',
          head: { title: 'Doc', metas: [], links: [] },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    registerRouteMode('/docs/:slug', 'ssr');

    const seen: string[] = [];
    subscribeToFragment('/docs/:slug', (h) => seen.push(h));

    await navigate('/docs/intro');

    expect(fetchSpy).toHaveBeenCalledWith('/docs/intro', expect.objectContaining({
      headers: expect.objectContaining({ 'X-HP-Navigate': 'fragment' }),
    }));
    expect(seen).toEqual(['<section id="loader-foo" data-loader="{}">x</section>']);
    expect(document.title).toBe('Doc');

    fetchSpy.mockRestore();
  });

  it('falls back to location.assign on non-2xx response', async () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignSpy, origin: window.location.origin },
      writable: true,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 })
    );
    registerRouteMode('/docs/*', 'ssr');
    await navigate('/docs/x');
    expect(assignSpy).toHaveBeenCalledWith('/docs/x');
    vi.restoreAllMocks();
  });

  it('follows redirect events to a new navigate call', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({
          events: [{ type: 'redirect', location: '/login' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        events: [{ type: 'envelope', html: '<p>login</p>', head: { title: 'Login', metas: [], links: [] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    registerRouteMode('/docs/:slug', 'ssr');
    registerRouteMode('/login', 'ssr');
    const seen: string[] = [];
    subscribeToFragment('/login', (h) => seen.push(h));
    await navigate('/docs/secret');
    expect(calls).toBe(2);
    expect(seen).toEqual(['<p>login</p>']);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @hono-preact/iso test navigator
```

Expected: FAIL. `navigate` is a stub.

- [ ] **Step 3: Implement `navigate`**

Replace the stub in `packages/iso/src/navigator.ts`:

```ts
let inflight: AbortController | null = null;

type Envelope = {
  type: 'envelope';
  html: string;
  head: { title?: string; metas?: { name?: string; content?: string; property?: string }[]; links?: { rel?: string; href?: string }[] };
};
type Redirect = { type: 'redirect'; location: string };
type Fallback = { type: 'fallback' };
type EventItem = Envelope | Redirect | Fallback;

function applyHead(head: Envelope['head']): void {
  if (typeof document === 'undefined') return;
  if (head.title !== undefined) document.title = head.title;
  // For metas/links: imperatively reconcile with hoofd-rendered tags.
  // v1 keeps this minimal; hoofd hooks in the hydrating tree will further
  // reconcile after hydrate fires. See spec "Hoofd reconciliation" risk note.
}

function findMatchingPattern(url: string): string | null {
  for (const [pattern] of routeModes) {
    if (exec(url, pattern, {})) return pattern;
  }
  return null;
}

export async function navigate(url: string): Promise<void> {
  if (testingNavigate) return testingNavigate(url) as unknown as void;
  if (inflight) inflight.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'X-HP-Navigate': 'fragment' },
      signal: ctrl.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    location.assign(url);
    return;
  }
  if (!res.ok) {
    location.assign(url);
    return;
  }
  let body: { events?: EventItem[] };
  try {
    body = await res.json();
  } catch {
    location.assign(url);
    return;
  }
  const events = body.events ?? [];
  for (const event of events) {
    if (event.type === 'envelope') {
      applyHead(event.head);
      const pattern = findMatchingPattern(url);
      if (pattern) setLatestFragment(pattern, event.html);
      // History update happens in Task 8 via LocationProvider integration.
      history.pushState(null, '', url);
    } else if (event.type === 'redirect') {
      await navigate(event.location);
      return;
    } else if (event.type === 'fallback') {
      location.assign(url);
      return;
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @hono-preact/iso test navigator
```

Expected: PASS.

- [ ] **Step 5: Add popstate handling**

Browser back/forward changes the URL synchronously and fires `popstate`. preact-iso's `LocationProvider` updates its location signal in response, but no fragment is fetched. PageHost would receive a new `location` prop while still showing the old fragment HTML, hydrating against mismatched DOM.

Add a `popstate` listener inside `installClickInterceptor` (rename it conceptually to "install handlers"; keep the name for now to avoid churn). Add a `push` option to `navigate` so popstate-triggered fetches don't double-push:

```ts
export async function navigate(
  url: string,
  opts: { push?: boolean } = { push: true }
): Promise<void> {
  // ... existing body ...
  // In the envelope branch, replace `history.pushState(null, '', url)` with:
  if (opts.push) history.pushState(null, '', url);
}

function onPopstate(): void {
  const url = location.pathname + location.search;
  if (lookupRouteMode(url) === 'ssr') {
    void navigate(url, { push: false });
  }
}
```

Inside `installClickInterceptor`, after `addEventListener('click', ...)`, also:

```ts
window.addEventListener('popstate', onPopstate);
```

And in `uninstallClickInterceptor`, also:

```ts
window.removeEventListener('popstate', onPopstate);
```

Append a test to `navigator.test.ts`:

```ts
describe('navigator popstate handling', () => {
  it('refetches the fragment on popstate for SSR routes without pushing state', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        events: [{ type: 'envelope', html: '<p>back</p>', head: {} }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const pushSpy = vi.spyOn(history, 'pushState');
    registerRouteMode('/docs/*', 'ssr');
    const seen: string[] = [];
    subscribeToFragment('/docs/*', (h) => seen.push(h));

    // Simulate browser back/forward to /docs/old.
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/docs/old', search: '' },
      writable: true,
    });
    window.dispatchEvent(new PopStateEvent('popstate'));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalledWith('/docs/old', expect.anything());
    expect(pushSpy).not.toHaveBeenCalled();
    expect(seen).toEqual(['<p>back</p>']);

    fetchSpy.mockRestore();
    pushSpy.mockRestore();
  });
});
```

Run:

```bash
pnpm --filter @hono-preact/iso test navigator
```

Expected: PASS for the new popstate test plus all prior tests.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/navigator.ts packages/iso/src/__tests__/navigator.test.ts
git commit -m "feat(iso): implement navigator.navigate() with fetch, dispatch, popstate

POST URL with X-HP-Navigate: fragment, dispatch envelope/redirect/fallback
events. Apply title from envelope.head and broadcast HTML to subscribed
PageHosts. Falls back to location.assign on network/parse failures.
Popstate refetches the fragment for SSR routes without pushing state,
keeping PageHost's island in sync with browser back/forward."
```

---

## Task 8: PageHost component (pre-island mode)

**Files:**
- Create: `packages/iso/src/page-host.tsx`
- Test: `packages/iso/src/__tests__/page-host.test.tsx`

The `PageHost` adapter that the Route wrapper substitutes for SSR routes. Pre-island mode: just renders the user's component with the location prop. We add island mode in Task 9.

- [ ] **Step 1: Write the failing test**

`packages/iso/src/__tests__/page-host.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { PageHost } from '../page-host.js';

afterEach(cleanup);

const loc = { path: '/docs/x', url: '/docs/x', searchParams: {}, pathParams: { slug: 'x' } } as RouteHook;

describe('PageHost (pre-island)', () => {
  it('renders the user component with location prop', () => {
    function User(props: RouteHook) {
      return <p data-testid="page">slug={props.pathParams!.slug}</p>;
    }
    render(
      <LocationProvider>
        <PageHost component={User} location={loc} path="/docs/:slug" />
      </LocationProvider>
    );
    expect(screen.getByTestId('page')).toHaveTextContent('slug=x');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test page-host
```

Expected: FAIL. `PageHost` does not exist.

- [ ] **Step 3: Implement pre-island `PageHost`**

Create `packages/iso/src/page-host.tsx`:

```tsx
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import { subscribeToFragment } from './navigator.js';

export type PageHostProps = {
  component: ComponentType<RouteHook>;
  location: RouteHook;
  path: string;
};

export function PageHost({ component: User, location, path }: PageHostProps) {
  const [fragment, setFragment] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToFragment(path, (html) => setFragment(html));
    return unsub;
  }, [path]);

  if (fragment === null) {
    return <User {...location} />;
  }
  // Island mode lands in Task 9. For now, fallback to user component so any
  // tests asserting pre-island behavior pass; the real island mode replaces
  // this branch.
  return <User {...location} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test page-host
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/page-host.tsx packages/iso/src/__tests__/page-host.test.tsx
git commit -m "feat(iso): add PageHost component (pre-island mode)

Subscribes to navigator fragments by path. Pre-island branch renders
the user component normally; island branch arrives in the next commit."
```

---

## Task 9: PageHost island mode

**Files:**
- Modify: `packages/iso/src/page-host.tsx`
- Modify: `packages/iso/src/__tests__/page-host.test.tsx`

When a fragment arrives, `PageHost` transitions: render a stable `<div ref dangerouslySetInnerHTML={{__html: ''}}>`, set `innerHTML = fragment` imperatively, run `preactHydrate(<User {...location} />, hostDiv)`. Subsequent fragments unmount + re-hydrate.

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/page-host.test.tsx`:

```tsx
import { setLatestFragment, clearLatestFragment } from '../navigator.js';

describe('PageHost (island mode)', () => {
  beforeEach(() => clearLatestFragment());

  it('splices fragment HTML and hydrates the user component into the host div', async () => {
    function User(props: RouteHook) {
      return <p data-testid="island">island slug={props.pathParams!.slug}</p>;
    }
    const { container } = render(
      <LocationProvider>
        <PageHost component={User} location={loc} path="/docs/:slug" />
      </LocationProvider>
    );
    // Server-rendered fragment: a <p> with the same shape as User would
    // produce, so hydrate matches.
    setLatestFragment('/docs/:slug', '<p data-testid="island">island slug=x</p>');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('island')).toHaveTextContent('island slug=x');
    // The host div is the only child rendered by the outer tree; the <p> is
    // inside it as a hydrated island.
    const host = container.querySelector('[data-hp-island="true"]');
    expect(host).not.toBeNull();
    expect(host!.querySelector('p')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test page-host
```

Expected: FAIL. current PageHost renders `<User />` instead of an island.

- [ ] **Step 3: Implement island mode**

Replace `packages/iso/src/page-host.tsx`:

```tsx
import { hydrate, render, h, type ComponentType, type RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RouteHook } from 'preact-iso';
import { subscribeToFragment } from './navigator.js';

export type PageHostProps = {
  component: ComponentType<RouteHook>;
  location: RouteHook;
  path: string;
};

export function PageHost({ component: User, location, path }: PageHostProps) {
  const [fragment, setFragment] = useState<string | null>(null);
  const hostRef: RefObject<HTMLDivElement> = useRef(null);

  useEffect(() => {
    const unsub = subscribeToFragment(path, (html) => setFragment(html));
    return unsub;
  }, [path]);

  useLayoutEffect(() => {
    if (fragment === null) return;
    const host = hostRef.current;
    if (!host) return;
    // Unmount any prior inner Preact tree at this host.
    render(null, host);
    // Replace DOM with new server-rendered HTML.
    host.innerHTML = fragment;
    // Hydrate the user component against the now-populated DOM.
    hydrate(h(User, location), host);
  }, [fragment, location]);

  if (fragment === null) {
    return <User {...location} />;
  }
  // Stable container. dangerouslySetInnerHTML={{__html: ''}} tells Preact's
  // outer reconciler not to manage children, so subsequent outer renders
  // never stomp the inner hydrate root. We mutate innerHTML imperatively
  // in useLayoutEffect.
  return (
    <div
      ref={hostRef}
      data-hp-island="true"
      dangerouslySetInnerHTML={{ __html: '' }}
    />
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test page-host
```

Expected: PASS.

- [ ] **Step 5: Run the full iso suite**

```bash
pnpm --filter @hono-preact/iso test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/page-host.tsx packages/iso/src/__tests__/page-host.test.tsx
git commit -m "feat(iso): PageHost island mode (innerHTML splice + preactHydrate)

When a fragment arrives, render a stable host div with empty
dangerouslySetInnerHTML so outer reconciliation never touches its
children. Imperatively assign innerHTML to the fragment and call
preactHydrate against it with the user component vnode. Loader's
moduleKey-based id reads its data-loader value from the spliced
DOM and renders synchronously, no /__loaders fetch."
```

---

## Task 10: Route wrapper

**Files:**
- Create: `packages/iso/src/route.tsx`
- Test: `packages/iso/src/__tests__/route.test.tsx`

Our `Route` component. For `navigate="ssr"`, register the path mode and substitute the user's component with a `PageHost` adapter. For everything else, pass through to `preact-iso`'s `Route`.

- [ ] **Step 1: Write the failing test**

`packages/iso/src/__tests__/route.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, Router } from 'preact-iso';
import { Route } from '../route.js';
import {
  lookupRouteMode,
  clearRegistry,
  setLatestFragment,
  clearLatestFragment,
} from '../navigator.js';

beforeEach(() => {
  clearRegistry();
  clearLatestFragment();
  window.history.pushState({}, '', '/');
});
afterEach(cleanup);

describe('<Route> wrapper', () => {
  it('passes through to preact-iso Route when navigate is omitted', async () => {
    function Page() { return <p data-testid="spa">spa</p>; }
    window.history.pushState({}, '', '/spa');
    render(
      <LocationProvider>
        <Router>
          <Route path="/spa" component={Page} />
        </Router>
      </LocationProvider>
    );
    expect(await screen.findByTestId('spa')).toHaveTextContent('spa');
    expect(lookupRouteMode('/spa')).toBe('spa');
  });

  it('registers SSR mode when navigate="ssr"', () => {
    function Page() { return null; }
    render(
      <LocationProvider>
        <Router>
          <Route path="/docs/:slug" component={Page} navigate="ssr" />
        </Router>
      </LocationProvider>
    );
    expect(lookupRouteMode('/docs/intro')).toBe('ssr');
  });

  it('substitutes PageHost for SSR routes', async () => {
    function Page(props: any) {
      return <p data-testid="spa-render">spa-render slug={props.pathParams.slug}</p>;
    }
    window.history.pushState({}, '', '/docs/intro');
    render(
      <LocationProvider>
        <Router>
          <Route path="/docs/:slug" component={Page} navigate="ssr" />
        </Router>
      </LocationProvider>
    );
    // Pre-island: same as SPA-mode
    expect(await screen.findByTestId('spa-render')).toHaveTextContent('spa-render slug=intro');

    // Island: deliver a fragment matching that path pattern
    setLatestFragment('/docs/:slug', '<p data-testid="island-render">island</p>');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('island-render')).toHaveTextContent('island');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hono-preact/iso test route
```

Expected: FAIL. `Route` from local module does not exist.

- [ ] **Step 3: Implement the wrapper**

Create `packages/iso/src/route.tsx`:

```tsx
import type { ComponentType } from 'preact';
import { Route as PreactIsoRoute, type RouteHook } from 'preact-iso';
import { PageHost } from './page-host.js';
import { registerRouteMode, type NavigateMode } from './navigator.js';

export type RouteProps = {
  path?: string;
  default?: boolean;
  component: ComponentType<RouteHook>;
  navigate?: NavigateMode;
};

export function Route({ component, navigate, path, ...rest }: RouteProps) {
  if (navigate === 'ssr' && path) {
    registerRouteMode(path, 'ssr');
    const HostedComponent: ComponentType<RouteHook> = (props) => (
      <PageHost component={component} location={props} path={path} />
    );
    HostedComponent.displayName = `SsrRoute(${path})`;
    return <PreactIsoRoute path={path} component={HostedComponent} {...rest} />;
  }
  return <PreactIsoRoute path={path} component={component} {...rest} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm --filter @hono-preact/iso test route
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/route.tsx packages/iso/src/__tests__/route.test.tsx
git commit -m "feat(iso): add Route wrapper with navigate prop

For navigate=\"ssr\" routes: register the path in the navigator's
mode registry and substitute the user's component with a PageHost
adapter. Otherwise pass through to preact-iso's Route."
```

---

## Task 11: Update package exports

**Files:**
- Modify: `packages/iso/src/index.ts`

Replace the `Route` re-export from `preact-iso` with our wrapper. Add `PageHost`, `navigate` (the public navigator function), and the `NavigateMode` type. Keep `Router` and `lazy` as `preact-iso` re-exports.

- [ ] **Step 1: Edit `packages/iso/src/index.ts`**

Find this block:

```ts
// Routing primitives: trivial re-exports of preact-iso. Listed here so
// consumers have a single import surface for everything they need.
export { Route, Router, lazy } from 'preact-iso';
```

Replace with:

```ts
// Routing primitives. Router and lazy are direct re-exports of preact-iso;
// Route is our wrapper that adds the optional navigate="ssr" prop.
export { Router, lazy } from 'preact-iso';
export { Route } from './route.js';
export type { RouteProps, NavigateMode } from './route.js';

// Programmatic navigation that respects per-route SSR/SPA mode.
export { navigate } from './navigator.js';

// Hydration island used by SSR routes (also exported so advanced consumers
// can compose their own routing).
export { PageHost } from './page-host.js';
export type { PageHostProps } from './page-host.js';
```

If `RouteProps` lives only in `route.tsx`, the type re-export above is correct. If `NavigateMode` is defined in `navigator.ts`, change the type re-export source:

```ts
export type { RouteProps } from './route.js';
export type { NavigateMode } from './navigator.js';
```

- [ ] **Step 2: Run the iso build to confirm types compile**

```bash
pnpm --filter @hono-preact/iso build
```

Expected: clean build.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: PASS. Apps/app should still build and pass tests because it imports `Route` from `@hono-preact/iso` and our wrapper is API-compatible (only adds optional `navigate`).

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/index.ts
git commit -m "refactor(iso): export Route wrapper, PageHost, and navigate

Replace the preact-iso Route re-export with our wrapper that adds the
optional navigate=\"ssr\" prop. Router and lazy stay as re-exports.
Also exposes navigate() for programmatic same-mode navigation, and
PageHost for advanced consumers composing custom routers."
```

---

## Task 12: End-to-end verification (apply navigate="ssr" to a real route)

**Files:**
- Modify: `apps/app/src/iso.tsx`
- Test: `apps/app/src/__tests__/ssr-navigation.test.tsx` (create)

Wire up one SSR route in the app to confirm the whole pipeline. Using `/test` as the candidate (a static page; no nested router complications). The test validates that:
1. Initial document load of `/test` works as today.
2. Client-side navigation from `/` to `/test` triggers a fragment fetch (not `/__loaders`), splices HTML, and hydrates the page with no Suspense fallback flicker.

- [ ] **Step 1: Update `apps/app/src/iso.tsx`**

Edit:

```tsx
<Route path="/test" component={Test} />
```

to:

```tsx
<Route path="/test" component={Test} navigate="ssr" />
```

(`Route` is already imported from `@hono-preact/iso`; nothing else changes.)

- [ ] **Step 2: Build the app and run unit tests**

```bash
pnpm --filter app build
pnpm test
```

Expected: clean build, all tests pass.

- [ ] **Step 3: Manual verification (dev server)**

```bash
pnpm --filter app dev
```

Open the app in a browser. Navigate to `/`. Open DevTools Network panel. Click a link to `/test`.

Expected:
- A request to `/test` with header `X-HP-Navigate: fragment`.
- The response Content-Type is `application/json`.
- The response body is `{"events":[{"type":"envelope","html":"...","head":{...}}]}`.
- No request to `/__loaders` (the test page has no loader anyway, but verify the absence).
- The page content swaps without a fallback flicker.

For a route with a loader, navigate to `/movies` (still SPA-mode, so it should hit `/__loaders` for now). Then change `<Route path="/movies" component={Movies} />` in `iso.tsx` to `navigate="ssr"`, restart, and verify that `/movies` navigation now uses the fragment endpoint and the loader's serialized data appears in the response HTML's `data-loader` attribute.

After confirming, **revert any speculative `navigate="ssr"` changes you don't want to commit** and keep only the `/test` (or whichever single route you intend to ship in v1) change.

- [ ] **Step 4: Write an integration test**

`apps/app/src/__tests__/ssr-navigation.test.tsx`:

```tsx
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import app from '../server.js';

describe('SSR navigation end-to-end', () => {
  it('returns a fragment envelope for an SSR-mode route', async () => {
    const res = await app.request('/test', {
      headers: { 'X-HP-Navigate': 'fragment' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].type).toBe('envelope');
    expect(body.events[0].html).not.toContain('hp-page-fragment');
    expect(body.events[0].html.length).toBeGreaterThan(0);
    expect(body.events[0].head).toBeDefined();
  });

  it('returns a full HTML document without the header', async () => {
    const res = await app.request('/test');
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<!doctype html>');
    expect(text).not.toContain('hp-page-fragment');
  });
});
```

- [ ] **Step 5: Run the integration test**

```bash
pnpm --filter app test
```

Expected: PASS for both.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/iso.tsx apps/app/src/__tests__/ssr-navigation.test.tsx
git commit -m "feat(app): apply navigate=\"ssr\" to /test for end-to-end validation

Wires the SSR navigation pipeline through one real route. Adds an
integration test that verifies the fragment envelope shape end-to-end
through the app's server entry."
```

---

## Self-Review Checklist (run after completing all tasks)

- [ ] All spec acceptance criteria covered:
  - [ ] No `/__loaders` request on SSR-route navigation (Task 7 + Task 12 manual).
  - [ ] Exactly one `fetch` to the URL with `X-HP-Navigate: fragment` (Task 7).
  - [ ] Persistent layout above the route stays mounted (structural; verify in Task 12 manual).
  - [ ] Server-rendered HTML in the DOM before component code runs (Task 9 island mode).
  - [ ] Initial document load works unchanged (Task 4 + Task 12 second test).
  - [ ] SPA-mode routes alongside SSR-mode behave as today (Task 10 first test, Task 11).
  - [ ] Lazy SSR routes work on first navigation (Task 10 covers this; mode is read from the JSX prop, not the resolved chunk).
  - [ ] Loader wire id matches across all renders (Task 1).
  - [ ] Browser back/forward refetches the fragment for SSR routes (Task 7 step 5).
- [ ] No "TBD"/"TODO"/"placeholder" left in code or tests.
- [ ] All test commands run cleanly: `pnpm test` and `pnpm --filter app build`.
- [ ] Spec risks reviewed: nested prerender risk is sidestepped by the sentinel-extraction approach (used in Task 4); `dangerouslySetInnerHTML` outer-rerender stomping is mitigated by stable `__html=''` in Task 9.

---

**Plan complete.** Two execution options:

1. **Subagent-Driven (recommended)**: dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution**: execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
