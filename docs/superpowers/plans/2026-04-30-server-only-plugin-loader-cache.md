# Server-Only Plugin: loader & cache Stubs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two critical bugs the final reviewer of `feat/iso-route-level-loaders` uncovered:
1. `.server.*` modules leak into client bundles when imported with only `loader`/`cache` specifiers (broken framework guarantee).
2. `loader`/`cache` specifiers are silently dropped from rewritten import statements, causing `ReferenceError` at runtime.

**Architecture:** Extend `serverOnlyPlugin` (in `@hono-preact/vite`) to recognize and stub `loader` and `cache` named imports from `*.server.*` files. Broaden `isServerImport` to match ANY `.server.*` import (not only ones with known default/named specifiers). Add a build-level integration test that asserts no `.server.ts` source string appears in any client chunk.

**Tech Stack:** TypeScript, `@babel/parser` (already used in the plugin), `magic-string` (already used), Vitest, Vite (`vite build` programmatically for the integration test).

---

## Pre-flight context for the executing engineer

You are working in a branch (`feat/iso-route-level-loaders`) inside the worktree at `/Users/stevenbeshensky/Documents/repos/hono-preact/.worktrees/route-level-loaders`. The previous 11 tasks of `docs/superpowers/plans/2026-04-29-route-level-loaders.md` are landed but the resulting branch has two critical bugs (see Goal). This plan fixes them on the same branch — no new branch.

Before touching anything:

