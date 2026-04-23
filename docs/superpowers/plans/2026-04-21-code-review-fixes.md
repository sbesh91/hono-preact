# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve 9 issues surfaced by post-implementation code review across package metadata, Vite config safety, test coverage, type safety, error handling, and documentation.

**Architecture:** Six independent task groups (A–F). Groups B and C can be executed in parallel. Group E depends on the `MovieSummary` type added in Task 5, so Task 6 must follow Task 5. All other groups are fully independent.

**Tech Stack:** TypeScript, Preact, Hono, hoofd, preact-iso, Vite, vitest, pnpm workspaces

---

## File Map

| File | Change |
|---|---|
| `packages/server/package.json` | Add `preact-render-to-string` peer dep |
| `packages/vite/src/hono-preact.ts` | Defensive `rollupOptions` merge |
| `packages/vite/package-lock.json` | Delete |
| `.gitignore` | Add `package-lock.json` |
| `apps/app/tsconfig.json` | Remove stale include entry |
| `packages/server/src/__tests__/render.test.tsx` | New — tests for `renderPage` |
| `apps/app/src/server/data/movies.ts` | Export `MovieSummary` type |
| `apps/app/src/pages/movie.tsx` | Replace `any`, remove `.catch(console.log)` |
| `apps/app/src/pages/movies.tsx` | Replace `any`, remove `.catch(console.log)` |
| `apps/app/src/pages/docs/structure.mdx` | Update stale SSR code block |
| `apps/app/src/pages/docs/loaders.mdx` | Fix plugin source location reference |

---

## Task 1: Add `preact-render-to-string` peer dependency

**Files:**
- Modify: `packages/server/package.json`

`render.tsx` calls `prerender` from `preact-iso/prerender`, which depends on `preact-render-to-string`. This dep is undeclared in `packages/server`, so consumers outside the monorepo get no install signal.

- [ ] **Step 1: Add the peer dependency**

Edit `packages/server/package.json` — add `"preact-render-to-string": "*"` to `peerDependencies`:

```json
{
  "name": "@hono-preact/server",
  "version": "0.0.1",
  "type": "module",
  "private": true,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@hono-preact/iso": "workspace:*"
  },
  "peerDependencies": {
    "hono": ">=4.0.0",
    "hoofd": ">=1.0.0",
    "preact": ">=10.0.0",
    "preact-iso": "*",
    "preact-render-to-string": "*"
  },
  "devDependencies": {
    "typescript": "*"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/package.json
git commit -m "feat(server): declare preact-render-to-string as peer dependency"
```

---

## Task 2: Fix `rollupOptions` defensive merge in Vite plugin

**Files:**
- Modify: `packages/vite/src/hono-preact.ts`

Currently `...clientBuild` is spread after `rollupOptions`, so a consumer passing `clientBuild: { rollupOptions: {...} }` silently replaces the framework's required entry/output config. The fix destructures `rollupOptions` from `clientBuild` and merges at the field level.

- [ ] **Step 1: Update the client build config block**

Replace the `mode === 'client'` return in `packages/vite/src/hono-preact.ts`:

```ts
if (mode === 'client') {
  const { rollupOptions: userRollup, ...restClientBuild } = clientBuild;
  return {
    ...shared,
    build: {
      ...shared.build,
      sourcemap: true,
      cssCodeSplit: true,
      copyPublicDir: false,
      ...restClientBuild,
      rollupOptions: {
        input: userRollup?.input ?? ['./src/client.tsx'],
        output: {
          entryFileNames: 'static/client.js',
          chunkFileNames: 'static/[name]-[hash].js',
          assetFileNames: 'static/[name]-[hash].[ext]',
          ...(userRollup?.output && !Array.isArray(userRollup.output)
            ? userRollup.output
            : {}),
        },
      },
    },
  };
}
```

- [ ] **Step 2: Run existing vite tests**

```bash
pnpm test
```

Expected: all tests pass. The vite plugin tests in `packages/vite/src/__tests__/` exercise `serverOnlyPlugin` and `serverLoaderValidationPlugin` — they do not exercise the Vite config callback, so this change won't break them. Verify the suite is green.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/hono-preact.ts
git commit -m "fix(vite): merge clientBuild.rollupOptions instead of replacing framework defaults"
```

---

## Task 3: Cleanup stale files

**Files:**
- Modify: `apps/app/tsconfig.json`
- Delete: `packages/vite/package-lock.json`
- Modify: `.gitignore`

- [ ] **Step 1: Remove stale tsconfig include**

Edit `apps/app/tsconfig.json` — remove the `"./vite-plugin-server-only.ts"` line from the `include` array. Result:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "useDefineForClassFields": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "outDir": "./dist",
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["vite/client"]
  },
  "exclude": ["node_modules/**/*"],
  "include": [
    "./src/**/*.tsx",
    "./src/**/*.ts",
    "./src/**/*.json",
    "./src/**/*.mdx",
    "./vite.config.ts"
  ]
}
```

