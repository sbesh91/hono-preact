# Framework Documentation

**Date:** 2026-04-16
**Status:** Draft

## Overview

Write developer-facing documentation for the hono-preact template, targeting intermediate developers (familiar with Hono, Preact, and Cloudflare Workers) who are adopting the template to build their own apps. Docs are authored as MDX files in `src/pages/docs/` and served as live pages at `/docs/*`.

## Audience & Assumptions

Readers know Hono, Preact, and Cloudflare Workers. The docs explain how *this template* wires those tools together, not the tools themselves.

## Pages

| File | Route | Purpose |
|------|-------|---------|
| `src/pages/docs/index.mdx` | `/docs` | Landing — stack overview, navigation to topic pages |
| `src/pages/docs/structure.mdx` | `/docs/structure` | Annotated project structure |
| `src/pages/docs/pages.mdx` | `/docs/pages` | Adding pages — routing, lazy loading, MDX |
| `src/pages/docs/loaders.mdx` | `/docs/loaders` | Server loaders — `getLoaderData`, `serverLoader`, server-only plugin |
| `src/pages/docs/deployment.mdx` | `/docs/deployment` | Build pipeline and Cloudflare Workers deploy |

## Routing Tweak Required

The current glob-based route derivation in `iso.tsx` maps `index.mdx` to `/docs/index`, not `/docs`. The route derivation must strip a trailing `/index`:

```ts
const route = ('/docs' + filePath.replace('./pages/docs', '').replace('.mdx', ''))
  .replace(/\/index$/, '') || '/docs';
```

## Content Design

### `/docs` — Landing

- One-paragraph description of the template and its purpose
- Stack at a glance table: Hono (HTTP server + SSR handler), Preact (UI + hydration via preact-iso), Vite (dev server + two-pass build), Tailwind CSS (utility styles), Cloudflare Workers (deployment target)
- Links to the four topic pages

### `/docs/structure` — Project Structure

Annotated directory tree:

```
hono-preact/
├── src/
│   ├── server.tsx          # Hono app — API routes + catch-all SSR handler
│   ├── client.tsx          # Browser entry — hydrates the Preact app
│   ├── iso.tsx             # Shared component tree — Router + route registration
│   ├── pages/              # Page components (one file per route)
│   │   └── docs/           # MDX content pages (auto-discovered as /docs/* routes)
│   ├── server/             # Server-only code — layout, middleware, data fetching
│   │   ├── layout.tsx      # HTML shell rendered on every request
│   │   ├── context.ts      # Hono context passed to server-side components
│   │   └── middleware/     # Hono middleware (e.g. location)
│   ├── iso/                # Isomorphic utilities — loader, cache, preload
│   ├── components/         # Shared UI components
│   ├── styles/             # Global CSS
│   └── shims/              # Browser environment shims (e.g. process)
├── vite.config.ts          # Two build configs: client bundle + Worker bundle
├── vite-plugin-server-only.ts  # Custom Vite plugins for server-only enforcement
├── wrangler.jsonc          # Cloudflare Workers deployment config
└── tsconfig.json
```

Prose expands on: `server.tsx` (Hono app entry, API routes, catch-all SSR via `prerender`), `client.tsx` (hydration entry, `hydrate(<App />, app)`), `iso.tsx` (shared router registered in both server and client paths, MDX auto-discovery — note: `index.mdx` currently routes to `/docs/index` without the routing tweak described in the Routing Tweak Required section), `src/server/` (layout renders the HTML shell including the client script tag), `src/iso/` (loader system, cache, preload utilities).

### `/docs/pages` — Adding Pages

**Standard Preact page — three steps:**

Step 1: Create `src/pages/about.tsx`:
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

Step 2: Register in `iso.tsx`:
```tsx
const About = lazy(() => import('./pages/about.js'));

// inside <Router>:
<Route path="/about" component={About} />
```

Step 3: Link to it however you like.

**Key points:**
- All pages are wrapped in `lazy()` for code splitting — each page is a separate chunk
- `defaultProps.route` tells preact-iso the path this component owns during SSR; it must match the `<Route path>` value
- `getLoaderData` is required even for pages with no data — it wires the component into the loader/preload system

**MDX docs pages — zero registration:**

Drop a `.mdx` file in `src/pages/docs/` and it is automatically available at `/docs/<filename>`. No changes to `iso.tsx` are needed.