1. Run `pnpm test` from worktree root. Expect 182/182 passing.
2. Read these to understand the surfaces you'll touch:
   - `packages/vite/src/server-only.ts` — the plugin you're extending (read fully — it's ~95 lines)
   - `packages/vite/src/__tests__/server-only-plugin.test.ts` — existing test patterns
   - `packages/iso/src/define-loader.ts` — `LoaderRef<T>` shape (you'll synthesize one in client stubs)
   - `packages/iso/src/cache.ts` — `createCache(name?)` signature and `cacheRegistry` integration
   - `apps/app/src/pages/movies.server.ts` — example file with `loader` + `cache` named exports + `serverActions`
   - `apps/app/src/iso.tsx` — example consumer that imports only `loader`/`cache` (the leak vector)
3. Read the deferred `superpowers:test-driven-development` workflow if unfamiliar with the TDD cadence used in this plan.

This work happens **on the same branch** (`feat/iso-route-level-loaders`). Do NOT create a new branch — these commits stack on top of `b1fafd1`.

---

## Decision: cache naming convention

The current pattern allows `export const cache = createCache<T>('any-name-you-want')` in `.server.ts`. The plugin needs to emit a client-side `cache` stub that registers with `cacheRegistry` under THE SAME name (so cross-page `cacheRegistry.invalidate('any-name-you-want')` works).

Two options:
- **A — source extraction:** plugin reads the `.server.ts` source synchronously, AST-parses it, finds `export const cache = createCache(<literal>)`, extracts the string literal argument. Falls back to module name if not found.
- **B — filename convention:** plugin uses the filename as the cache name. Requires updating any existing custom names (e.g. `'movies-list'` → `'movies'`) and all corresponding `cacheRegistry.invalidate(...)` callers.

**This plan uses A (source extraction).** Reason: preserves user ergonomics (cache names are arbitrary and can match cross-page semantics), avoids a sweeping rename across `.server.ts` and consumer files, and the implementation is bounded (~30 lines).

**Fallback behavior:** If extraction fails (file not found, unexpected AST shape, no `createCache(...)` call, non-literal argument), fall back to the module name (filename without `.server.*`). Emit a Vite warning so the developer notices.

---

## File Structure

### Modified files

**vite package (production code):**
- `packages/vite/src/server-only.ts` — the plugin extension

**vite package (tests):**
- `packages/vite/src/__tests__/server-only-plugin.test.ts` — new test cases for `loader`, `cache`, mixed, and unknown specifiers
- `packages/vite/src/__tests__/build-bundle-leak.test.ts` — NEW integration test that runs `vite build` on a fixture and asserts no `.server.ts` content leaks

**Test fixtures (new):**
- `packages/vite/src/__tests__/fixtures/leak-test/` — minimal Vite app with `pages/foo.tsx` + `pages/foo.server.ts` setup

### Files NOT touched
- `apps/app/**` — the integration test runs against a fixture inside `packages/vite/`, not the real app
- `packages/iso/**` — runtime types and helpers are already correct
- Docs MDX — the current docs describe the user-facing API, which doesn't change shape; only the plugin's transform behavior changes

---

## Task 1: Establish baseline with a failing build-leak integration test

**Why:** The first thing to lock down is "the bug actually happens." Write a test that builds a minimal app and asserts a `.server.ts` source string is NOT present in client output. The test will fail before the fix and pass after — the strongest possible regression guard.

**Files:**
- Create: `packages/vite/src/__tests__/fixtures/leak-test/pages/foo.tsx`
- Create: `packages/vite/src/__tests__/fixtures/leak-test/pages/foo.server.ts`
- Create: `packages/vite/src/__tests__/fixtures/leak-test/iso.tsx`
- Create: `packages/vite/src/__tests__/fixtures/leak-test/client.tsx`
- Create: `packages/vite/src/__tests__/fixtures/leak-test/server.tsx`
- Create: `packages/vite/src/__tests__/fixtures/leak-test/index.html`
- Create: `packages/vite/src/__tests__/fixtures/leak-test/vite.config.ts`
- Create: `packages/vite/src/__tests__/build-bundle-leak.test.ts`

> **Tip for the engineer:** the fixture must be small — only enough surface area to exercise the leak. Keep dependencies to `preact`, `preact-iso`, `@hono-preact/iso`, `@hono-preact/vite` (workspace links). No real database, no real UI. The "secret" we're checking for leakage is a unique sentinel string in `foo.server.ts` like `const SUPER_SECRET_DATABASE_URL = 'sentinel-must-not-leak-XYZ123';`.

- [ ] **Step 1: Create the fixture `foo.server.ts`**

```ts
// packages/vite/src/__tests__/fixtures/leak-test/pages/foo.server.ts
import { defineLoader, createCache, defineAction } from '@hono-preact/iso';

const SUPER_SECRET_DATABASE_URL = 'sentinel-must-not-leak-XYZ123';

const serverLoader = async () => {
  // referencing the secret keeps tree-shakers from removing it
  return { secret: SUPER_SECRET_DATABASE_URL.length };
};
export default serverLoader;

export const loader = defineLoader<{ secret: number }>(serverLoader);
export const cache = createCache<{ secret: number }>('foo');

export const serverActions = {
  noop: defineAction<void, { ok: boolean }>(async () => ({ ok: true })),
};
```

- [ ] **Step 2: Create the fixture `foo.tsx`, `iso.tsx`, `client.tsx`, `server.tsx`, `index.html`, `vite.config.ts`**

`pages/foo.tsx`:
```tsx
import { useLoaderData } from '@hono-preact/iso';
import { loader } from './foo.server.js';

export default function Foo() {
  const { secret } = useLoaderData(loader);
  return <p>{secret}</p>;
}
```

`iso.tsx`:
```tsx
import { lazy, Route, Router } from '@hono-preact/iso';
import { loader, cache } from './pages/foo.server.js';

const Foo = lazy(() => import('./pages/foo.js'));

export const Base = () => (
  <Router>
    <Route path="/foo" component={Foo} loader={loader} cache={cache} />
  </Router>
);
```

`client.tsx`, `server.tsx`, `index.html`: minimal scaffolding sufficient for `vite build` to produce a client bundle. Look at `apps/app/src/client.tsx` etc. for reference shapes — strip everything except what's needed to make the build run.

`vite.config.ts`:
```ts
import { honoPreact } from '@hono-preact/vite';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [honoPreact({ entry: 'server.tsx' }), preact()],
  build: { outDir: 'dist' },
});
```

> If the fixture refuses to build with the full `honoPreact` plugin (because of missing entry assumptions, etc.), reduce scope: just use the `serverOnlyPlugin` and `serverLoaderValidationPlugin` directly without the full `honoPreact` bundle. The leak test only cares about the client transform output, not a fully-functional server bundle.

- [ ] **Step 3: Add the test file**

```ts
// packages/vite/src/__tests__/build-bundle-leak.test.ts
import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures/leak-test');

function readAllFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...readAllFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

describe('client bundle does not leak server-only sources', () => {
  it('produces no chunk containing a sentinel from a *.server.ts file', async () => {
    await build({
      root: fixtureDir,
      logLevel: 'error',
      configFile: resolve(fixtureDir, 'vite.config.ts'),
      build: {
        outDir: resolve(fixtureDir, 'dist'),
        emptyOutDir: true,
      },
    });

    const distFiles = readAllFilesRecursive(resolve(fixtureDir, 'dist'));
    const offending: string[] = [];
    for (const f of distFiles) {
      const content = readFileSync(f, 'utf8');
      if (content.includes('sentinel-must-not-leak-XYZ123')) {
        offending.push(f);
      }
    }
    expect(offending, `Server-only sentinel found in: ${offending.join(', ')}`).toEqual([]);
  }, 60_000);
});
```

- [ ] **Step 4: Run the test to verify it fails (this is the bug)**

```bash
pnpm vitest run packages/vite/src/__tests__/build-bundle-leak.test.ts
```

Expected: FAILS. The dist contains the sentinel because the current `serverOnlyPlugin` doesn't transform the `iso.tsx` `loader`/`cache` import.

If the test fails for OTHER reasons (fixture build errors, missing dependencies), STOP and fix the fixture before proceeding. The test must fail specifically because of the leak.

- [ ] **Step 5: Commit the failing test and fixture**

```bash
git add packages/vite/src/__tests__/fixtures/leak-test/ packages/vite/src/__tests__/build-bundle-leak.test.ts
git commit -m "test(vite): add failing bundle-leak regression test for .server.ts content"
```

(Yes — committing a failing test. Mark it with `it.fails(...)` if your test runner refuses to commit failing tests in CI, OR leave the commit and add a follow-up `expect.assertions(...)` workaround. The point is to land the regression coverage in the same branch as the fix.)

> **Alternative:** if landing a failing test is uncomfortable, batch this commit with Task 5's "fix" commit so the failing test is never on the branch. The plan is structured to allow either ordering.

---

## Task 2: Plugin unit tests for the new specifier shapes (TDD red)

**Why:** Before changing the plugin, write the unit tests that describe what it should do. These give fast feedback during implementation; the integration test (Task 1) is the slow safety net.

**Files:**
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Read the existing test file to learn the `transform()` helper signature and the assertion patterns**

The helper at the top is:
```ts
function transform(code, id, options = {}): { code: string; map: unknown } | undefined
```

The convention: feed source code and an importer ID, assert on what's in `result.code`.

- [ ] **Step 2: Add new test cases (each will fail until Task 3/4)**

Add a new `describe` block at the bottom of the file:

```ts
describe('loader and cache specifiers', () => {
  it('replaces a `loader` named import with a client-side LoaderRef stub', () => {
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toMatch(/const loader = \{[\s\S]*__id: Symbol\.for\(['"]@hono-preact\/loader:movies['"]\)[\s\S]*fn:\s*async/);
    expect(result?.code).toContain("fetch('/__loaders'");
    expect(result?.code).toContain('"movies"');
  });

  it('replaces a `cache` named import with a createCache call using the source-file name', () => {
    // The fixture file isn't available here; the plugin should fall back to module name.
    const code = `import { cache } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toContain("import { createCache as");
    // Expect the fallback name (module name) since no fixture exists for source-extraction.
    expect(result?.code).toMatch(/createCache\(['"]movies['"]\)/);
  });

  it('handles `loader` aliased to a different local name', () => {
    const code = `import { loader as moviesLoader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toMatch(/const moviesLoader = \{[\s\S]*Symbol\.for/);
    expect(result?.code).toContain('"movies"');
  });

  it('handles `cache` aliased to a different local name', () => {
    const code = `import { cache as moviesCache } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toContain('const moviesCache =');
    expect(result?.code).toMatch(/createCache\(['"]movies['"]\)/);
  });

  it('handles mixed loader + cache + serverActions in one import statement', () => {
    const code = `import { loader, cache, serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const loader =');
    expect(result?.code).toContain('const cache =');
    expect(result?.code).toContain('const serverActions = new Proxy');
  });

  it('handles mixed default + loader in one import statement', () => {
    const code = `import serverLoader, { loader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toContain('const serverLoader =');
    expect(result?.code).toContain('const loader =');
  });

  it('matches an import that has ONLY loader (no default, no actions, no guards)', () => {
    // This is the bug from the route-level-loaders migration: imports with only
    // `loader` were silently passed through.
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result).toBeDefined();
    expect(result?.code).not.toContain("import { loader }");
    expect(result?.code).toContain('const loader =');
  });

  it('matches an import that has ONLY cache (no default, no actions, no guards)', () => {
    const code = `import { cache } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result).toBeDefined();
    expect(result?.code).not.toContain("import { cache }");
    expect(result?.code).toContain('const cache =');
  });
});

describe('unknown specifiers from .server.* imports', () => {
  it('throws a clear error when an unknown named export is imported from .server.*', () => {
    const code = `import { unknownExport } from './movies.server.js';`;
    expect(() => transform(code, '/src/iso.tsx')).toThrow(
      /unknownExport.*not a recognized.*server/i
    );
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

```bash
pnpm vitest run packages/vite/src/__tests__/server-only-plugin.test.ts -t "loader and cache"
pnpm vitest run packages/vite/src/__tests__/server-only-plugin.test.ts -t "unknown specifiers"
```

Expected: all new tests fail (the plugin doesn't handle these cases yet).

> Note: do NOT commit yet — these are red. Task 3 makes them green.

---

## Task 3: Implement broadened `isServerImport` + `loader`/`cache` stubs + unknown-specifier guard

**Why:** Make the failing tests from Task 2 pass.

**Files:**
- Modify: `packages/vite/src/server-only.ts`

- [ ] **Step 1: Read the file end-to-end again** to make sure you understand the existing `isServerImport`, the per-specifier stub loop, and the `MagicString.overwrite` call.

- [ ] **Step 2: Broaden `isServerImport` to match ANY .server.* import**

Replace:
```ts
const isServerImport = (node: unknown): node is ImportDeclaration =>
  (node as ImportDeclaration).type === 'ImportDeclaration' &&
  /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value) &&
  (node as ImportDeclaration).specifiers.some(
    (s) =>
      s.type === 'ImportDefaultSpecifier' ||
      (s.type === 'ImportSpecifier' &&
        s.imported.type === 'Identifier' &&
        (s.imported.name === 'serverGuards' ||
          s.imported.name === 'actionGuards' ||
          s.imported.name === 'serverActions'))
  );
```

With:
```ts
const isServerImport = (node: unknown): node is ImportDeclaration =>
  (node as ImportDeclaration).type === 'ImportDeclaration' &&
  /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value);
```

Any import from a `*.server.*` file is now in scope. This is the central safety fix.

- [ ] **Step 3: Add the `loader` stub branch in the specifier loop**

Inside the `for (const specifier of serverImport.specifiers)` loop, after the existing `serverActions` branch, add:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  specifier.imported.name === 'loader'
) {
  stubs.push(
    `const ${specifier.local.name} = {\n` +
    `  __id: Symbol.for('@hono-preact/loader:${moduleName}'),\n` +
    `  fn: async ({ location }) => {\n` +
    `    const res = await fetch('/__loaders', {\n` +
    `      method: 'POST',\n` +
    `      headers: { 'Content-Type': 'application/json' },\n` +
    `      body: JSON.stringify({ module: ${JSON.stringify(moduleName)}, location: { path: location.path, pathParams: location.pathParams, query: location.query } }),\n` +
    `    });\n` +
    `    if (!res.ok) {\n` +
    `      const body = await res.json().catch(() => ({}));\n` +
    `      throw new Error(body.error ?? \`Loader failed with status \${res.status}\`);\n` +
    `    }\n` +
    `    return res.json();\n` +
    `  },\n` +
    `};`
  );
}
```

`Symbol.for(...)` (not `Symbol(...)`) is critical — multiple files importing `loader` from the same `.server.ts` must get the same symbol so `useLoaderData(ref).__id` matching works.

- [ ] **Step 4: Add the `cache` stub branch + helper for source-extracting the cache name**

First, add a helper at module scope:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';

function extractCacheName(
  importerPath: string,
  importSource: string,
  fallbackModuleName: string
): string {
  // Resolve the import source relative to the importer.
  const importerDir = path.dirname(importerPath);
  const baseResolved = path.resolve(importerDir, importSource);
  // Try common TS/JS extensions.
  const candidates = [
    baseResolved,
    baseResolved.replace(/\.js$/, '.ts'),
    baseResolved.replace(/\.jsx$/, '.tsx'),
    baseResolved.replace(/\.mjs$/, '.mts'),
    baseResolved + '.ts',
    baseResolved + '.tsx',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const src = fs.readFileSync(candidate, 'utf8');
        const ast = parse(src, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
          errorRecovery: true,
        });
        for (const node of ast.program.body) {
          if (
            node.type === 'ExportNamedDeclaration' &&
            node.declaration?.type === 'VariableDeclaration'
          ) {
            for (const decl of node.declaration.declarations) {
              if (
                decl.id.type === 'Identifier' &&
                decl.id.name === 'cache' &&
                decl.init?.type === 'CallExpression' &&
                decl.init.callee.type === 'Identifier' &&
                decl.init.callee.name === 'createCache'
              ) {
                const arg = decl.init.arguments[0];
                if (arg?.type === 'StringLiteral') return arg.value;
              }
            }
          }
        }
      } catch {
        // Source-parse failure — fall through to the fallback.
      }
      break; // file exists but no extractable name; don't keep trying extensions
    }
  }
  return fallbackModuleName;
}
```

Then in the specifier loop, after the `loader` branch:

```ts
} else if (
  specifier.type === 'ImportSpecifier' &&
  specifier.imported.type === 'Identifier' &&
  specifier.imported.name === 'cache'
) {
  const cacheName = extractCacheName(id, serverImport.source.value, moduleName);
  // Use a per-source unique alias to avoid collisions when multiple .server.ts
  // files contribute cache imports to the same consumer.
  const aliasSuffix = moduleName.replace(/[^a-zA-Z0-9_$]/g, '_');
  needsCacheImport.add(aliasSuffix);
  stubs.push(
    `const ${specifier.local.name} = __$createCache_${aliasSuffix}(${JSON.stringify(cacheName)});`
  );
}
```

You'll also need to declare `needsCacheImport` near the top of `transform`:

```ts
const needsCacheImport = new Set<string>();
```

And after the per-import loop completes, prepend any required `createCache` imports:

```ts
if (needsCacheImport.size > 0) {
  const importDeclarations = [...needsCacheImport]
    .map(
      (suffix) =>
        `import { createCache as __$createCache_${suffix} } from '@hono-preact/iso';`
    )
    .join('\n');
  s.prepend(importDeclarations + '\n');
}
```

- [ ] **Step 5: Add the unknown-specifier guard**

Inside the specifier loop, after all the recognized branches, add a final `else`:

```ts
} else {
  const importedName =
    specifier.type === 'ImportSpecifier' &&
    specifier.imported.type === 'Identifier'
      ? specifier.imported.name
      : specifier.type === 'ImportNamespaceSpecifier'
      ? '* as ' + specifier.local.name
      : '<unknown>';
  throw new Error(
    `${id}: \`${importedName}\` is not a recognized export from a *.server.* module. ` +
    `Allowed: default, loader, cache, serverGuards, serverActions, actionGuards.`
  );
}
```

This converts the silent-drop bug from Critical #2 into a clear build-time error.

- [ ] **Step 6: Run the unit tests to verify all pass**

```bash
pnpm vitest run packages/vite/src/__tests__/server-only-plugin.test.ts
```

Expected: ALL tests pass (existing + new).

- [ ] **Step 7: Run the build-leak integration test**

```bash
pnpm vitest run packages/vite/src/__tests__/build-bundle-leak.test.ts
```

Expected: PASSES. The fixture's sentinel string no longer appears in the client bundle.

If it still fails, debug:
- Inspect `packages/vite/src/__tests__/fixtures/leak-test/dist/` to see which file has the sentinel.
- Re-read the offending file's source — the leak might be from a path the plugin doesn't catch (e.g., a transitive `.server.ts` re-export).

- [ ] **Step 8: Run the full repo test suite**

```bash
pnpm test
```

Expected: 182 + 8 (new specifier tests) + 1 (unknown-specifier test) + 1 (bundle leak) ≈ 192/192.

- [ ] **Step 9: Build the iso, server, hono-preact, and vite packages**

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
```

Expected: clean builds across all four packages.

- [ ] **Step 10: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(vite): stub loader and cache imports from .server.*, broaden import matching"
```

---

## Task 4: Verify the real app no longer leaks and works end-to-end

**Why:** The fixture proves the plugin works. Now confirm the real app (`apps/app`) — which the previous bad commits broke — actually works after the plugin fix.

**Files:** None modified. This task is verification-only, but it MUST succeed before the branch is mergeable.

- [ ] **Step 1: Build the real app**

```bash
pnpm --filter app build
```

Expected: clean.

- [ ] **Step 2: Inspect the client bundle for `.server.ts` content**

```bash
# Look for known server-only strings that should NOT appear in client output.
grep -r "Moana 2" apps/app/dist/static/ 2>/dev/null && echo "LEAK: TMDB seed found in client bundle" || echo "OK: TMDB seed not in client"
grep -r "markWatched" apps/app/dist/static/ 2>/dev/null && echo "LEAK: markWatched fn in client" || echo "OK: markWatched not in client"
grep -r "listWatched" apps/app/dist/static/ 2>/dev/null && echo "LEAK: listWatched fn in client" || echo "OK: listWatched not in client"
```

Expected: all three checks print "OK". If any print "LEAK", STOP and report — the plugin missed a code path.

- [ ] **Step 3: Inspect the page chunk for the bare `moviesLoader` reference**

```bash
# The previous bug: useLoaderData(moviesLoader) referenced an undeclared identifier.
# After the fix, moviesLoader should be declared as a local const in the page chunk.
grep -l "useLoaderData" apps/app/dist/static/*.js | while read f; do
  echo "=== $f ==="
  # Look for the pattern: a `const moviesLoader =` declaration before its use.
  grep -c "const.*[Ll]oader.*Symbol.for\|const.*[Ll]oader.*=" "$f" || echo "WARNING: no Loader const found"
done
```

Expected: every file using `useLoaderData(...)` has a `const X = {Symbol.for...}` declaration above the use. If not, the plugin missed something specific to that page.

- [ ] **Step 4: Dev-server smoke test all routes (manual end-to-end)**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 6
for path in / /test /movies /movies/1241982 /watched /docs /docs/quick-start; do
  echo "--- $path ---"
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5173$path")
  bytes=$(curl -s "http://localhost:5173$path" | wc -c)
  echo "  HTTP $status, $bytes bytes"
done
pkill -f "vite --force" 2>/dev/null
```

Expected: every route returns HTTP 200 with substantial content. If any return 500 or are very small (suggesting an error page), open that URL in a browser to see the error.

- [ ] **Step 5: Browser smoke test (manual, the engineer running this should do it themselves)**

Open `http://localhost:5173/movies` in a browser. Open the DevTools Console.

- Click into a movie. Should navigate to `/movies/:id`.
- Click "Mark watched". Should:
  - Show optimistic ✓ watched immediately
  - Fire ONE XHR to `/__actions`
  - Fire ONE XHR to `/__loaders` (the auto-reload)
  - NOT show any console errors
  - NOT show a "Loading..." flash

If the browser shows a `ReferenceError` or any "X is not defined" message in the console, the plugin still has a gap. Report which page and which identifier.

- [ ] **Step 6: Run the full test suite once more (sanity)**

```bash
pnpm test
```

Expected: same count as Task 3 step 8 (all green).

- [ ] **Step 7: No commit needed for this task** (verification only).

---

## Task 5: Final review pass

**Files:** None modified. This is the same kind of holistic review the previous final reviewer did, performed before opening the PR.

- [ ] **Step 1: Dispatch a fresh code-reviewer subagent (or run the review manually)** with focus on:
  - Correctness of the new stubs (especially `Symbol.for` identity, RPC fetch shape)
  - Whether the source-extraction helper handles edge cases (file not found, syntax errors, no `cache` export, non-literal arg)
  - Whether the unknown-specifier error message is clear enough for a developer to understand the fix
  - Whether the build-leak test is robust (would it pass even without the fix, by luck?)
  - Any path the plugin still misses (re-exports, namespace imports, dynamic imports)

- [ ] **Step 2: Address any Critical / Important findings before opening the PR.**

- [ ] **Step 3: Final clean-state verification**

```bash
git status                    # clean
pnpm test                     # all green
pnpm --filter app build       # clean
cd apps/app && npx tsc --noEmit  # clean
```

- [ ] **Step 4: Open the PR (or update the existing one)**

If this branch already has a PR open against `feat/iso-v3-components` (or wherever), update its description with the bugs fixed and link this plan. If not, open it now.

Suggested commit log shape (visible in PR):
```
b1fafd1 chore(app): drop unused imports left over from migration
262d87e docs: rewrite for route-level loaders
be2e217 refactor(app): migrate movie detail to route-level loader with custom Wrapper
... (rest of the migration commits) ...
NEW1     test(vite): add failing bundle-leak regression test for .server.ts content
NEW2     feat(vite): stub loader and cache imports from .server.*, broaden import matching
```

---

## Out of scope (NOT in this plan)

- **Refactoring the per-import stub generation into a registry pattern** — current code uses an `if/else` chain per specifier. A registry-driven design would be cleaner, but it's a separate refactor. Don't blend it in.
- **Source-extracting OTHER metadata** (e.g., loader options) — only `cache` name needs source extraction in this plan.
- **Caching the source-parse result across multiple imports of the same `.server.ts`** — small perf win, not worth the complexity.
- **Updating the existing user-facing docs MDX** — none of them describe the plugin internals; the user-facing API didn't change shape, only the build behavior.

---

## Self-review notes for the plan author (me)

A reader of this plan should be able to:
- Run Task 1 first to land the failing regression test (or batch with Task 3 if uncomfortable committing red).
- Run Task 2 to write red unit tests that describe the fix.
- Run Task 3 to make all the red tests green.
- Run Task 4 to verify the real app works end-to-end.
- Run Task 5 to do a holistic review and open the PR.

Each task ends with a verifiable state. Task 3 is the largest (~100 lines of plugin code + new helper); the rest are lighter.

The two critical bugs are addressed by:
- Critical #1 (server-only leak): Task 3 step 2 (broaden `isServerImport`)
- Critical #2 (silent specifier drop / `ReferenceError`): Task 3 step 3 (loader stub) + step 4 (cache stub) + step 5 (unknown-specifier guard)

The integration test (Task 1) is the load-bearing regression guard for Critical #1. The unit tests (Task 2) cover Critical #2 directly. Together they would have caught both issues in the original migration.