- [ ] **Step 2: Delete package-lock.json from git tracking**

```bash
git rm packages/vite/package-lock.json
```

- [ ] **Step 3: Add package-lock.json to .gitignore**

Add `package-lock.json` to `.gitignore` under the `# deps` section:

```
# deps
node_modules/
public/
static
dist
.superpowers
package-lock.json
```

- [ ] **Step 4: Commit**

```bash
git add apps/app/tsconfig.json .gitignore
git commit -m "chore: remove stale tsconfig include and gitignore npm lockfile"
```

---

## Task 4: Write tests for `renderPage`

**Files:**
- Create: `packages/server/src/__tests__/render.test.tsx`

`renderPage` is the most significant API in `packages/server` and has zero test coverage. Tests use real Preact SSR (no mocking of `prerender`) via a real Hono app, following the pattern in `location.test.ts`.

The vitest config at the root already includes `packages/server/src/__tests__/**/*.test.ts` — `.tsx` files match this glob too (vitest uses glob matching that includes tsx).

Note: vitest.config.ts uses `include: ['packages/server/src/__tests__/**/*.test.ts']`. The `.tsx` extension won't match `.test.ts`. You must also add `.test.tsx` to the include glob.

- [ ] **Step 1: Update vitest.config.ts to include .test.tsx**

Edit `vitest.config.ts` — update the server include line:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/iso/src/__tests__/**/*.test.{ts,tsx}',
      'packages/server/src/__tests__/**/*.test.{ts,tsx}',
      'packages/vite/src/__tests__/**/*.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [
        'packages/iso/src/**/*.{ts,tsx}',
        'packages/server/src/**/*.{ts,tsx}',
        'packages/vite/src/**/*.ts',
      ],
      exclude: [
        'packages/*/src/__tests__/**',
        'packages/iso/src/index.ts',
        'packages/server/src/index.ts',
        'packages/iso/src/preload.ts',
        'packages/server/src/context.ts',
        'packages/hono-preact/**',
      ],
    },
  },
});
```

- [ ] **Step 2: Create the test file**

Create `packages/server/src/__tests__/render.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { useTitle } from 'hoofd/preact';
import { GuardRedirect } from '@hono-preact/iso';
import { renderPage } from '../render.js';

function TitledPage() {
  useTitle('Test Title');
  return <div>hello</div>;
}

function UntitledPage() {
  return <div>no title</div>;
}

function RedirectingPage() {
  throw new GuardRedirect('/login');
}

function makeApp(
  Page: () => JSX.Element,
  options?: { defaultTitle?: string }
) {
  const app = new Hono();
  app.get('*', (c) => renderPage(c, <Page />, options));
  return app;
}

