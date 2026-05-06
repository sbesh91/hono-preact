# Path-Keyed Module Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace basename-as-routing-key with a Vite-plugin-injected path-derived module key, eliminating basename collisions and decoupling routing identity from filename conventions.

**Architecture:** A new Vite plugin (`moduleKeyPlugin`) transforms `.server.*` files at build time to inject a module-level `export const __moduleKey = '<path>'` constant whose value is the file's path relative to the Vite project root with the `.server.{ts,tsx,js,jsx}` extension stripped. The same plugin threads this key into `defineLoader` calls via a hidden second-arg metadata. The existing `serverOnlyPlugin` is updated to (a) capture `viteRoot` via `configResolved`, and (b) emit the same path key in client-side RPC stubs (`loaderFetchArrow` and the `serverActions` Proxy). Server handlers (`loadersHandler`, `actionsHandler`) read `mod.__moduleKey` from glob entries instead of computing from filenames. `defineLoader`'s public type drops the string-name argument; `defineAction`'s runtime is unchanged because all action identity flows through the Proxy.

**Tech Stack:** TypeScript, Vite plugin API, Babel parser (`@babel/parser`), MagicString, Hono, vitest.

**Companion to:** `docs/superpowers/research/2026-05-04-framework-simplification.md` §4.3, §6.3, §7.3, §9 step 1.

---

## File Structure

### Modified files

- `packages/iso/src/define-loader.ts` — accept `(fn, opts?)` overload where `opts.__moduleKey` builds `__id = Symbol.for('@hono-preact/loader:' + opts.__moduleKey)`. The legacy `(name, fn)` overload stays alive through this plan and is removed in the final task.
- `packages/iso/src/__tests__/define-loader.test.ts` — replace tests covering the string-name shape with tests covering the `__moduleKey` opts shape and the path-keyed `__id` derivation.
- `packages/vite/src/server-only.ts` — capture `viteRoot` via `configResolved`. Update `loaderFetchArrow` to take a key string instead of computing from `serverImport.source.value`. Update the `serverActions` Proxy emission to use the same key. Update `loader` import rewrite to use the plugin-derived key. Drop `extractLoaderName` (no longer needed) and `extractCacheName`'s loader-related fallback.
- `packages/vite/src/__tests__/server-only-plugin.test.ts` — update assertions: `__module` and `__action` payloads carry the path key, not the basename. Update fixture filesystem expectations.
- `packages/vite/src/index.ts` — re-export the new `moduleKeyPlugin`.
- `packages/vite/src/hono-preact.ts` — wire `moduleKeyPlugin` into the meta-plugin's plugin list alongside `serverOnlyPlugin`.
- `packages/server/src/loaders-handler.ts` — read `mod.__moduleKey` from each glob entry; remove `moduleNameFromPath`.
- `packages/server/src/actions-handler.ts` — read `mod.__moduleKey` from each glob entry; remove `moduleNameFromPath`.
- `packages/server/src/__tests__/loaders-handler.test.ts` — update fixtures to set `__moduleKey` instead of relying on filename keys.
- `packages/server/src/__tests__/actions-handler.test.ts` — same.
- `apps/app/src/pages/movies.server.ts` — drop the `'movies'` string argument from `defineLoader`.
- `apps/app/src/pages/watched.server.ts` — drop the `'watched'` string argument from `defineLoader`.
- `apps/app/src/pages/movie.server.ts` — drop the `'movie'` string argument from `defineLoader`.

### Created files

- `packages/vite/src/module-key.ts` — pure helper: `deriveModuleKey(absPath, viteRoot)` returning `path.relative(viteRoot, absPath).replace(/\.server\.[jt]sx?$/, '').replace(/\\/g, '/')`. Single responsibility: path → key. Used by both `moduleKeyPlugin` and `serverOnlyPlugin`.
- `packages/vite/src/__tests__/module-key.test.ts` — unit tests for the helper.
- `packages/vite/src/module-key-plugin.ts` — the new plugin. Captures `viteRoot` via `configResolved`. Transforms `.server.{ts,tsx,js,jsx}` files only. Parses, prepends `export const __moduleKey = '<key>';`, threads `{ __moduleKey }` into `defineLoader(fn)` calls (so the runtime symbol matches the client-side stub).
- `packages/vite/src/__tests__/module-key-plugin.test.ts` — unit tests for the plugin's transform.

### Deleted files

None.

---

## Task 1: Add the `deriveModuleKey` helper

**Files:**
- Create: `packages/vite/src/module-key.ts`
- Test: `packages/vite/src/__tests__/module-key.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/vite/src/__tests__/module-key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { deriveModuleKey } from '../module-key.js';

describe('deriveModuleKey', () => {
  it('produces a forward-slash path relative to root with the .server.ts extension stripped', () => {
    const root = '/Users/me/repo';
    const abs = '/Users/me/repo/apps/app/src/pages/movies.server.ts';
    expect(deriveModuleKey(abs, root)).toBe('apps/app/src/pages/movies');
  });

  it('handles .server.tsx extensions', () => {
    expect(
      deriveModuleKey('/r/src/pages/admin.server.tsx', '/r')
    ).toBe('src/pages/admin');
  });

  it('handles .server.js and .server.jsx extensions', () => {
    expect(deriveModuleKey('/r/a/x.server.js', '/r')).toBe('a/x');
    expect(deriveModuleKey('/r/a/x.server.jsx', '/r')).toBe('a/x');
  });

  it('normalizes Windows-style path separators to forward slashes', () => {
    expect(
      deriveModuleKey('C:\\repo\\src\\pages\\movies.server.ts', 'C:\\repo')
    ).toBe('src/pages/movies');
  });

  it('produces distinct keys for files that share a basename in different folders', () => {
    const root = '/r';
    const a = deriveModuleKey('/r/pages/movies.server.ts', root);
    const b = deriveModuleKey('/r/pages/admin/movies.server.ts', root);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/vite/src/__tests__/module-key.test.ts`

Expected: FAIL — "Cannot find module '../module-key.js'".

- [ ] **Step 3: Implement the helper**

Create `packages/vite/src/module-key.ts`:

