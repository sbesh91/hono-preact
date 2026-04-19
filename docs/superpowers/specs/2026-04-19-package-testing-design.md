---
title: Package Unit Testing Strategy
date: 2026-04-19
status: approved
---

# Package Unit Testing Strategy

## Goal

Add a unit testing layer for the packages in `packages/`, collect coverage, surface it in GitHub Actions job summaries, and keep a `next` git tag pointing to the latest green build of `main`.

## Scope

Tests cover only code we own. Preact rendering infrastructure is trusted as-is; we use `@testing-library/preact` as a rendering tool to exercise our own logic inside components, not to verify Preact itself.

### In scope

| Package | Files tested |
|---|---|
| `@hono-preact/iso` | `cache.ts`, `guard.ts`, `wrap-promise.ts`, `is-browser.tsx`, `loader.tsx`, `page.tsx` |
| `@hono-preact/server` | `middleware/location.ts` |
| `@hono-preact/vite` | `index.ts` (both plugins) |

### Out of scope

- `preload.ts` — trivial DOM attribute read/delete; behaviour is covered by `page.tsx` tests
- `context.ts` — is a bare `createContext` call with no logic
- `hono-preact` meta-package — re-exports only, no logic
- Preact rendering correctness itself — `loader.tsx` and `page.tsx` are tested for our own branching logic, but we do not assert that Preact renders JSX correctly (that is Preact's responsibility)

## Test Infrastructure

### Runner

Vitest, configured with a single `vitest.config.ts` at the monorepo root. The `projects` array points at each package directory. Coverage is aggregated across all packages in one report via `@vitest/coverage-v8`.

### Environments

- **Default: Node** — all pure-logic and AST-transform tests
- **Opt-in: happy-dom** — test files that exercise Preact components add `// @vitest-environment happy-dom` at the top

### New devDependencies (monorepo root)

```
vitest
@vitest/coverage-v8
happy-dom
@testing-library/preact
```

### File layout

Tests live alongside source in each package under `src/__tests__/`:

```
packages/iso/src/__tests__/
  cache.test.ts                           # node — createCache CRUD + invalidate + wrap
  guard.test.ts                           # node — createGuard, runGuards, GuardRedirect
  wrap-promise.test.ts                    # node — pending/success/error states
  is-browser.test.ts                      # node — isBrowser(), env sentinel
  page.test.tsx                           # @vitest-environment happy-dom
  loader.test.tsx                         # @vitest-environment happy-dom

packages/server/src/__tests__/
  location.test.ts                        # node — location middleware sets URL on context

packages/vite/src/__tests__/
  server-only-plugin.test.ts              # node — client imports stubbed, SSR imports pass through
  server-loader-validation-plugin.test.ts # node — named export violations throw, valid files pass
```

### Root scripts

Added to the root `package.json`:

```json
"test":       "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

CI uses `pnpm test:coverage`.

## What Each Test Suite Covers

### `cache.test.ts`
- `get()` returns null initially
- `set()` + `get()` round-trip
- `has()` false before set, true after
- `wrap()` calls through on miss, returns cached on hit
- `invalidate()` resets to null; subsequent `wrap()` call re-fetches

### `guard.test.ts`
- `createGuard` returns the function unchanged
- `runGuards([])` resolves to `undefined` (no guards = pass through)
- Single guard returning `{ redirect }` short-circuits
- Single guard returning `{ render }` short-circuits
- Single guard calling `next()` passes through
- Two guards: first redirect stops second from running
- Two guards: first passes, second redirects
- `GuardRedirect` is an Error subclass with correct `location` and `name`

### `wrap-promise.test.ts`
- Pending promise causes `read()` to throw the suspender
- Resolved promise causes `read()` to return the value
- Rejected promise causes `read()` to throw the rejection

### `is-browser.test.ts`
- `isBrowser()` returns false in Node environment
- `env.current` can be set and read back

### `page.test.tsx` + `loader.test.tsx`
- Preloaded data path: component receives `loaderData` from `data-loader` attribute without firing clientLoader
- Cache-hit path: component renders from cache without firing clientLoader
- Fetch path: clientLoader is called on cache miss; fallback shown during load
- Guard redirect: `route()` is called in browser when guard returns `{ redirect }`
- Guard render: fallback component renders when guard returns `{ render }`
- `useReload`: `reload()` calls clientLoader again; `reloading` is true during fetch
- `useReload` throws when called outside `getLoaderData`

### `location.test.ts`
- Middleware sets the correct URL string on the Hono context before calling next

### `server-only-plugin.test.ts`
- Default import from `*.server.*` is replaced with `const x = async () => ({})`
- `serverGuards` named import is replaced with `const x = []`
- Non-server imports are left untouched
- SSR mode (`options.ssr = true`) passes all imports through unchanged

### `server-loader-validation-plugin.test.ts`
- File with default export only: passes
- File with default + `serverGuards` named export: passes
- File with default + any other named export: throws build error
- File with no default export: throws build error

## GitHub Actions CI

Single workflow: `.github/workflows/ci.yml`

### Triggers
- `push` to `main`
- `pull_request` targeting `main`

### Jobs

#### `test`
Runs on every trigger.

1. Checkout repo
2. Setup pnpm + Node (LTS)
3. `pnpm install --frozen-lockfile`
4. `pnpm test:coverage`
5. Write coverage text-summary to `$GITHUB_STEP_SUMMARY`

#### `build-and-tag`
Runs only on push to `main`, after `test` passes.

1. `pnpm build` (builds all packages via root build script)
2. Force-move the `next` git tag to `HEAD`
3. `git push origin next --force`

Uses the default `GITHUB_TOKEN` — no additional secrets required.

### `next` tag semantics

The `next` tag is a lightweight git tag that always points to the latest commit on `main` that passed CI. It is force-pushed on every successful `main` build. PRs do not move the tag.
