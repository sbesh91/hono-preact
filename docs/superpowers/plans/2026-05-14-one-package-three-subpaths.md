# One Package, Three Subpaths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `hono-preact` the single user-facing npm package with four subpath entries (`.`, `./server`, `./vite`, `./internal`), while keeping the three workspace packages (`@hono-preact/iso`, `@hono-preact/server`, `@hono-preact/vite`) as separately-published transitive dependencies. Hard cutover of the demo app and docs.

**Architecture:** No bundler. The umbrella `packages/hono-preact/src/{index,server,vite,internal}.ts` each contain a single `export * from '@hono-preact/*'` line. The three workspace packages flip `"private": true` off so `pnpm publish` rewrites `workspace:*` references in the umbrella's `dependencies` field to concrete version ranges. User imports come through `hono-preact[/subpath]`. Plugin-emitted strings stay on `@hono-preact/*` (they resolve via the user's transitive deps).

**Tech Stack:** TypeScript (tsc per package), pnpm workspaces, Vite (demo dev), vitest.

**Spec:** `docs/superpowers/specs/2026-05-14-one-package-three-subpaths-design.md`

---

## File Structure

### Files modified

- `packages/iso/package.json` — drop `"private": true`.
- `packages/server/package.json` — drop `"private": true`.
- `packages/vite/package.json` — drop `"private": true`.
- `packages/hono-preact/package.json` — drop `"private": true`; expand `exports` map to four subpaths; keep workspace deps in `dependencies`.
- `packages/hono-preact/src/index.ts` — narrow to only re-export `@hono-preact/iso` (drop the `@hono-preact/server` re-export).
- `apps/app/vite.config.ts` — add four `hono-preact[/subpath]` aliases (existing `@hono-preact/*` aliases stay).
- `apps/app/vite.config.ts:1` — `from '@hono-preact/vite'` → `from 'hono-preact/vite'`.
- `apps/app/package.json` — drop the three `@hono-preact/*` workspace deps; keep the existing `hono-preact` dep.
- `apps/app/src/routes.ts` — import migration.
- `apps/app/src/components/DocsRoute.tsx` — import migration.
- `apps/app/src/pages/movie.tsx` — import migration.
- `apps/app/src/pages/movies-list.tsx` — import migration.
- `apps/app/src/pages/watched.tsx` — import migration.
- `apps/app/src/pages/watched.server.ts` — import migration.
- `apps/app/src/pages/movies-layout.tsx` — import migration.
- `apps/app/src/pages/movies-list.server.ts` — import migration.
- `apps/app/src/pages/movie.server.ts` — import migration.
- `apps/app/src/pages/__tests__/movies-list.test.tsx` — `RouteLocationsContext` import migrates to `hono-preact/internal`; `vi.mock('@hono-preact/iso/is-browser.js')` STAYS unchanged (mock paths target the resolved internal module path, not the user-API entry).
- `apps/app/src/pages/__tests__/movie.test.tsx` — same as above.
- `apps/app/src/pages/docs/*.mdx` (17 files) — search-and-replace package names in code examples and prose.

### Files created

- `packages/hono-preact/src/server.ts` — `export * from '@hono-preact/server';`.
- `packages/hono-preact/src/internal.ts` — `export * from '@hono-preact/iso/internal';`.
- `packages/hono-preact/__tests__/exports.test.ts` — locks down the published surface (typeof checks per subpath).

### Files NOT changed

- All `packages/{iso,server,vite}/src/**` — workspace package source untouched.
- All framework unit tests under `packages/{iso,server,vite}/src/__tests__/` — still import from `@hono-preact/*` workspace names.
- `packages/vite/src/{client-entry,server-only,guard-strip,server-entry}.ts` — plugin-emit strings stay on `@hono-preact/*` per spec decision.

---

## Phase 1: Umbrella expansion

### Task 1: Narrow the umbrella's root re-export to iso only

**Files:**
- Modify: `packages/hono-preact/src/index.ts`

- [ ] **Step 1: Replace file contents**

Current `packages/hono-preact/src/index.ts`:

```ts
export * from '@hono-preact/iso';
export * from '@hono-preact/server';
```

Replace with:

```ts
export * from '@hono-preact/iso';
```

The `@hono-preact/server` re-export moves to its own subpath in Task 2.

- [ ] **Step 2: Build the umbrella to confirm tsc is still clean**

Run: `pnpm --filter hono-preact build`
Expected: clean (no output, exit 0).

- [ ] **Step 3: Commit**