```ts
import * as path from 'node:path';

/**
 * Derive the stable module key for a `.server.*` file.
 *
 * The key is the file's path relative to the Vite project root, with the
 * `.server.{ts,tsx,js,jsx}` extension stripped, and path separators
 * normalized to forward slashes (so the key is identical on Windows and
 * POSIX). Used as the routing key for `__loaders`/`__actions` RPC, the
 * payload of `Symbol.for(...)` for `__id`, and the value of the
 * module-level `__moduleKey` export.
 */
export function deriveModuleKey(absPath: string, viteRoot: string): string {
  const rel = path.relative(viteRoot, absPath);
  const stripped = rel.replace(/\.server\.[jt]sx?$/, '');
  return stripped.replace(/\\/g, '/');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/module-key.test.ts`

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/module-key.ts packages/vite/src/__tests__/module-key.test.ts
git commit -m "feat(vite): add deriveModuleKey helper"
```

---

## Task 2: Add `__moduleKey` opts overload to `defineLoader`

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Test: `packages/iso/src/__tests__/define-loader.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/iso/src/__tests__/define-loader.test.ts`:

```ts
describe('defineLoader (path-keyed __moduleKey form)', () => {
  it('accepts (fn, { __moduleKey }) and derives __id from the key', () => {
    const ref = defineLoader(async () => ({}), {
      __moduleKey: 'apps/app/src/pages/movies',
    });
    expect(Symbol.keyFor(ref.__id)).toBe(
      '@hono-preact/loader:apps/app/src/pages/movies'
    );
  });

  it('produces the same __id symbol for two calls with the same __moduleKey', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    const b = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    expect(a.__id).toBe(b.__id);
  });

  it('produces distinct __id for distinct __moduleKey values', () => {
    const a = defineLoader(async () => ({}), { __moduleKey: 'pages/movies' });
    const b = defineLoader(async () => ({}), {
      __moduleKey: 'pages/admin/movies',
    });
    expect(a.__id).not.toBe(b.__id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/iso/src/__tests__/define-loader.test.ts`

Expected: FAIL — first test throws "name must be a non-empty string" because the runtime currently rejects the new shape.

- [ ] **Step 3: Implement the overload**

Update `packages/iso/src/define-loader.ts` in full:

```ts
import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';

export type LoaderCtx = { location: RouteHook };

export type Loader<T> = (ctx: LoaderCtx) => Promise<T>;

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache?: LoaderCache<T>;
}

export type DefineLoaderOpts<T> = {
  __moduleKey: string;
  cache?: LoaderCache<T>;
};

// Public form (post-plugin authoring): defineLoader(fn) — the plugin will
// rewrite this to defineLoader(fn, { __moduleKey: '...' }) at build time.
export function defineLoader<T>(fn: Loader<T>): LoaderRef<T>;
// Plugin-emitted form: defineLoader(fn, { __moduleKey, cache? }).
export function defineLoader<T>(
  fn: Loader<T>,
  opts: DefineLoaderOpts<T>
): LoaderRef<T>;
// Legacy form (deprecated, removed in the final task of this plan):
// defineLoader(name, fn, cache?).
export function defineLoader<T>(
  name: string,
  fn: Loader<T>,
  cache?: LoaderCache<T>
): LoaderRef<T>;
export function defineLoader<T>(
  fnOrName: Loader<T> | string,
  fnOrOpts?: Loader<T> | DefineLoaderOpts<T>,
  legacyCache?: LoaderCache<T>
): LoaderRef<T> {
  if (typeof fnOrName === 'string') {
    // Legacy (name, fn) form.
    const name = fnOrName;
    const fn = fnOrOpts as Loader<T>;
    if (name.length === 0) {
      throw new Error(
        'defineLoader(name, fn): name must be a non-empty string. ' +
          "Pick a stable identifier matching the .server.* module basename, " +
          "e.g. defineLoader('movies', serverLoader)."
      );
    }
    return {
      __id: Symbol.for(`@hono-preact/loader:${name}`),
      fn,
      cache: legacyCache,
    };
  }

  // New (fn, opts?) form. When opts is absent, the plugin hasn't run yet
  // (e.g. in unit tests of consumer code that import the .server.* file
  // directly). Use a placeholder symbol; identity will be unstable across
  // module reloads, which is acceptable for tests.
  const fn = fnOrName;
  const opts = fnOrOpts as DefineLoaderOpts<T> | undefined;
  if (opts?.__moduleKey) {
    return {
      __id: Symbol.for(`@hono-preact/loader:${opts.__moduleKey}`),
      fn,
      cache: opts.cache,
    };
  }
  return {
    __id: Symbol(`@hono-preact/loader:<unkeyed>`),
    fn,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/iso/src/__tests__/define-loader.test.ts`

Expected: PASS — all existing tests plus the three new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader.test.ts
git commit -m "feat(iso): add defineLoader (fn, { __moduleKey }) overload"
```

---

## Task 3: Capture `viteRoot` in `serverOnlyPlugin`

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Test: `packages/vite/src/__tests__/server-only-plugin.test.ts`

The plugin currently has no access to the project root. Add a `configResolved` hook to capture it and a private accessor for tests.

- [ ] **Step 1: Write the failing test**

Append to `packages/vite/src/__tests__/server-only-plugin.test.ts`:

```ts
describe('serverOnlyPlugin viteRoot capture', () => {
  it('captures viteRoot from configResolved and exposes it for plugin coordination', () => {
    const plugin = serverOnlyPlugin() as Plugin & {
      configResolved?: (config: { root: string }) => void;
      _viteRoot?: () => string | undefined;
    };
    expect(plugin._viteRoot?.()).toBeUndefined();
    plugin.configResolved?.({ root: '/Users/me/repo' });
    expect(plugin._viteRoot?.()).toBe('/Users/me/repo');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/vite/src/__tests__/server-only-plugin.test.ts`

Expected: FAIL — `plugin._viteRoot` is undefined.

- [ ] **Step 3: Add the hook and accessor**

In `packages/vite/src/server-only.ts`, replace the `export function serverOnlyPlugin(): Plugin {` body's opening with:

```ts
export function serverOnlyPlugin(): Plugin {
  let viteRoot: string | undefined;
  return {
    name: 'server-only',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root;
    },
    // Test-only accessor. Used by unit tests to verify the hook fires;
    // not part of the public plugin contract.
    _viteRoot: () => viteRoot,
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      // ...existing body unchanged for now...
```

(Leave the existing `transform` body unchanged in this task — we'll consume `viteRoot` in Task 6.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/server-only-plugin.test.ts`

Expected: PASS — the new test passes; all existing tests still pass (no behavior change in `transform` yet).

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(vite): capture viteRoot in serverOnlyPlugin via configResolved"
```

---

## Task 4: Create `moduleKeyPlugin` skeleton (configResolved + .server.* gate)

**Files:**
- Create: `packages/vite/src/module-key-plugin.ts`
- Test: `packages/vite/src/__tests__/module-key-plugin.test.ts`

This task delivers a plugin that recognizes `.server.*` files but does no transform yet (returns `undefined`). Subsequent tasks fill in behavior.

- [ ] **Step 1: Write the failing test**

Create `packages/vite/src/__tests__/module-key-plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string
) => { code: string; map: unknown } | undefined;

function makePlugin() {
  const plugin = moduleKeyPlugin() as Plugin & {
    configResolved?: (config: { root: string }) => void;
    transform: TransformFn;
  };
  plugin.configResolved?.({ root: '/Users/me/repo' });
  return plugin;
}

describe('moduleKeyPlugin', () => {
  it('returns undefined for non-server files', () => {
    const plugin = makePlugin();
    const result = plugin.transform.call(
      {} as any,
      `export const x = 1;`,
      '/Users/me/repo/src/util.ts'
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for files outside the configured root', () => {
    const plugin = makePlugin();
    const result = plugin.transform.call(
      {} as any,
      `export default async () => ({});`,
      '/elsewhere/movies.server.ts'
    );
    // viteRoot mismatch is a configuration error; plugin no-ops rather than
    // throws to avoid breaking dev for files outside the watched root.
    expect(result).toBeUndefined();
  });

  it('transforms .server.ts files inside the root (returns a code object)', () => {
    const plugin = makePlugin();
    const code = `export default async () => ({});`;
    const result = plugin.transform.call(
      {} as any,
      code,
      '/Users/me/repo/src/pages/movies.server.ts'
    );
    expect(result).toBeDefined();
    expect(result?.code).toBeTypeOf('string');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/vite/src/__tests__/module-key-plugin.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the skeleton**

Create `packages/vite/src/module-key-plugin.ts`:

```ts
import type { Plugin } from 'vite';

/**
 * Transforms `.server.*` files to inject a stable module-level
 * `__moduleKey` export (and to thread that key into `defineLoader` calls).
 * The key is path-derived (see `deriveModuleKey`), so it survives builds
 * and HMR, and is unique per file.
 *
 * Pairs with `serverOnlyPlugin`, which transforms client-side imports of
 * `.server.*` files. Both plugins compute the same key from the same
 * absolute path + viteRoot.
 */
export function moduleKeyPlugin(): Plugin {
  let viteRoot: string | undefined;
  return {
    name: 'module-key',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root;
    },
    transform(code: string, id: string) {
      if (viteRoot === undefined) return;
      if (!/\.server\.[jt]sx?$/.test(id)) return;
      if (!id.startsWith(viteRoot)) return;
      // Skeleton: signals that we'll handle this file in subsequent tasks.
      return { code, map: null };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/module-key-plugin.test.ts`

Expected: PASS — three tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/module-key-plugin.ts packages/vite/src/__tests__/module-key-plugin.test.ts
git commit -m "feat(vite): add moduleKeyPlugin skeleton"
```

---

## Task 5: `moduleKeyPlugin` injects `__moduleKey` export

**Files:**
- Modify: `packages/vite/src/module-key-plugin.ts`
- Modify: `packages/vite/src/__tests__/module-key-plugin.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/vite/src/__tests__/module-key-plugin.test.ts`:

```ts
describe('moduleKeyPlugin __moduleKey injection', () => {
  it('prepends `export const __moduleKey = "<key>"` to .server.ts files', () => {
    const plugin = makePlugin();
    const code = `export default async () => ({});`;
    const result = plugin.transform.call(
      {} as any,
      code,
      '/Users/me/repo/src/pages/movies.server.ts'
    );
    expect(result?.code).toMatch(
      /^export const __moduleKey = "src\/pages\/movies";/
    );
  });

  it('uses the path-derived key for nested folders', () => {
    const plugin = makePlugin();
    const result = plugin.transform.call(
      {} as any,
      `export default async () => ({});`,
      '/Users/me/repo/src/pages/admin/movies.server.ts'
    );
    expect(result?.code).toMatch(
      /^export const __moduleKey = "src\/pages\/admin\/movies";/
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/vite/src/__tests__/module-key-plugin.test.ts`

Expected: FAIL — output code does not contain `__moduleKey`.

- [ ] **Step 3: Implement injection**

Update `packages/vite/src/module-key-plugin.ts`:

```ts
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { deriveModuleKey } from './module-key.js';

export function moduleKeyPlugin(): Plugin {
  let viteRoot: string | undefined;
  return {
    name: 'module-key',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root;
    },
    transform(code: string, id: string) {
      if (viteRoot === undefined) return;
      if (!/\.server\.[jt]sx?$/.test(id)) return;
      if (!id.startsWith(viteRoot)) return;

      const key = deriveModuleKey(id, viteRoot);
      const s = new MagicString(code);
      s.prepend(`export const __moduleKey = ${JSON.stringify(key)};\n`);
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/module-key-plugin.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/module-key-plugin.ts packages/vite/src/__tests__/module-key-plugin.test.ts
git commit -m "feat(vite): moduleKeyPlugin injects __moduleKey export"
```

---

## Task 6: `moduleKeyPlugin` threads `__moduleKey` into `defineLoader` calls

**Files:**
- Modify: `packages/vite/src/module-key-plugin.ts`
- Modify: `packages/vite/src/__tests__/module-key-plugin.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/vite/src/__tests__/module-key-plugin.test.ts`:

```ts
describe('moduleKeyPlugin defineLoader threading', () => {
  it('rewrites `defineLoader(fn)` to `defineLoader(fn, { __moduleKey })`', () => {
    const plugin = makePlugin();
    const code = [
      `import { defineLoader } from '@hono-preact/iso';`,
      `const serverLoader = async () => ({});`,
      `export default serverLoader;`,
      `export const loader = defineLoader(serverLoader);`,
    ].join('\n');
    const result = plugin.transform.call(
      {} as any,
      code,
      '/Users/me/repo/src/pages/movies.server.ts'
    );
    expect(result?.code).toContain(
      'defineLoader(serverLoader, { __moduleKey: "src/pages/movies" })'
    );
  });

  it('leaves an existing two-arg defineLoader call unchanged', () => {
    // Legacy (name, fn) form is still supported until the cleanup task; the
    // plugin should not touch calls that already have a second argument.
    const plugin = makePlugin();
    const code = [
      `import { defineLoader } from '@hono-preact/iso';`,
      `export const loader = defineLoader('movies', async () => ({}));`,
    ].join('\n');
    const result = plugin.transform.call(
      {} as any,
      code,
      '/Users/me/repo/src/pages/movies.server.ts'
    );
    expect(result?.code).toContain(
      `defineLoader('movies', async () => ({}))`
    );
    expect(result?.code).not.toContain('__moduleKey: ');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/vite/src/__tests__/module-key-plugin.test.ts`

Expected: FAIL — first new test does not contain the expected rewrite.

- [ ] **Step 3: Implement threading**

Replace the body of `packages/vite/src/module-key-plugin.ts`:

```ts
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { CallExpression } from '@babel/types';
import type { Plugin } from 'vite';
import { deriveModuleKey } from './module-key.js';

export function moduleKeyPlugin(): Plugin {
  let viteRoot: string | undefined;
  return {
    name: 'module-key',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root;
    },
    transform(code: string, id: string) {
      if (viteRoot === undefined) return;
      if (!/\.server\.[jt]sx?$/.test(id)) return;
      if (!id.startsWith(viteRoot)) return;

      const key = deriveModuleKey(id, viteRoot);
      const s = new MagicString(code);
      s.prepend(`export const __moduleKey = ${JSON.stringify(key)};\n`);

      // Walk the AST for top-level CallExpressions whose callee is the
      // identifier `defineLoader` and which have exactly one argument.
      // Rewrite to `defineLoader(<arg>, { __moduleKey: '<key>' })`.
      let ast;
      try {
        ast = parse(code, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
          errorRecovery: true,
        });
      } catch {
        // If the file fails to parse we still emit the prepended
        // __moduleKey so the routing layer works even if loader threading
        // doesn't. Surface the parse error to Vite so the user sees it.
        return { code: s.toString(), map: s.generateMap({ hires: true }) };
      }

      const visitCall = (node: CallExpression) => {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'defineLoader' ||
          node.arguments.length !== 1
        ) {
          return;
        }
        const arg = node.arguments[0];
        if (arg.type === 'StringLiteral') return; // legacy (name, fn) form
        const insertAt = arg.end;
        if (insertAt == null) return;
        s.appendRight(
          insertAt,
          `, { __moduleKey: ${JSON.stringify(key)} }`
        );
      };

      // Top-level statement walk. defineLoader is overwhelmingly used at
      // module scope; we don't recurse into nested function bodies to keep
      // the plugin cheap.
      for (const stmt of ast.program.body) {
        if (
          stmt.type === 'ExportNamedDeclaration' &&
          stmt.declaration?.type === 'VariableDeclaration'
        ) {
          for (const decl of stmt.declaration.declarations) {
            if (decl.init?.type === 'CallExpression') visitCall(decl.init);
          }
        } else if (
          stmt.type === 'VariableDeclaration'
        ) {
          for (const decl of stmt.declarations) {
            if (decl.init?.type === 'CallExpression') visitCall(decl.init);
          }
        }
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/module-key-plugin.test.ts`

Expected: PASS — five tests in this file.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/module-key-plugin.ts packages/vite/src/__tests__/module-key-plugin.test.ts
git commit -m "feat(vite): moduleKeyPlugin threads __moduleKey into defineLoader calls"
```

---

## Task 7: Register `moduleKeyPlugin` in the package's public surface

**Files:**
- Modify: `packages/vite/src/index.ts`
- Modify: `packages/vite/src/hono-preact.ts`

- [ ] **Step 1: Re-export the plugin**

Update `packages/vite/src/index.ts` in full:

```ts
export { honoPreact } from './hono-preact.js';
export { serverLoaderValidationPlugin } from './server-loader-validation.js';
export { serverOnlyPlugin } from './server-only.js';
export { moduleKeyPlugin } from './module-key-plugin.js';
```

- [ ] **Step 2: Wire `moduleKeyPlugin` into the meta-plugin's returned array**

Open `packages/vite/src/hono-preact.ts`. Add the import near the existing plugin imports:

```ts
import { moduleKeyPlugin } from './module-key-plugin.js';
```

Find the returned plugin array (currently lines ~21–102). Add `moduleKeyPlugin()` immediately before `serverOnlyPlugin()`:

```ts
    serverLoaderValidationPlugin(),
    moduleKeyPlugin(),
    serverOnlyPlugin(),
```

(Order rationale: `moduleKeyPlugin` injects `__moduleKey` into `.server.*` files; `serverOnlyPlugin` rewrites client-side imports of those same files. Both run with `enforce: 'pre'`, so Vite orders them by array position.)

- [ ] **Step 3: Build to confirm wiring**

Run: `pnpm --filter @hono-preact/vite build`

Expected: build succeeds; new types are emitted; `dist/index.d.ts` exports `moduleKeyPlugin`.

- [ ] **Step 4: Commit**

```bash
git add packages/vite/src/index.ts packages/vite/src/hono-preact.ts
git commit -m "feat(vite): wire moduleKeyPlugin into the public exports"
```

---

## Task 8: `serverOnlyPlugin` emits the path key in client-side `loader` stubs

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

The plugin currently extracts the loader name from the `.server.*` source via `extractLoaderName` and falls back to the basename. After this task, the plugin uses `deriveModuleKey(absPath, viteRoot)` instead.

- [ ] **Step 1: Refactor the existing tests + add new ones**

Open `packages/vite/src/__tests__/server-only-plugin.test.ts`. The transform now requires `viteRoot`, so every test that asserts on transform output needs `configResolved` called first. Refactor the `transform` helper to do this, then update the basename-asserting tests to assert path keys.

Replace the existing `transform` helper with:

```ts
function transform(
  code: string,
  id: string,
  options: { ssr?: boolean; root?: string } = {}
): { code: string; map: unknown } | undefined {
  const plugin = serverOnlyPlugin() as Plugin & {
    transform: TransformFn;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root: options.root ?? '/Users/me/repo' });
  const { ssr } = options;
  return plugin.transform.call({} as any, code, id, ssr ? { ssr } : {});
}
```

Then update the affected tests:

- "replaces a default *.server.* import with an RPC fetch stub" — change `id` to `/Users/me/repo/src/pages/movies.tsx` and assert path-key payloads:

```ts
  it('replaces a default *.server.* import with an RPC fetch stub keyed by module path', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(`fetch('/__loaders'`);
    expect(result?.code).toContain('"src/pages/movies"');
    expect(result?.code).toContain('location.path');
  });
```

- "stubs all .server imports when a file has more than one" — assert two distinct path keys derived from the resolved `.server.*` paths:

```ts
  it('stubs all .server imports when a file has more than one (each with its own path key)', () => {
    const code = [
      `import serverLoader from './movies.server.js';`,
      `import authLoader from './auth.server.js';`,
    ].join('\n');
    const result = transform(code, '/Users/me/repo/src/pages/page.tsx');
    expect(result?.code).toContain('"src/pages/movies"');
    expect(result?.code).toContain('"src/pages/auth"');
    expect(result?.code).not.toContain('async () => ({})');
  });
```

- Add a new test for the named `loader` stub's symbol shape:

```ts
  it('emits the path key in named `loader` stubs as Symbol.for(@hono-preact/loader:<key>)', () => {
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(
      `Symbol.for('@hono-preact/loader:src/pages/movies')`
    );
  });
```

Tests that don't assert on the basename (`leaves non-server imports untouched`, `returns undefined when ssr option is true`, `does not transform *.server.* files themselves`, `returns undefined when the code contains no .server reference`, the `serverGuards` test, the `viteRoot capture` test from Task 3) keep working unchanged once the helper provides a default root.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/vite/src/__tests__/server-only-plugin.test.ts`

Expected: FAIL — emitted code still contains `"movies"`, not `"src/pages/movies"`.

- [ ] **Step 3: Update the plugin to use `deriveModuleKey`**

Open `packages/vite/src/server-only.ts`. Add the import alongside the existing imports:

```ts
import { deriveModuleKey } from './module-key.js';
```

Inside the existing `transform` function, immediately before the per-import `for` loop (i.e. just before `for (const serverImport of [...serverImports].reverse()) {`), add a guard:

```ts
      if (viteRoot === undefined) return;
      const importerDir = path.dirname(id);
```

(`path` is already imported at the top of the file.)

For each `serverImport`, replace the single line:

```ts
const moduleName = moduleNameFromSource(serverImport.source.value);
```

with:

```ts
const absServerPath = path.resolve(importerDir, serverImport.source.value);
const moduleKey = deriveModuleKey(absServerPath, viteRoot);
```

Then update every subsequent usage in that block:

- The default-import branch's `loaderFetchArrow(moduleName, '')` → `loaderFetchArrow(moduleKey, '')`.
- The `serverActions` Proxy branch's `__module: ${JSON.stringify(moduleName)}` → `__module: ${JSON.stringify(moduleKey)}`.
- The `loader` named-import branch — replace the existing AST-extracted loader-name path with the path key:
  ```ts
  } else if (
    specifier.type === 'ImportSpecifier' &&
    specifier.imported.type === 'Identifier' &&
    specifier.imported.name === 'loader'
  ) {
    stubs.push(
      `const ${specifier.local.name} = {\n` +
      `  __id: Symbol.for('@hono-preact/loader:${moduleKey}'),\n` +
      `  fn: ${loaderFetchArrow(moduleKey, '  ')},\n` +
      `};`
    );
  }
  ```
- The `cache` named-import branch — change the fallback fed into `extractCacheName` from `moduleName` to `moduleKey`:
  ```ts
  const cacheName = extractCacheName(id, serverImport.source.value, moduleKey);
  ```

After these edits, two helpers are no longer referenced anywhere: `moduleNameFromSource` and `extractLoaderName`. Delete both. Keep `extractStringArgFromVarDecl`, `readSource`, and `extractCacheName` — the cache-name extraction path still relies on them, since `createCache('foo')` is consumer-typed and not replaced by path-keying.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/server-only-plugin.test.ts`

Expected: PASS — both new tests + all unmodified tests.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(vite): serverOnlyPlugin emits path-keyed RPC stubs"
```

---

## Task 9: Update the `serverActions` Proxy assertions

**Files:**
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

The existing test at line ~74 (`'replaces serverActions named import with a Proxy stub using module name from filename'`) asserts `__module: "movies"`. After Task 8, this becomes `__module: "src/pages/movies"`. Update.

- [ ] **Step 1: Update the test**

Use the centralized `transform` helper introduced in Task 8 step 1. Replace the test body:

```ts
  it('replaces serverActions named import with a Proxy stub keyed by module path', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "src/pages/movies"');
    expect(result?.code).toContain('__action: String(action)');
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/server-only-plugin.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "test(vite): assert path-keyed __module in Proxy stub"
```

---

## Task 10: `loadersHandler` reads `mod.__moduleKey`

**Files:**
- Modify: `packages/server/src/loaders-handler.ts`
- Modify: `packages/server/src/__tests__/loaders-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/server/src/__tests__/loaders-handler.test.ts`. Add (or replace) a test that supplies a glob entry with `__moduleKey` and verifies the handler routes by it.

```ts
describe('loadersHandler path-keyed routing', () => {
  it('routes lookups by mod.__moduleKey rather than filename', async () => {
    const glob = {
      // Filename and __moduleKey deliberately disagree to prove the
      // handler trusts the export, not the path.
      '/whatever.server.ts': {
        __moduleKey: 'src/pages/movies',
        default: async () => ({ id: 1 }),
      },
    };
    const handler = loadersHandler(glob);
    const req = new Request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'src/pages/movies',
        location: { path: '/movies', pathParams: {}, searchParams: {} },
      }),
    });
    const ctx = { req: { json: () => req.json() } } as any;
    const res = await handler(ctx, async () => undefined as any);
    expect(res?.status).toBe(200);
    const body = await (res as Response).json();
    expect(body).toEqual({ id: 1 });
  });

  it('returns 404 when the requested module key does not match any export', async () => {
    const glob = {
      '/x.server.ts': { __moduleKey: 'a', default: async () => ({}) },
    };
    const handler = loadersHandler(glob);
    const req = new Request('http://localhost/__loaders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'b',
        location: { path: '/', pathParams: {}, searchParams: {} },
      }),
    });
    const ctx = { req: { json: () => req.json() } } as any;
    const res = await handler(ctx, async () => undefined as any);
    expect(res?.status).toBe(404);
  });
});
```

(Adapt the `ctx` shape to match how the existing `loaders-handler.test.ts` mocks Hono's middleware context. The pattern is `(c) => Response`; copy from the existing tests in that file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/server/src/__tests__/loaders-handler.test.ts`

Expected: FAIL — handler still keys by filename basename, returns 404.

- [ ] **Step 3: Implement path-keyed lookup**

Replace `packages/server/src/loaders-handler.ts` in full:

```ts
import type { MiddlewareHandler } from 'hono';
import { runRequestScope } from '@hono-preact/iso';

type GlobModule = {
  default?: unknown;
  __moduleKey?: unknown;
  [key: string]: unknown;
};
type LazyGlob = Record<string, () => Promise<unknown>>;
type EagerGlob = Record<string, GlobModule>;

type SerializedLocation = {
  path: string;
  pathParams: Record<string, string>;
  searchParams: Record<string, string>;
};

type LoaderFn = (props: { location: SerializedLocation }) => Promise<unknown>;

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, LoaderFn>> {
  const result: Record<string, LoaderFn> = {};
  for (const [, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    const key = mod.__moduleKey;
    if (typeof key === 'string' && typeof mod.default === 'function') {
      result[key] = mod.default as LoaderFn;
    }
  }
  return result;
}

export function loadersHandler(glob: LazyGlob | EagerGlob): MiddlewareHandler {
  let loadersMapPromise: Promise<Record<string, LoaderFn>> | null = null;

  return async (c) => {
    if (!loadersMapPromise) {
      loadersMapPromise = buildLoadersMap(glob).catch((err) => {
        loadersMapPromise = null;
        return Promise.reject(err);
      });
    }

    let loadersMap: Record<string, LoaderFn>;
    try {
      loadersMap = await loadersMapPromise;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to load loaders: ${message}` }, 503);
    }

    let body: { module: unknown; location: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { module, location } = body;
    if (typeof module !== 'string') {
      return c.json(
        { error: 'Request body must include string field: module' },
        400
      );
    }

    const loader = loadersMap[module];
    if (!loader) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    try {
      const result = await runRequestScope(() =>
        loader({ location: location as SerializedLocation })
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/server/src/__tests__/loaders-handler.test.ts`

Expected: PASS — new path-keyed tests pass; any existing tests that relied on basename keying need their fixtures updated to include `__moduleKey`. Update them in this step (mechanical: add `__moduleKey: 'matching-key'` to each fixture's module object).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/loaders-handler.ts packages/server/src/__tests__/loaders-handler.test.ts
git commit -m "feat(server): loadersHandler routes by mod.__moduleKey"
```

---

## Task 11: `actionsHandler` reads `mod.__moduleKey`

**Files:**
- Modify: `packages/server/src/actions-handler.ts`
- Modify: `packages/server/src/__tests__/actions-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/__tests__/actions-handler.test.ts`:

```ts
describe('actionsHandler path-keyed routing', () => {
  it('routes lookups by mod.__moduleKey rather than filename', async () => {
    const glob = {
      '/whatever.server.ts': {
        __moduleKey: 'src/pages/movies',
        serverActions: {
          toggleWatched: async (_c: unknown, p: { id: number }) => ({
            ok: true,
            id: p.id,
          }),
        },
      },
    };
    const handler = actionsHandler(glob);
    const req = new Request('http://localhost/__actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'src/pages/movies',
        action: 'toggleWatched',
        payload: { id: 7 },
      }),
    });
    const ctx = {
      req: {
        json: () => req.json(),
        header: (h: string) => req.headers.get(h) ?? undefined,
      },
      json: (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status }),
    } as any;
    const res = await handler(ctx, async () => undefined as any);
    expect(res?.status).toBe(200);
    const body = await (res as Response).json();
    expect(body).toEqual({ ok: true, id: 7 });
  });
});
```

(Match the exact `ctx` mock pattern used in the existing `actions-handler.test.ts`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test packages/server/src/__tests__/actions-handler.test.ts`

Expected: FAIL — current handler keys by basename.

- [ ] **Step 3: Implement path-keyed lookup**

Open `packages/server/src/actions-handler.ts`. Replace the `buildActionsMap` function and remove `moduleNameFromPath`:

```ts
type GlobModule = {
  serverActions?: Record<string, unknown>;
  actionGuards?: ActionGuardFn[];
  __moduleKey?: unknown;
  [key: string]: unknown;
};

async function buildActionsMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, ModuleEntry>> {
  const result: Record<string, ModuleEntry> = {};
  for (const [, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    const key = mod.__moduleKey;
    if (typeof key === 'string' && mod.serverActions) {
      result[key] = {
        actions: mod.serverActions as Record<string, unknown>,
        guards: (mod.actionGuards as ActionGuardFn[] | undefined) ?? [],
      };
    }
  }
  return result;
}
```

Delete the now-unused `moduleNameFromPath` declaration.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test packages/server/src/__tests__/actions-handler.test.ts`

Expected: PASS — new test plus all existing tests after their fixtures are updated to include `__moduleKey` (mechanical sweep, same as Task 10 step 4).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/actions-handler.ts packages/server/src/__tests__/actions-handler.test.ts
git commit -m "feat(server): actionsHandler routes by mod.__moduleKey"
```

---

## Task 12: Migrate `apps/app/src/pages/movies.server.ts`

**Files:**
- Modify: `apps/app/src/pages/movies.server.ts`

- [ ] **Step 1: Drop the string argument**

Edit `apps/app/src/pages/movies.server.ts`. Change:

```ts
export const loader = defineLoader<{ movies: MoviesData; watchedIds: number[] }>('movies', serverLoader);
```

to:

```ts
export const loader = defineLoader<{ movies: MoviesData; watchedIds: number[] }>(serverLoader);
```

- [ ] **Step 2: Run the app's tests to confirm no regression**

Run: `pnpm test`

Expected: PASS — all suites green.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/movies.server.ts
git commit -m "refactor(app): drop defineLoader string arg in movies.server"
```

---

## Task 13: Migrate `apps/app/src/pages/watched.server.ts`

**Files:**
- Modify: `apps/app/src/pages/watched.server.ts`

- [ ] **Step 1: Drop the string argument**

Change:

```ts
export const loader = defineLoader<{ entries: Entry[] }>('watched', serverLoader);
```

to:

```ts
export const loader = defineLoader<{ entries: Entry[] }>(serverLoader);
```

- [ ] **Step 2: Run the app's tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/watched.server.ts
git commit -m "refactor(app): drop defineLoader string arg in watched.server"
```

---

## Task 14: Migrate `apps/app/src/pages/movie.server.ts`

**Files:**
- Modify: `apps/app/src/pages/movie.server.ts`

- [ ] **Step 1: Drop the string argument**

Change:

```ts
export const loader = defineLoader<{ movie: Movie | null; watched: WatchedRecord | null }>('movie', serverLoader);
```

to:

```ts
export const loader = defineLoader<{ movie: Movie | null; watched: WatchedRecord | null }>(serverLoader);
```

- [ ] **Step 2: Run the app's tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/movie.server.ts
git commit -m "refactor(app): drop defineLoader string arg in movie.server"
```

---

## Task 15: End-to-end SSR + RPC parity test

**Files:**
- Create: `packages/vite/src/__tests__/path-key-parity.test.ts`

This test loads a fixture `.server.ts` file through both plugins (mimicking dev) and asserts that the server-side `__moduleKey` and the client-side stub both produce the same `Symbol.for('@hono-preact/loader:<key>')` payload, for the same root.

- [ ] **Step 1: Write the failing test**

Create `packages/vite/src/__tests__/path-key-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import { serverOnlyPlugin } from '../server-only.js';
import type { Plugin } from 'vite';

const ROOT = '/Users/me/repo';

function makePlugins() {
  const m = moduleKeyPlugin() as Plugin & {
    configResolved?: (c: { root: string }) => void;
    transform: (code: string, id: string) => { code: string } | undefined;
  };
  const s = serverOnlyPlugin() as Plugin & {
    configResolved?: (c: { root: string }) => void;
    transform: (
      code: string,
      id: string,
      options?: { ssr?: boolean }
    ) => { code: string } | undefined;
  };
  m.configResolved?.({ root: ROOT });
  s.configResolved?.({ root: ROOT });
  return { m, s };
}

describe('path-key parity across moduleKeyPlugin and serverOnlyPlugin', () => {
  it('uses the same key for the .server.* file and its client-side import', () => {
    const { m, s } = makePlugins();

    // Server side: moduleKeyPlugin transforms the .server.ts file.
    const serverCode = [
      `import { defineLoader } from '@hono-preact/iso';`,
      `export default async () => ({});`,
      `export const loader = defineLoader(async () => ({}));`,
    ].join('\n');
    const serverResult = m.transform.call(
      {} as any,
      serverCode,
      `${ROOT}/src/pages/movies.server.ts`
    );
    expect(serverResult?.code).toMatch(
      /^export const __moduleKey = "src\/pages\/movies";/
    );

    // Client side: serverOnlyPlugin transforms a consumer that imports
    // the same file.
    const clientCode = `import { loader } from './movies.server.js';`;
    const clientResult = s.transform.call(
      {} as any,
      clientCode,
      `${ROOT}/src/pages/movies.tsx`
    );
    expect(clientResult?.code).toContain(
      `Symbol.for('@hono-preact/loader:src/pages/movies')`
    );
  });

  it('derives distinct keys for cross-folder same-basename collisions', () => {
    const { m } = makePlugins();
    const aResult = m.transform.call(
      {} as any,
      `export default async () => ({});`,
      `${ROOT}/src/pages/movies.server.ts`
    );
    const bResult = m.transform.call(
      {} as any,
      `export default async () => ({});`,
      `${ROOT}/src/pages/admin/movies.server.ts`
    );
    expect(aResult?.code).toContain('"src/pages/movies"');
    expect(bResult?.code).toContain('"src/pages/admin/movies"');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm test packages/vite/src/__tests__/path-key-parity.test.ts`

Expected: PASS — both plugins should already produce the matching keys after Tasks 5 and 8.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/__tests__/path-key-parity.test.ts
git commit -m "test(vite): assert path-key parity across plugin pair"
```

---

## Task 16: Manually verify the running app

**Files:** none.

This step exercises the change in a real browser to catch anything the unit tests miss (typically `viteRoot` resolution drift in dev mode and `import.meta.glob` key mismatches in SSR).

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

Expected: dev server boots with no errors. Open `http://localhost:<port>` in a browser.

- [ ] **Step 2: Exercise loaders**

Navigate `/` → `/movies` → `/movies/1` → `/watched` → back. Each page should render with data.

- [ ] **Step 3: Exercise actions**

On `/movies`, click "Mark watched" on a row. The optimistic flip should commit. On `/watched`, click "Bulk-import next 20" — the streaming progress should advance.

- [ ] **Step 4: Inspect network payloads**

Open the Network tab. Confirm:
- POST `/__loaders` payloads contain `"module":"<path>/<file>"` (e.g. `"module":"src/pages/movies"`), not `"module":"movies"`.
- POST `/__actions` payloads contain `"module":"<path>/<file>"`.
- Both succeed with 200.

- [ ] **Step 5: Build and preview**

Run: `pnpm build && pnpm preview`

Expected: build succeeds; preview boots; same flows pass against the production bundle. (This catches `viteRoot` resolving differently in build vs. dev.)

- [ ] **Step 6: Commit (no diff expected)**

If the manual verification surfaces a regression, fix it now and add a new task for the missing test coverage. If everything passes, no commit.

---

## Task 17: Drop the legacy `(name, fn)` form from `defineLoader`'s public type

**Files:**
- Modify: `packages/iso/src/define-loader.ts`
- Modify: `packages/iso/src/__tests__/define-loader.test.ts`

After all consumers migrate (Tasks 12–14), the legacy overload has no remaining callers. Remove it from the public surface; keep only the `(fn)` and `(fn, opts)` forms.

- [ ] **Step 1: Update tests**

Open `packages/iso/src/__tests__/define-loader.test.ts`. Delete the four legacy tests (`'throws when called without a name argument'`, `'throws when name is an empty string'`, `'keys __id with Symbol.for so two calls with the same name share identity'`, `'produces distinct __id for distinct names'`, `'aligns with the SSR stub symbol shape'`). The path-keyed tests added in Task 2 cover the equivalent behavior.

- [ ] **Step 2: Drop the legacy overload**

Replace `packages/iso/src/define-loader.ts` in full:

```ts
import type { RouteHook } from 'preact-iso';
import type { LoaderCache } from './cache.js';

export type LoaderCtx = { location: RouteHook };

export type Loader<T> = (ctx: LoaderCtx) => Promise<T>;

export interface LoaderRef<T> {
  readonly __id: symbol;
  readonly fn: Loader<T>;
  readonly cache?: LoaderCache<T>;
}

export type DefineLoaderOpts<T> = {
  __moduleKey: string;
  cache?: LoaderCache<T>;
};

/**
 * Define a server loader.
 *
 * Authored as `defineLoader(fn)` in `.server.*` files. The `moduleKeyPlugin`
 * Vite plugin rewrites the call at build time to thread the path-derived
 * module key in: `defineLoader(fn, { __moduleKey: 'src/pages/movies' })`.
 *
 * The `__moduleKey` is the routing key for `__loaders`/`__actions` RPC
 * and the payload of `Symbol.for(...)` for `__id`. Two loaders defined in
 * different files produce distinct `__id` symbols by construction.
 *
 * The optional `cache` slot binds a `LoaderCache` to the loader so
 * consumers needn't pass it separately to `<Page>`.
 */
export function defineLoader<T>(fn: Loader<T>): LoaderRef<T>;
export function defineLoader<T>(
  fn: Loader<T>,
  opts: DefineLoaderOpts<T>
): LoaderRef<T>;
export function defineLoader<T>(
  fn: Loader<T>,
  opts?: DefineLoaderOpts<T>
): LoaderRef<T> {
  if (opts?.__moduleKey) {
    return {
      __id: Symbol.for(`@hono-preact/loader:${opts.__moduleKey}`),
      fn,
      cache: opts.cache,
    };
  }
  // Plugin-less context (a consumer testing their loader in isolation).
  // Identity is unstable across module reloads, which is acceptable for
  // tests that don't depend on cache-by-id behavior.
  return {
    __id: Symbol(`@hono-preact/loader:<unkeyed>`),
    fn,
  };
}
```

- [ ] **Step 3: Run all tests**

Run: `pnpm test`

Expected: PASS — all suites green; legacy tests are gone.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/define-loader.ts packages/iso/src/__tests__/define-loader.test.ts
git commit -m "refactor(iso): drop the legacy defineLoader (name, fn) form"
```

---

## Task 18: Final integration sweep

**Files:** none.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: PASS — every suite green.

- [ ] **Step 2: Build every package**

Run: `pnpm build`

Expected: each package builds cleanly. No type errors.

- [ ] **Step 3: Run the dev + preview verification once more**

Repeat Task 16 steps 1–5. Confirm the end-to-end app still works.

- [ ] **Step 4: Push for review**

The plan's work is done. Open a PR with the commit list from Tasks 1–17 and link the research doc:

```
git push -u origin <branch>
gh pr create --title "feat: path-keyed module identity for loader/action RPC" \
  --body "$(cat <<'EOF'
## Summary

- Replaces basename-as-routing-key with a path-derived module key
  embedded into each .server.* file by a new Vite plugin.
- defineLoader's string-name argument is removed; the plugin supplies
  the key via a hidden second-arg metadata.
- loadersHandler and actionsHandler route by mod.__moduleKey.
- Eliminates the implicit "no two .server.* files may share a basename"
  constraint by construction.

## Test plan

- [ ] All package test suites pass
- [ ] pnpm build succeeds across the monorepo
- [ ] Dev mode: /, /movies, /movies/:id, /watched all render with data
- [ ] Dev mode: toggleWatched action works (network payload uses path key)
- [ ] Dev mode: bulkImport action streams progress
- [ ] Production preview: same flows pass against the production bundle

Implements: docs/superpowers/research/2026-05-04-framework-simplification.md §4.3, §6.3, §9 step 1
EOF
)"
```

---

## Risks called out in the research doc

(Reproduced for the executor's awareness; mitigations are baked into the tasks above.)

1. **`viteRoot` resolution drift across dev / build / SSR / test.** Mitigated by capturing `viteRoot` once via `configResolved` (Tasks 3, 4) and reusing the captured value. Task 16 step 5 exercises both dev and production builds; Task 15 covers test-environment parity.
2. **Plugin parse failures on `.server.*` files with syntax errors.** The `moduleKeyPlugin` falls back to emitting only the `__moduleKey` export when the AST parse fails (Task 6 step 3 implementation). The user sees the parse error from Vite's normal error path; the routing layer keeps working.
3. **Glob entries without `__moduleKey`.** After Task 10/11, `loadersHandler` and `actionsHandler` simply skip such entries (won't register them in the lookup map). In practice, every `.server.*` file in the watched glob is transformed by `moduleKeyPlugin`, so this is never observed in production. Defensive only.

## What this plan does NOT cover

- The surface trim (Plan B). Stages 2–6 of the research doc's §9 — `definePage` self-wrapping, deleting custom `Route`/`Router`/`lazy`, moving route-level props into `PageBindings`, the `internal.ts` extraction, dropping `PAGE_BINDINGS`/`wrapWithPage` — ship as a separate plan.
- The deferred direction-#4 work: `useId`-keyed SSR hydration, monolithic `<Page>` internals, streaming SSR, Worker prefetch.