describe('renderPage', () => {
  it('injects <title> from useTitle into SSR output', async () => {
    const res = await makeApp(TitledPage).request('http://localhost/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Test Title</title>');
  });

  it('falls back to defaultTitle when no useTitle is called', async () => {
    const res = await makeApp(UntitledPage, { defaultTitle: 'Fallback' }).request(
      'http://localhost/'
    );
    const html = await res.text();
    expect(html).toContain('<title>Fallback</title>');
  });

  it('returns an empty title when neither useTitle nor defaultTitle is provided', async () => {
    const res = await makeApp(UntitledPage).request('http://localhost/');
    const html = await res.text();
    expect(html).toContain('<title></title>');
  });

  it('returns a redirect when GuardRedirect is thrown during render', async () => {
    const res = await makeApp(RedirectingPage).request('http://localhost/');
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toBe('/login');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: all 4 new `renderPage` tests pass alongside the existing suite. If any fail, check that `@hono-preact/iso` exports `GuardRedirect` and that `hoofd/preact` exports `useTitle` — both are already used in production code so they must be present.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts packages/server/src/__tests__/render.test.tsx
git commit -m "test(server): add renderPage tests for title injection and GuardRedirect"
```

---

## Task 5: Export `MovieSummary` type

**Files:**
- Modify: `apps/app/src/server/data/movies.ts`

`movies.tsx` uses `any` for list items. The shape is fully inferrable from `moviesData`. Export a named type so page components can use it.

- [ ] **Step 1: Add type exports**

Append to the bottom of `apps/app/src/server/data/movies.ts`:

```ts
export type MoviesData = typeof moviesData;
export type MovieSummary = MoviesData['results'][number];
```

Both are `type` exports — erased at compile time, so no value from this data file leaks into the client bundle when the page component uses `import type`.

- [ ] **Step 2: Verify TypeScript is happy**

```bash
pnpm -F app exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/server/data/movies.ts
git commit -m "feat(app): export MovieSummary type from movies data module"
```

---

## Task 6: Fix `any` types and error handling in page components

**Files:**
- Modify: `apps/app/src/pages/movie.tsx`
- Modify: `apps/app/src/pages/movies.tsx`

Replace `any` with proper types and remove `.catch(console.log)` which silently swallows fetch errors, causing the page to render with `undefined` loader data instead of surfacing the failure.

- [ ] **Step 1: Fix `movie.tsx`**

Replace the full contents of `apps/app/src/pages/movie.tsx`:

```tsx
import { getLoaderData, WrapperProps, type LoaderData } from '@hono-preact/iso';
import type { FunctionalComponent } from 'preact';
import type { RouteHook } from 'preact-iso';
import type { Movie } from '@/server/data/movie.js';
import serverLoader from './movie.server.js';

async function clientLoader({ location }: { location: RouteHook }) {
  const movie = await fetch(`/api/movies/${location.pathParams.id}`).then(
    (res) => res.json() as Promise<Movie>
  );
  return { movie };
}

const Movie: FunctionalComponent = (props: LoaderData<{ movie: Movie | null }>) => {
  return (
    <section class="p-1">
      <a href="/movies" class="bg-red-200">
        movies
      </a>
      <span>{props.loaderData?.movie?.title}</span>
      <a class="block" href="/movies/1241982">
        next movie
      </a>
    </section>
  );
};
Movie.displayName = 'Movie';
Movie.defaultProps = { route: '/movies/:id' };

function MovieWrapper(props: WrapperProps) {
  return <article {...props} />;
}

export default getLoaderData(Movie, {
  serverLoader,
  clientLoader,
  Wrapper: MovieWrapper,
});
```

- [ ] **Step 2: Fix `movies.tsx`**

Replace the full contents of `apps/app/src/pages/movies.tsx`:

```tsx
import { getLoaderData, type LoaderData, createCache } from '@hono-preact/iso';
import type { FunctionalComponent } from 'preact';
import { lazy, Route, Router, RouteHook } from 'preact-iso';
import type { MovieSummary, MoviesData } from '@/server/data/movies.js';
import serverLoader from './movies.server.js';
import Noop from './noop.js';

const cache = createCache<{ movies: MoviesData }>();

const clientLoader = cache.wrap(async ({}: { location: RouteHook }) => {
  const movies = await fetch('/api/movies').then(
    (res) => res.json() as Promise<MoviesData>
  );
  return { movies };
});

const Movie = lazy(() => import('./movie.js'));

const Movies: FunctionalComponent = (props: LoaderData<{ movies: MoviesData }>) => {
  return (
    <section class="p-1">
      <a href="/" class="bg-amber-200">
        home
      </a>
      {props.loaderData?.movies.results.map((m: MovieSummary) => (
        <a
          href={`/movies/${m.id}`}
          class="border-2 m-1 p-1 inline-block"
          key={m.id}
        >
          {m.title}
        </a>
      ))}

      <Router>
        <Route path="/:id" component={Movie} />
        <Noop />
      </Router>
    </section>
  );
};
Movies.displayName = 'Movies';
Movies.defaultProps = { route: '/movies' };

export default getLoaderData(Movies, {
  serverLoader,
  clientLoader,
  cache,
});
```

- [ ] **Step 3: Verify TypeScript**

```bash
pnpm -F app exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
pnpm test
```

Expected: all tests pass (page components have no unit tests; this verifies nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/movie.tsx apps/app/src/pages/movies.tsx
git commit -m "fix(app): replace any types and remove silent error swallowing in client loaders"
```

---

## Task 7: Update stale documentation

**Files:**
- Modify: `apps/app/src/pages/docs/structure.mdx`
- Modify: `apps/app/src/pages/docs/loaders.mdx`

- [ ] **Step 1: Update `structure.mdx` SSR code block**

In `apps/app/src/pages/docs/structure.mdx`, replace the stale code block under `### apps/app/src/server.tsx` (lines 34–48) with the current pattern:

```ts
app
  .get('/api/movies', async (c) => { ... })
  .use(location)
  .get('*', (c) =>
    renderPage(c, <Layout context={c} />, { defaultTitle: 'hono-preact' })
  );
```

The surrounding prose on line 32 ("SSR-renders the full Preact app via `prerender` from preact-iso, then injects `<head>` tags and returns the HTML response") should be updated to:

```
The Hono application. Defines API routes and a catch-all `GET *` handler that SSR-renders the full Preact app via `renderPage` from `@hono-preact/server` and returns the HTML response.
```

- [ ] **Step 2: Update `loaders.mdx` plugin location reference**

In `apps/app/src/pages/docs/loaders.mdx`, replace line 83:

```
Two custom Vite plugins (in `vite-plugin-server-only.ts`) enforce the boundary between server and client code:
```

with:

```
Two custom Vite plugins (in `packages/vite/src/`) enforce the boundary between server and client code:
```

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs/structure.mdx apps/app/src/pages/docs/loaders.mdx
git commit -m "docs: update server.tsx example and plugin source location"
```