```bash
git add packages/hono-preact/src/index.ts
git commit -m "refactor(hono-preact): narrow root export to iso only"
```

---

### Task 2: Add the `server` subpath source file

**Files:**
- Create: `packages/hono-preact/src/server.ts`

- [ ] **Step 1: Create the file**

`packages/hono-preact/src/server.ts`:

```ts
export * from '@hono-preact/server';
```

- [ ] **Step 2: Build the umbrella**

Run: `pnpm --filter hono-preact build`
Expected: clean. Verify `packages/hono-preact/dist/server.js` and `packages/hono-preact/dist/server.d.ts` now exist.

```bash
ls packages/hono-preact/dist/server.{js,d.ts}
```

Expected: both files exist.

- [ ] **Step 3: Commit**

```bash
git add packages/hono-preact/src/server.ts
git commit -m "feat(hono-preact): add server subpath source"
```

---

### Task 3: Add the `internal` subpath source file

**Files:**
- Create: `packages/hono-preact/src/internal.ts`

- [ ] **Step 1: Create the file**

`packages/hono-preact/src/internal.ts`:

```ts
export * from '@hono-preact/iso/internal';
```

- [ ] **Step 2: Build the umbrella**

Run: `pnpm --filter hono-preact build`
Expected: clean. Verify `packages/hono-preact/dist/internal.js` and `packages/hono-preact/dist/internal.d.ts` now exist.

```bash
ls packages/hono-preact/dist/internal.{js,d.ts}
```

Expected: both files exist.

- [ ] **Step 3: Commit**

```bash
git add packages/hono-preact/src/internal.ts
git commit -m "feat(hono-preact): add internal subpath source"
```

---

### Task 4: Expand `packages/hono-preact/package.json`

**Files:**
- Modify: `packages/hono-preact/package.json`

- [ ] **Step 1: Replace file contents**

Replace `packages/hono-preact/package.json` with:

```json
{
  "name": "hono-preact",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js"
    },
    "./vite": {
      "types": "./dist/vite.d.ts",
      "import": "./dist/vite.js"
    },
    "./internal": {
      "types": "./dist/internal.d.ts",
      "import": "./dist/internal.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@hono-preact/iso": "workspace:*",
    "@hono-preact/server": "workspace:*",
    "@hono-preact/vite": "workspace:*"
  },
  "peerDependencies": {
    "hono": ">=4.0.0",
    "hoofd": ">=1.0.0",
    "preact": ">=10.0.0",
    "preact-iso": "*",
    "preact-render-to-string": "*",
    "vite": ">=5.0.0"
  },
  "devDependencies": {
    "typescript": "*"
  }
}
```

