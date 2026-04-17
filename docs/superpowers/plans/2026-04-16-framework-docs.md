# Framework Documentation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write five MDX documentation pages for the hono-preact template, covering project structure, adding pages, server loaders, and build & deploy.

**Architecture:** MDX files live in `src/pages/docs/` and are auto-discovered as `/docs/*` routes via `import.meta.glob` in `iso.tsx`. One routing tweak is needed to map `index.mdx` to `/docs` rather than `/docs/index`. All other pages register automatically with no code changes.

**Tech Stack:** Preact, Hono, preact-iso, Vite, MDX, Cloudflare Workers, Tailwind CSS v4

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/iso.tsx` | Strip trailing `/index` from derived MDX routes |
| Modify | `src/pages/home.tsx` | Update docs nav link to point to `/docs` |
| Create | `src/pages/docs/index.mdx` | Landing page — stack overview, links to topics |
| Create | `src/pages/docs/structure.mdx` | Annotated project structure |
| Create | `src/pages/docs/pages.mdx` | How to add pages — routing, lazy loading, MDX |
| Create | `src/pages/docs/loaders.mdx` | Server loaders — getLoaderData, serverLoader, plugins |
| Create | `src/pages/docs/deployment.mdx` | Two-pass Vite build, wrangler config, deploy |

---

## Task 1: Routing tweak — map `index.mdx` to `/docs`

**Files:**
- Modify: `src/iso.tsx` (route derivation, lines ~14-16)

- [ ] **Step 1: Open `src/iso.tsx` and locate the route derivation**

Find this block (around line 14):
```ts
const mdxRoutes = Object.entries(mdxModules).map(([filePath, load]) => {
  const route = '/docs' + filePath.replace('./pages/docs', '').replace('.mdx', '');
```

- [ ] **Step 2: Add the `/index` strip**

Replace that line with:
```ts
const route = ('/docs' + filePath.replace('./pages/docs', '').replace('.mdx', ''))
  .replace(/\/index$/, '') || '/docs';
```

The full updated block becomes:
```ts
const mdxRoutes = Object.entries(mdxModules).map(([filePath, load]) => {
  const route = ('/docs' + filePath.replace('./pages/docs', '').replace('.mdx', ''))
    .replace(/\/index$/, '') || '/docs';
```

- [ ] **Step 3: Verify in dev server**

Run: `npm run dev`

Visit `http://localhost:5173/docs` — expect a 404 (index.mdx doesn't exist yet). That's correct; the route derivation fix is confirmed working once Task 3 creates the file.

Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/iso.tsx
git commit -m "fix: strip /index suffix from MDX routes so index.mdx maps to /docs"
```

---

## Task 2: Update home page docs link

**Files:**
- Modify: `src/pages/home.tsx`

- [ ] **Step 1: Update the docs `<a>` href**

In `src/pages/home.tsx`, find:
```tsx
<a href="/docs/hello" class="bg-purple-300">
  docs
</a>
```

Replace with:
```tsx
<a href="/docs" class="bg-purple-300">
  docs
</a>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/home.tsx
git commit -m "chore: update home docs link to /docs"
```

---

## Task 3: Create `/docs` landing page

**Files:**
- Create: `src/pages/docs/index.mdx`

- [ ] **Step 1: Create `src/pages/docs/index.mdx`** with this content:

```mdx
[← home](/)

# hono-preact

A full-stack template that pairs Hono's edge-ready HTTP layer with Preact's lightweight UI and preact-iso's SSR + hydration primitives, compiled by Vite and deployed to Cloudflare Workers.

## Stack

| Layer | Tool | Role |
|-------|------|------|
| HTTP server | Hono | API routes, middleware, catch-all SSR handler |
| UI | Preact + preact-iso | Components, client-side routing, SSR + hydration |
| Build | Vite | Dev server, two-pass production build |
| Styles | Tailwind CSS v4 | Utility-first CSS |
| Deploy | Cloudflare Workers | Edge runtime |

## Docs

- [Project Structure](/docs/structure) — what each file and folder does
- [Adding Pages](/docs/pages) — routing conventions, lazy loading, MDX
- [Server Loaders](/docs/loaders) — isomorphic data fetching
- [Build & Deploy](/docs/deployment) — Vite build pipeline and Wrangler
```

- [ ] **Step 2: Verify in dev server**

Run: `npm run dev`

Visit `http://localhost:5173/docs` — expect the landing page to render with the stack table and four links.

Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/pages/docs/index.mdx
git commit -m "docs: add /docs landing page"
```

---

## Task 4: Create `/docs/structure` — project structure

**Files:**
- Create: `src/pages/docs/structure.mdx`

- [ ] **Step 1: Create `src/pages/docs/structure.mdx`** with this content:

````mdx
[← docs](/docs)

# Project Structure

```
hono-preact/
├── src/
│   ├── server.tsx              # Hono app — API routes + catch-all SSR handler
│   ├── client.tsx              # Browser entry — hydrates the Preact app
│   ├── iso.tsx                 # Shared component tree — Router + route registration
│   ├── pages/                  # Page components (one file per route)
│   │   └── docs/               # MDX content pages (auto-discovered as /docs/* routes)
│   ├── server/                 # Server-only code
│   │   ├── layout.tsx          # HTML shell rendered on every request
│   │   ├── context.ts          # Hono context passed to server-side components
│   │   └── middleware/         # Hono middleware (e.g. location)
│   ├── iso/                    # Isomorphic utilities — loader, cache, preload
│   ├── components/             # Shared UI components
│   ├── styles/                 # Global CSS
│   └── shims/                  # Browser environment shims (e.g. process)
├── vite.config.ts              # Two build configs: client bundle + Worker bundle
├── vite-plugin-server-only.ts  # Custom Vite plugins for server-only enforcement
├── wrangler.jsonc              # Cloudflare Workers deployment config
└── tsconfig.json
```

## Key files

### `src/server.tsx`

The Hono application. Defines API routes and a catch-all `GET *` handler that SSR-renders the full Preact app via `prerender` from preact-iso, then injects `<head>` tags and returns the HTML response.

```ts
app
  .get('/api/movies', async (c) => { ... })
  .get('*', async (c) => {
    const { html } = await prerender(<Layout context={c} />);
    return c.html(`<!doctype html>${html}`);
  });
```

### `src/client.tsx`

The browser entry point. Picks up the server-rendered HTML and hydrates it in place. Runs only in the browser.

```ts
hydrate(<App />, document.getElementById('app'));
```

### `src/iso.tsx`

The shared component tree used by both the server (via `Layout`) and the client (via hydration). Defines the `<Router>` with all routes, including lazy-loaded standard pages and auto-discovered MDX pages.

```ts
const mdxModules = import.meta.glob('./pages/docs/*.mdx');
// Each .mdx file becomes a lazy /docs/* route — no manual registration needed.
```

### `src/server/layout.tsx`

Renders the full HTML shell: `<head>`, `<body>`, the `#app` mount point, and the `<script>` tag that loads the client bundle. The catch-all route in `server.tsx` renders this component and wraps its output in `<!doctype html>`.

### `src/iso/`

Isomorphic utilities shared between server and client:

- `loader.tsx` — `getLoaderData` HOC and `Loader<T>` type
- `page.tsx` — `Page` component: runs serverLoader on the server, clientLoader in the browser
- `cache.ts` — simple in-memory cache to avoid re-fetching on client-side navigation
- `preload.ts` — reads loader data serialized into `data-loader` attributes on first hydration

### `vite-plugin-server-only.ts`

Two custom Vite plugins:

- **`serverOnlyPlugin`** — during the client bundle build, replaces any `*.server.*` import with a no-op stub so server code never reaches the browser
- **`serverLoaderValidationPlugin`** — fails the build if a `.server.*` file has named exports; the server loader must be the default export
````

- [ ] **Step 2: Verify in dev server**

Run: `npm run dev`

Visit `http://localhost:5173/docs/structure` — expect the annotated tree and key files section to render correctly.

Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/pages/docs/structure.mdx
git commit -m "docs: add /docs/structure page"
```

---

## Task 5: Create `/docs/pages` — adding pages

**Files:**
- Create: `src/pages/docs/pages.mdx`

- [ ] **Step 1: Create `src/pages/docs/pages.mdx`** with this content:

````mdx
[← docs](/docs)

# Adding Pages

There are two kinds of pages in this template: standard Preact pages and MDX content pages. Both are lazy-loaded (code-split) and registered as preact-iso routes.

## Standard Preact pages

Standard pages require three steps: create the file, register it in `iso.tsx`, and add a `<Route>`.

### Step 1 — Create `src/pages/about.tsx`

```tsx
import type { FunctionComponent } from 'preact';
import { getLoaderData } from '@/iso/loader.js';

const About: FunctionComponent = () => {
  return <section>About this app.</section>;
};

About.displayName = 'About';
About.defaultProps = { route: '/about' };

export default getLoaderData(About);
```

Two things to note:

- **`defaultProps.route`** — tells preact-iso which path this component owns during SSR. It must match the `path` prop on the corresponding `<Route>`.
- **`getLoaderData`** — required even for pages with no data. It wraps the component in the loader/preload system so hydration works correctly.

### Step 2 — Register in `src/iso.tsx`

```tsx
// Add the lazy import near the top with the other page imports:
const About = lazy(() => import('./pages/about.js'));

// Add a Route inside <Router>:
<Route path="/about" component={About} />
```

### Step 3 — Link to it

From anywhere in the app:

```tsx
<a href="/about">About</a>
```

preact-iso intercepts clicks on same-origin `<a>` tags and handles them as client-side navigations.

## MDX docs pages

MDX pages in `src/pages/docs/` are auto-discovered — no changes to `iso.tsx` are needed.

**Create `src/pages/docs/my-page.mdx`:**

```mdx
[← docs](/docs)

# My Page

Content written in Markdown with optional JSX components.
```

It is immediately available at `/docs/my-page`. The route is derived from the filename.

**Supported MDX features:**

- All standard Markdown syntax
- Inline JSX — import and use any Preact component
- Frontmatter is not processed by default (no remark-frontmatter configured)

**Note on `index.mdx`:** The file `src/pages/docs/index.mdx` is a special case — the routing logic strips its trailing `/index` to serve it at `/docs` rather than `/docs/index`.

## View transitions

Route changes trigger a view transition if the browser supports `document.startViewTransition`. This is wired up in `iso.tsx` via the `onRouteChange` callback passed to `<Router>`. No per-page setup is needed.
````

- [ ] **Step 2: Verify in dev server**

Run: `npm run dev`

Visit `http://localhost:5173/docs/pages` — expect all three sections to render with correct code blocks.

Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/pages/docs/pages.mdx
git commit -m "docs: add /docs/pages page"
```

---

## Task 6: Create `/docs/loaders` — server loaders

**Files:**
- Create: `src/pages/docs/loaders.mdx`

- [ ] **Step 1: Create `src/pages/docs/loaders.mdx`** with this content:

````mdx
[← docs](/docs)

# Server Loaders

Pages often need data. On the server, that data should come from a direct function call. In the browser, it must come via fetch. Writing this branch manually on every page is error-prone — the loader system handles it automatically.

## How it works

Split data fetching into two files that live next to the page:

- `movies.server.ts` — runs only on the server; direct DB or internal API calls
- `movies.tsx` — imports both loaders and passes them to `getLoaderData`

The `Page` component (in `src/iso/page.tsx`) runs the right loader depending on the environment.

**At runtime:**
1. **SSR:** `serverLoader` runs during `prerender`. Its return value is JSON-serialized into a `data-loader` attribute on the page's wrapper element.
2. **Hydration (first load):** The client reads that attribute — no fetch is fired.
3. **Client-side navigation:** `clientLoader` runs and its result is cached for the session.

## Example: listing page

**`src/pages/movies.server.ts`** — server-only data fetching:

```ts
import { getMovies } from '@/server/movies.js';
import type { Loader } from '@/iso/loader.js';

const serverLoader: Loader<{ movies: MovieList }> = async () => {
  const movies = await getMovies(); // direct call — never runs in the browser
  return { movies };
};

export default serverLoader;
```

**`src/pages/movies.tsx`** — the page component:

```tsx
import { getLoaderData, type LoaderData } from '@/iso/loader.js';
import serverLoader from './movies.server.js';
import { createCache } from '@/iso/cache.js';
import type { LocationHook } from 'preact-iso';

const cache = createCache<{ movies: MovieList }>();

const clientLoader = cache.wrap(async ({}: { location: LocationHook }) => {
  const movies = await fetch('/api/movies').then(r => r.json());
  return { movies };
}, '/movies');

const Movies: FunctionComponent<LoaderData<{ movies: MovieList }>> = ({ loaderData }) => {
  return (
    <ul>
      {loaderData?.movies.results.map(m => <li key={m.id}>{m.title}</li>)}
    </ul>
  );
};

Movies.defaultProps = { route: '/movies' };
export default getLoaderData(Movies, { serverLoader, clientLoader, cache });
```

## Example: detail page (using route params)

`Loader<T>` receives `{ location }` which carries `location.pathParams`. Use this to load a record by ID:

```ts
// src/pages/movie.server.ts
import { getMovie } from '@/server/movies.js';
import type { Loader } from '@/iso/loader.js';

const serverLoader: Loader<{ movie: Movie }> = async ({ location }) => {
  const movie = await getMovie(location.pathParams.id);
  return { movie };
};

export default serverLoader;
```

## The server-only plugins

Two custom Vite plugins (in `vite-plugin-server-only.ts`) enforce the boundary between server and client code:

**`serverOnlyPlugin`** — during the client bundle build, every import of a `*.server.*` file is rewritten to an inert stub:

```ts
const serverLoader = async () => ({});
```

This guarantees that database clients, internal API URLs, and secrets in `.server.*` files never reach the browser bundle, even if you forget to think about it.

**`serverLoaderValidationPlugin`** — fails the build if a `.server.*` file has named exports. If you write:

```ts
// ❌ build error
export const helper = () => {};
export default serverLoader;
```

The build will fail with:
```
'.server files must not have named exports (found: helper). Export the server loader as the default export only.'
```

This prevents server-only state from accidentally entering the module graph via named exports.
````

- [ ] **Step 2: Verify in dev server**

Run: `npm run dev`

Visit `http://localhost:5173/docs/loaders` — expect all three sections (listing example, detail example, plugins) to render with correct code blocks.

Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/pages/docs/loaders.mdx
git commit -m "docs: add /docs/loaders page"
```

---

## Task 7: Create `/docs/deployment` — build & deploy

**Files:**
- Create: `src/pages/docs/deployment.mdx`

- [ ] **Step 1: Create `src/pages/docs/deployment.mdx`** with this content:

````mdx
[← docs](/docs)

# Build & Deploy

## Development

```bash
npm run dev
```

Starts the Vite dev server (`NODE_ENV=development vite --force`) with the `@hono/vite-dev-server` Cloudflare adapter. Hot module replacement works for both client components and server code. The `--force` flag disables Vite's dependency cache, which prevents stale module resolution issues during development.

## Two-pass production build

```bash
npm run build
```

This runs two Vite builds sequentially:

**Pass 1 — client bundle** (`vite build --mode client`):

Produces the browser bundle in `dist/static/`. The `serverOnlyPlugin` replaces all `*.server.*` imports with no-op stubs so server code never enters the browser bundle.

Output:
```
dist/static/client.js       # main client entry
dist/static/<name>-<hash>.js # lazy page chunks
dist/static/<name>-<hash>.css
```

**Pass 2 — Worker bundle** (`vite build`):

Produces the Cloudflare Workers bundle at `dist/index.js`. The `@hono/vite-build` plugin handles bundling for the Workers runtime. Client assets from Pass 1 are included in `dist/` so the Worker can serve them.

The two-pass approach is necessary because the client and server targets have different runtimes (browser vs. Workers edge runtime) and different Vite plugin configurations.

## Local preview

```bash
npm run preview
```

Runs the full production build then starts Wrangler's local dev mode. This is closer to the real Cloudflare environment than the Vite dev server and is the right tool for testing production behaviour locally.

## Configuring `wrangler.jsonc`

Before deploying, update `wrangler.jsonc`:

```jsonc
{
  "name": "your-app-name",       // ← change this to your Worker name
  "main": "dist/index.js",
  "compatibility_date": "2026-02-22",
  "assets": {
    "directory": "./dist"        // serves dist/static/* as static assets
  },
  "compatibility_flags": ["nodejs_compat"]
}
```

`assets.directory` points Cloudflare to `dist/` so static files (JS chunks, CSS) are served automatically from the CDN alongside the Worker. The Worker itself handles all HTML responses via the catch-all route.

## Deploy

```bash
npm run deploy
```

Runs `wrangler deploy`, which uploads `dist/index.js` as the Worker script and the contents of `dist/` as static assets to Cloudflare's global network.
````

- [ ] **Step 2: Verify in dev server**

Run: `npm run dev`

Visit `http://localhost:5173/docs/deployment` — expect all sections (dev, build, preview, config, deploy) to render with correct code blocks.

Kill the dev server.

- [ ] **Step 3: Verify the full docs site**

With the dev server still running, visit:
- `http://localhost:5173/docs` — landing with links
- `http://localhost:5173/docs/structure` — annotated tree
- `http://localhost:5173/docs/pages` — adding pages guide
- `http://localhost:5173/docs/loaders` — server loaders guide
- `http://localhost:5173/docs/deployment` — build & deploy guide
- `http://localhost:5173/` — home page "docs" link goes to `/docs`

Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/pages/docs/deployment.mdx
git commit -m "docs: add /docs/deployment page"
```