```mdx
# My Page

Content written in Markdown with optional JSX components.
```

Available at `/docs/my-page`.

Note: `index.mdx` is a special case — the routing derivation in `iso.tsx` must strip the trailing `/index` to map it to `/docs` rather than `/docs/index`. This is covered in the Routing Tweak Required section; once applied, `index.mdx` serves as the `/docs` landing page.

### `/docs/loaders` — Server Loaders

**The problem:** On the server, data should be fetched directly (no HTTP round-trip). In the browser, the same data must come via a fetch call. Writing this branch manually on every page is error-prone.

**The solution:** Split the data fetching into two files. The template wires them up so the right one runs in the right environment.

**File naming:** Server loader files must match `*.server.ts` (or `.server.tsx`). The Vite server-only plugin enforces that these files never reach the client bundle.

**`src/pages/movies.server.ts`:**
```ts
import { getMovies } from '@/server/movies.js';
import type { Loader } from '@/iso/loader.js';

const serverLoader: Loader<{ movies: MovieList }> = async () => {
  const movies = await getMovies(); // direct DB/API call — server only
  return { movies };
};

export default serverLoader;
```

**`src/pages/movies.tsx`:**
```tsx
import { getLoaderData, type LoaderData } from '@/iso/loader.js';
import serverLoader from './movies.server.js';
import { createCache } from '@/iso/cache.js';

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

**How it works at runtime:**
- **Server (SSR):** `serverLoader` runs during `prerender`. Its return value is JSON-serialized into a `data-loader` attribute on the page's root element.
- **Client (first load):** The hydration entry reads that attribute — no fetch is fired.
- **Client (navigation):** `clientLoader` runs and its result is cached for the lifetime of the session.

**When you need route params:** `Loader<T>` receives `{ location }` which carries `location.pathParams` — useful for detail pages:

```ts
// movie.server.ts
const serverLoader: Loader<{ movie: Movie }> = async ({ location }) => {
  const movie = await getMovie(location.pathParams.id);
  return { movie };
};
```

**The server-only Vite plugin:** During the client bundle build, any import of a `*.server.*` file is replaced with `const serverLoader = async () => ({})` — an inert stub. This guarantees server-only code (DB clients, secrets, internal APIs) never reaches the browser bundle. If you accidentally add a named export to a `.server` file, the build will fail with: `'.server files must not have named exports (found: <names>). Export the server loader as the default export only.'` The `serverLoaderValidationPlugin` enforces default-export-only at build time so server-only state cannot enter the module graph.

### `/docs/deployment` — Build & Deploy

**Development:**
```bash
npm run dev
```
Starts the Vite dev server (`NODE_ENV=development vite --force`) with the `@hono/vite-dev-server` Cloudflare adapter. Hot module replacement works for both client components and server code.

**Two-pass production build:**
```bash
npm run build
```
This runs two Vite builds sequentially:

1. `vite build --mode client` — produces the client bundle in `dist/static/`. The `serverOnlyPlugin` replaces all `*.server.*` imports with stubs so server code never enters the browser bundle.
2. `vite build` — produces the Cloudflare Workers bundle at `dist/index.js`, including the client assets copied from the first pass.

The two-pass approach is necessary because the client and server bundles have different targets (browser vs. Workers) and different plugin configurations.

**Local preview (Workers runtime):**
```bash
npm run preview
```
Runs the full production build then starts Wrangler's local dev mode — closer to the real Cloudflare environment than the Vite dev server.

**`wrangler.jsonc` — what to configure before deploying:**
```jsonc
{
  "name": "hono-preact",        // your Worker name — change this
  "main": "dist/index.js",
  "compatibility_date": "2026-02-22",
  "assets": {
    "directory": "./dist"       // serves static/client.js and other assets
  },
  "compatibility_flags": ["nodejs_compat"]
}
```

Change `name` to match your project. The `assets.directory` points Cloudflare to `dist/` so static files are served automatically alongside the Worker.

**Deploy:**
```bash
npm run deploy
```
Runs `wrangler deploy`, which uploads `dist/index.js` as the Worker and the contents of `dist/` as static assets to Cloudflare's network.

## Out of Scope (this iteration)

- MDX docs pages topic (deferred to a future docs page)
- API reference for `iso/` utilities
- Environment variables / secrets management
- Custom Tailwind configuration guide