Changes vs current:
- `"private": true` is dropped.
- `exports` map gains `./server` and `./internal`.
- `peerDependencies` adds `hoofd` and `preact-render-to-string` (union of the three internal packages' peer deps so users get one warning surface).

- [ ] **Step 2: Reinstall workspace to pick up new peer deps**

Run: `pnpm install`
Expected: no errors. Reinstalls cleanly with the expanded peer deps.

- [ ] **Step 3: Build the umbrella**

Run: `pnpm --filter hono-preact build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/hono-preact/package.json pnpm-lock.yaml
git commit -m "feat(hono-preact): expand exports to 4 subpaths and drop private"
```

---

## Phase 2: Workspace packages go public

### Task 5: Flip `private: true` off in the three workspace packages

**Files:**
- Modify: `packages/iso/package.json`
- Modify: `packages/server/package.json`
- Modify: `packages/vite/package.json`

- [ ] **Step 1: Edit `packages/iso/package.json`**

Remove the line `"private": true,` from the JSON. The remaining file content is unchanged.

- [ ] **Step 2: Edit `packages/server/package.json`**

Remove the line `"private": true,` from the JSON. The remaining file content is unchanged.

- [ ] **Step 3: Edit `packages/vite/package.json`**

Remove the line `"private": true,` from the JSON. The remaining file content is unchanged.

- [ ] **Step 4: Verify all three parse cleanly**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/iso/package.json','utf8'))" && node -e "JSON.parse(require('fs').readFileSync('packages/server/package.json','utf8'))" && node -e "JSON.parse(require('fs').readFileSync('packages/vite/package.json','utf8'))"`
Expected: no output (no parse errors).

- [ ] **Step 5: Commit**

```bash
git add packages/iso/package.json packages/server/package.json packages/vite/package.json
git commit -m "feat(packages): allow @hono-preact/* to publish (drop private)"
```

---

## Phase 3: Exports-shape test

### Task 6: Add the exports-shape regression test

**Files:**
- Create: `packages/hono-preact/__tests__/exports.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/hono-preact/__tests__/exports.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('hono-preact root export (iso runtime)', () => {
  it('surfaces the page + route + loader + action public API', async () => {
    const m = await import('hono-preact');
    expect(typeof m.definePage).toBe('function');
    expect(typeof m.defineRoutes).toBe('function');
    expect(typeof m.defineLoader).toBe('function');
    expect(typeof m.defineAction).toBe('function');
    expect(typeof m.defineServerGuard).toBe('function');
    expect(typeof m.defineClientGuard).toBe('function');
    expect(typeof m.useAction).toBe('function');
    expect(typeof m.useOptimisticAction).toBe('function');
    expect(typeof m.useReload).toBe('function');
    expect(typeof m.useLocation).toBe('function');
    expect(typeof m.Form).toBe('function');
    expect(typeof m.Routes).toBe('function');
    expect(typeof m.Head).toBe('function');
    expect(typeof m.ClientScript).toBe('function');
    expect(typeof m.ViewTransitions).toBe('function');
  });

  it('does NOT surface server-only symbols at the root', async () => {
    const m = await import('hono-preact');
    expect((m as Record<string, unknown>).renderPage).toBeUndefined();
  });
});

describe('hono-preact/server export', () => {
  it('surfaces the SSR + handlers public API', async () => {
    const m = await import('hono-preact/server');
    expect(typeof m.renderPage).toBe('function');
    expect(typeof m.loadersHandler).toBe('function');
    expect(typeof m.actionsHandler).toBe('function');
    expect(typeof m.routeServerModules).toBe('function');
  });
});

describe('hono-preact/vite export', () => {
  it('surfaces the Vite plugin entry', async () => {
    const m = await import('hono-preact/vite');
    expect(typeof m.honoPreact).toBe('function');
  });
});

describe('hono-preact/internal export', () => {
  it('surfaces the escape-hatch primitives', async () => {
    const m = await import('hono-preact/internal');
    expect(typeof m.Loader).toBe('function');
    expect(typeof m.Envelope).toBe('function');
    expect(typeof m.RouteBoundary).toBe('function');
    expect(typeof m.Guards).toBe('function');
    expect(typeof m.runGuards).toBe('function');
    expect(typeof m.installStreamRegistry).toBe('function');
    expect(typeof m.subscribeToLoaderStream).toBe('function');
    expect(typeof m.registerServerStreamingLoader).toBe('function');
    expect(typeof m.takeServerStreamingLoaders).toBe('function');
    expect(typeof m.runRequestScope).toBe('function');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec vitest run packages/hono-preact/__tests__/exports.test.ts`
Expected: PASS, all 4 describe blocks (the umbrella is already built by prior phases).

If it fails because the test file isn't picked up by the root vitest config, check the root `vitest.config.ts` `include` glob — most likely `packages/**/__tests__/**` or similar; the new path matches that pattern.

- [ ] **Step 3: Commit**

```bash
git add packages/hono-preact/__tests__/exports.test.ts
git commit -m "test(hono-preact): exports-shape coverage for all 4 subpaths"
```

---

## Phase 4: Demo app migration

### Task 7: Add `hono-preact` aliases to demo's vite.config.ts (keep existing `@hono-preact/*` aliases)

**Files:**
- Modify: `apps/app/vite.config.ts`

- [ ] **Step 1: Read the current alias block**

Open `apps/app/vite.config.ts`. The current `resolve.alias` array contains entries for `@hono-preact/iso/internal`, `@hono-preact/iso`, `@hono-preact/server`, and `@`. Locate these.

- [ ] **Step 2: Insert four new `hono-preact[/subpath]` aliases above the existing `@hono-preact/*` block**

Replace the `resolve.alias` array contents with:

```ts
alias: [
  // Umbrella subpaths (longest-prefix first).
  {
    find: 'hono-preact/internal',
    replacement: resolve(__dirname, '../../packages/hono-preact/src/internal.ts'),
  },
  {
    find: 'hono-preact/server',
    replacement: resolve(__dirname, '../../packages/hono-preact/src/server.ts'),
  },
  {
    find: 'hono-preact/vite',
    replacement: resolve(__dirname, '../../packages/hono-preact/src/vite.ts'),
  },
  {
    find: 'hono-preact',
    replacement: resolve(__dirname, '../../packages/hono-preact/src/index.ts'),
  },
  // Workspace packages kept so the umbrella's `export * from '@hono-preact/iso'`
  // chains through to source for HMR.
  {
    find: '@hono-preact/iso/internal',
    replacement: resolve(__dirname, '../../packages/iso/src/internal.ts'),
  },
  {
    find: '@hono-preact/iso',
    replacement: resolve(__dirname, '../../packages/iso/src/index.ts'),
  },
  {
    find: '@hono-preact/server',
    replacement: resolve(__dirname, '../../packages/server/src/index.ts'),
  },
  { find: '@', replacement: resolve(__dirname, './src') },
],
```

The existing `@hono-preact/vite` alias (line 35 area, if it exists in current file) goes away if it's not currently in the alias block. Read the current block first; if `@hono-preact/vite` is aliased, drop it (the umbrella's `vite.ts` chains through normal node_modules resolution to the workspace `@hono-preact/vite` since both are workspace deps).

