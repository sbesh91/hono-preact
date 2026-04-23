# Code Review Fixes — Design

**Date:** 2026-04-21
**Scope:** 9 issues from post-implementation code review of the hono-preact example app

## Overview

9 discrete fixes grouped into 6 batches. No new features, no API changes. All fixes are isolated — no shared state or ordering dependencies between groups except Group E (types must precede any file that imports them).

---

## Group A — Package metadata (issues 2)

**File:** `packages/server/package.json`

Add `"preact-render-to-string": "*"` to `peerDependencies`. `render.tsx` calls `prerender` from `preact-iso/prerender`, which internally depends on `preact-render-to-string`. This dep is currently undeclared in `packages/server`, so consumers outside the monorepo get no signal that it's required.

Note: Issue 1 (`react` peer dep) was dropped — the root `pnpm.overrides` aliasing `react → @preact/compat` already handles hoofd peer resolution correctly.

---

## Group B — Vite config defensive merge (issue 3)

**File:** `packages/vite/src/hono-preact.ts`

The current client build config spreads `clientBuild` after `rollupOptions`, silently replacing the framework's required rollup config if the user passes `clientBuild.rollupOptions`.

Fix: destructure `rollupOptions` out of `clientBuild` before spreading, then compose them:

```ts
const { rollupOptions: userRollup, ...restClientBuild } = clientBuild;

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
      ...userRollup?.output,
    },
  },
},
```

Users can now override `input` and individual output fields without losing the framework's defaults.

---

## Group C — Cleanup (issues 4 & 10)

**Files:** `apps/app/tsconfig.json`, `packages/vite/package-lock.json`, `.gitignore`

- Remove `"./vite-plugin-server-only.ts"` from the `include` array in `apps/app/tsconfig.json` — the file no longer exists.
- Delete `packages/vite/package-lock.json` — an npm lockfile committed inside a pnpm workspace; unused by pnpm and noise in the repo.
- Add `package-lock.json` to the root `.gitignore` so it can't be re-committed accidentally.

---

## Group D — `renderPage` tests (issue 5)

**File:** `packages/server/src/__tests__/render.test.tsx` (new)

Two tests using the existing vitest setup (already in vitest.config.ts glob):

1. **SSR output contains injected title** — render a component that calls `useTitle('Test')`, assert the returned HTML string includes `<title>Test</title>`. Also assert `defaultTitle` fallback when no `useTitle` is called.

2. **GuardRedirect produces a redirect response** — render a component that throws `new GuardRedirect('/login')` during render, assert `renderPage` returns a response with status 3xx and `Location: /login`.

Tests use real Preact rendering (no mocking of `prerender`) since the vitest environment supports it. A minimal mock Hono `Context` is constructed inline.

---

## Group E — Type safety + error handling (issues 8 & 9)

**Files:** `apps/app/src/server/data/movies.ts`, `apps/app/src/pages/movie.tsx`, `apps/app/src/pages/movies.tsx`

### Types

- Export `MovieSummary` from `apps/app/src/server/data/movies.ts` derived from the inline data shape: `export type MovieSummary = (typeof moviesData)['results'][number]`
- In `movie.tsx`: replace `{ movie: any }` with `{ movie: Movie | null }`
- In `movies.tsx`: replace `{ movies: any }` with `{ movies: typeof moviesData }`, replace `m: any` with `MovieSummary`

### Error handling

Remove `.catch(console.log)` from both client loaders (`movie.tsx:9`, `movies.tsx:13`). Let fetch errors propagate naturally — unhandled rejections surface immediately and can be caught by error boundaries, rather than silently producing `undefined` loader data.

---

## Group F — Docs (issues 6 & 7)

**Files:** `apps/app/src/pages/docs/structure.mdx`, `apps/app/src/pages/docs/loaders.mdx`

- `structure.mdx:34-47`: replace the old `createDispatcher`/`prerender`/`HoofdProvider` code block with the current `renderPage(c, <Layout context={c} />, { defaultTitle: 'hono-preact' })` one-liner that matches the actual `server.tsx`
- `loaders.mdx:83`: update `"in \`vite-plugin-server-only.ts\`"` → `"in \`packages/vite/src/\`"`

---

## Execution order

A → B → C (parallel with B) → D → E → F

Group E must come before any file that imports from the data modules, but since the types only add exports, no ordering conflicts exist in practice.