- [ ] **Step 3: Confirm vite.config.ts still parses**

Run: `pnpm exec tsc --noEmit --jsx react-jsx --moduleResolution bundler --module esnext --target esnext --skipLibCheck apps/app/vite.config.ts 2>&1 | head -5`
Expected: no output relevant to vite.config.ts itself (it may flag the rest of the project, but vite.config.ts should be clean).

If tsc resists running on a single file in isolation, skip this step — the alias block is read at dev/build time and Task 14 will surface any syntactic issue.

- [ ] **Step 4: Commit (do NOT change the `import` from `@hono-preact/vite` yet; that's Task 8)**

```bash
git add apps/app/vite.config.ts
git commit -m "feat(app): add hono-preact[/subpath] aliases for demo dev mode"
```

---

### Task 8: Migrate demo's `vite.config.ts:1` import

**Files:**
- Modify: `apps/app/vite.config.ts`

- [ ] **Step 1: Change the import**

Open `apps/app/vite.config.ts`. Change line 1:

```ts
import { honoPreact } from '@hono-preact/vite';
```

to:

```ts
import { honoPreact } from 'hono-preact/vite';
```

- [ ] **Step 2: Verify dev starts cleanly**

Run: `pnpm --filter app dev &` (in another shell) and wait ~10 seconds; visit `http://localhost:<port>/` and confirm the home page renders. Then kill the dev server.

If the framework dev script is run via `pnpm run dev` from the repo root, use that instead.

Expected: dev server starts, ports are picked, browser renders the app.

- [ ] **Step 3: Commit**

```bash
git add apps/app/vite.config.ts
git commit -m "refactor(app): vite.config.ts imports honoPreact from hono-preact/vite"
```

---

### Task 9: Migrate demo source imports

**Files:**
- Modify: `apps/app/src/routes.ts`
- Modify: `apps/app/src/components/DocsRoute.tsx`
- Modify: `apps/app/src/pages/movie.tsx`
- Modify: `apps/app/src/pages/movie.server.ts`
- Modify: `apps/app/src/pages/movies-list.tsx`
- Modify: `apps/app/src/pages/movies-list.server.ts`
- Modify: `apps/app/src/pages/movies-layout.tsx`
- Modify: `apps/app/src/pages/watched.tsx`
- Modify: `apps/app/src/pages/watched.server.ts`

- [ ] **Step 1: For each file in the list above, run the substitution**

In each file:
- Replace `from '@hono-preact/iso/internal'` → `from 'hono-preact/internal'`.
- Replace `from '@hono-preact/iso'` → `from 'hono-preact'`.

(There are no `@hono-preact/server` or `@hono-preact/vite` runtime imports under `apps/app/src/` per the spec exploration; the only sites are the iso-rooted ones.)

You can do this manually file-by-file via the Edit tool, OR via a sed pass:

```bash
for f in \
  apps/app/src/routes.ts \
  apps/app/src/components/DocsRoute.tsx \
  apps/app/src/pages/movie.tsx \
  apps/app/src/pages/movie.server.ts \
  apps/app/src/pages/movies-list.tsx \
  apps/app/src/pages/movies-list.server.ts \
  apps/app/src/pages/movies-layout.tsx \
  apps/app/src/pages/watched.tsx \
  apps/app/src/pages/watched.server.ts \
; do
  sed -i.bak "s|from '@hono-preact/iso/internal'|from 'hono-preact/internal'|g; s|from '@hono-preact/iso'|from 'hono-preact'|g" "$f"
  rm "$f.bak"
done
```

- [ ] **Step 2: Confirm no `@hono-preact/iso` references remain in the listed files**

Run: `grep -rn "@hono-preact/iso" apps/app/src/routes.ts apps/app/src/components/DocsRoute.tsx apps/app/src/pages/movie.tsx apps/app/src/pages/movie.server.ts apps/app/src/pages/movies-list.tsx apps/app/src/pages/movies-list.server.ts apps/app/src/pages/movies-layout.tsx apps/app/src/pages/watched.tsx apps/app/src/pages/watched.server.ts`
Expected: no output (zero matches).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/routes.ts apps/app/src/components apps/app/src/pages
git commit -m "refactor(app): migrate runtime imports to hono-preact[/internal]"
```

---

### Task 10: Migrate demo test files (selective)

**Files:**
- Modify: `apps/app/src/pages/__tests__/movies-list.test.tsx`
- Modify: `apps/app/src/pages/__tests__/movie.test.tsx`

- [ ] **Step 1: In both test files, migrate the `RouteLocationsContext` import only**

In each test:
- Replace `import { RouteLocationsContext } from '@hono-preact/iso/internal';` with `import { RouteLocationsContext } from 'hono-preact/internal';`.
- LEAVE `vi.mock('@hono-preact/iso/is-browser.js', ...)` UNCHANGED. The `vi.mock` path targets the resolved internal module path; the production code's `isBrowser` symbol still lives at `@hono-preact/iso/dist/is-browser.js` after the migration (vite alias chains there). Mock-path-matching is independent of the user-API entry, so this stays.

- [ ] **Step 2: Run the two tests**

Run: `pnpm exec vitest run apps/app/src/pages/__tests__/movies-list.test.tsx apps/app/src/pages/__tests__/movie.test.tsx`
Expected: PASS (no regressions from the migration).

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/__tests__/movies-list.test.tsx apps/app/src/pages/__tests__/movie.test.tsx
git commit -m "test(app): migrate RouteLocationsContext import to hono-preact/internal"
```

---

### Task 11: Migrate demo's `package.json` deps

**Files:**
- Modify: `apps/app/package.json`

- [ ] **Step 1: Drop the three `@hono-preact/*` workspace deps**

Edit `apps/app/package.json`:

- In `"dependencies"`, remove the lines:
  ```json
  "@hono-preact/iso": "workspace:*",
  "@hono-preact/server": "workspace:*",
  ```
  Keep the existing `"hono-preact": "workspace:*"` line.

- In `"devDependencies"`, remove the line:
  ```json
  "@hono-preact/vite": "workspace:*",
  ```

- [ ] **Step 2: Reinstall**

Run: `pnpm install`
Expected: no errors. The lockfile updates to reflect the dep removal.

- [ ] **Step 3: Confirm no `@hono-preact/` remains in the file**

Run: `grep -c "@hono-preact/" apps/app/package.json`
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add apps/app/package.json pnpm-lock.yaml
git commit -m "refactor(app): consolidate workspace deps to hono-preact only"
```

---

## Phase 5: Docs migration

### Task 12: Migrate all docs MDX files

**Files:**
- Modify: `apps/app/src/pages/docs/action-guards.mdx`
- Modify: `apps/app/src/pages/docs/actions.mdx`
- Modify: `apps/app/src/pages/docs/guards.mdx`
- Modify: `apps/app/src/pages/docs/index.mdx`
- Modify: `apps/app/src/pages/docs/layouts.mdx`
- Modify: `apps/app/src/pages/docs/loaders.mdx`
- Modify: `apps/app/src/pages/docs/loading-states.mdx`
- Modify: `apps/app/src/pages/docs/optimistic-ui.mdx`
- Modify: `apps/app/src/pages/docs/pages.mdx`
- Modify: `apps/app/src/pages/docs/prefetch.mdx`
- Modify: `apps/app/src/pages/docs/quick-start.mdx`
- Modify: `apps/app/src/pages/docs/reloading.mdx`
- Modify: `apps/app/src/pages/docs/render-page.mdx`
- Modify: `apps/app/src/pages/docs/routes.mdx`
- Modify: `apps/app/src/pages/docs/streaming.mdx`
- Modify: `apps/app/src/pages/docs/structure.mdx`
- Modify: `apps/app/src/pages/docs/vite-config.mdx`

- [ ] **Step 1: Run the substitution across all docs**

```bash
for f in apps/app/src/pages/docs/*.mdx; do
  sed -i.bak "
    s|@hono-preact/iso/internal|hono-preact/internal|g
    s|@hono-preact/iso|hono-preact|g
    s|@hono-preact/server|hono-preact/server|g
    s|@hono-preact/vite|hono-preact/vite|g
  " "$f"
  rm "$f.bak"
done
```

The substitutions run in order: the longest-prefix `iso/internal` first so it doesn't match the bare `iso` rule, then `iso` → root, then `server` and `vite` → their subpaths.

- [ ] **Step 2: Confirm no `@hono-preact/` remains in the docs**

Run: `grep -rn "@hono-preact/" apps/app/src/pages/docs/`
Expected: no output.

- [ ] **Step 3: Eyeball `vite-config.mdx` for prose accuracy**

Open `apps/app/src/pages/docs/vite-config.mdx`. The page is the install/config tutorial. Read through it once to confirm sentences still read sensibly after the package-name swap (e.g., a sentence like "The `@hono-preact/vite` package exports a `honoPreact()` plugin..." is now "The `hono-preact/vite` package exports..."; this should still be correct prose, but verify nothing reads weird).

If any sentence reads awkwardly post-substitution, fix it inline (e.g., changing "The X package exports" → "The X subpath exports" if that flows better).

- [ ] **Step 4: Build the demo to confirm MDX still parses**

Run: `pnpm --filter app build`
Expected: clean client + SSR builds.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/pages/docs/
git commit -m "docs: migrate all package references to hono-preact[/subpath]"
```

---

## Phase 6: Validation

### Task 13: Full test suite

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: every package's tests PASS, including the new `packages/hono-preact/__tests__/exports.test.ts`.

If any test fails, do not proceed. Diagnose by reading the failure output:
- Plugin-emit-string tests should still pass (we did NOT migrate the emit strings).
- Demo test files (`movies-list.test.tsx`, `movie.test.tsx`) should pass (their RouteLocationsContext import was migrated; the `vi.mock` paths are unchanged).
- New exports-shape tests should pass (verifies the four subpaths).

### Task 14: Builds + dev smoke

- [ ] **Step 1: Build everything**

Run: `pnpm -r build`
Expected: clean builds across `@hono-preact/iso`, `@hono-preact/server`, `@hono-preact/vite`, `hono-preact`, and `app`.

- [ ] **Step 2: Type-check the demo app**

Run: `pnpm --filter app exec tsc --noEmit`
Expected: pre-existing type errors only (see PR #39's final-validation notes for the baseline list). No NEW errors should reference `hono-preact[/subpath]` resolution.

- [ ] **Step 3: Dev server smoke**

Run: `pnpm --filter app dev` (background) and wait ~10 seconds. Then in another shell:

```bash
curl -s http://localhost:5173/ | head -3
curl -s http://localhost:5173/movies | head -3
curl -s http://localhost:5173/watched | head -3
```

Each curl should return HTML starting with `<!doctype html>...`.

Stop the dev server.

- [ ] **Step 4: No commit; this is validation only**

If steps 1–3 pass, the migration is complete. The PR is ready for review.

---

## Self-Review

After writing the plan, look at the spec with fresh eyes:

**Spec coverage**

- Package layout (4 packages publish, src organization unchanged) — Tasks 1, 2, 3 (umbrella src) + Task 5 (flip private off on the three).
- `package.json` shape (umbrella) — Task 4.
- `tsconfig` (no changes needed; tsc handles re-exports natively) — implicit, no task needed.
- Plugin-emit strings stay — explicitly out of scope; no task. ✓
- Demo migration (aliases, import path, source imports, test files, package.json) — Tasks 7, 8, 9, 10, 11.
- Docs migration — Task 12.
- Tests: exports-shape — Task 6. Bundle-shape — not needed (no bundler).
- Smoke + validation — Tasks 13, 14.
- Migration order matches spec's listed steps.

**Placeholder scan**

- No "TBD", "TODO", "implement later".
- Every code block has the literal code to paste.
- Substitution patterns are explicit `sed` commands (Task 9, Task 12).

**Type consistency**

- `RouteLocationsContext` is the symbol exported from `hono-preact/internal` (Task 10 migration) and used by demo tests. Consistent with `packages/iso/src/internal/route-locations.tsx` exporting it.
- Subpath names match the spec exports map exactly: `.`, `./server`, `./vite`, `./internal`.
- Test assertions in Task 6 reference real symbols from each subpath (cross-checked against `packages/iso/src/index.ts`, `packages/server/src/index.ts`, `packages/vite/src/index.ts`, `packages/iso/src/internal.ts`).
