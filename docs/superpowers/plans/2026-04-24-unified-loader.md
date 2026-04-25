# Unified Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate `clientLoader` by replacing the dead Vite stub with an RPC fetch to a new `/__loaders` server endpoint, so a single `serverLoader` in `.server.ts` handles SSR, hydration, and navigation.

**Architecture:** The Vite `serverOnlyPlugin` replaces the default export stub with a typed fetch function targeting `POST /__loaders`. A new `loadersHandler` middleware (mirroring `actionsHandler`) dispatches those requests to the real `serverLoader`. `page.tsx` removes the `clientLoader` prop and always calls `serverLoader`, which in the browser build is the RPC stub.

**Tech Stack:** Hono, Vite (MagicString + Babel parser), Preact, Vitest

---

## File Map

| File | Change |
|------|--------|
| `packages/server/src/loaders-handler.ts` | Create — new middleware |
| `packages/server/src/__tests__/loaders-handler.test.ts` | Create — tests for new middleware |
| `packages/server/src/index.ts` | Modify — export `loadersHandler` |
| `packages/vite/src/server-only.ts` | Modify — default export stub → RPC fetch |
| `packages/vite/src/__tests__/server-only-plugin.test.ts` | Modify — update default stub tests |
| `packages/iso/src/loader.tsx` | Modify — remove `clientLoader` from `LoaderProps` |
| `packages/iso/src/page.tsx` | Modify — remove `clientLoader`, simplify loader call |
| `packages/iso/src/__tests__/loader.test.tsx` | Modify — rename `clientLoader` → `serverLoader`, remove `cache.wrap` |
| `packages/iso/src/__tests__/page.test.tsx` | Modify — rename `clientLoader` → `serverLoader` |

---

### Task 1: `loadersHandler` — tests

**Files:**
- Create: `packages/server/src/__tests__/loaders-handler.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { loadersHandler } from '../loaders-handler.js';

function makeApp(glob: Parameters<typeof loadersHandler>[0]) {
  const app = new Hono();
  app.post('/__loaders', loadersHandler(glob));
  return app;
}

function post(app: Hono, body: unknown) {
  return app.request('http://localhost/__loaders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const loc = { path: '/movies', pathParams: {}, query: {} };

describe('loadersHandler', () => {
  it('calls the matching serverLoader with the location and returns JSON', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ movies: [] });
    const app = makeApp({
      './pages/movies.server.ts': { default: loaderFn },
    });

    const res = await post(app, { module: 'movies', location: loc });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ movies: [] });
    expect(loaderFn).toHaveBeenCalledWith({ location: loc });
  });

  it('returns 404 when the module is not found', async () => {
    const res = await post(makeApp({}), { module: 'missing', location: loc });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain("Module 'missing' not found");
  });

  it('returns 404 when the module has no default export', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { serverActions: { create: vi.fn() } },
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the loader throws', async () => {
    const app = makeApp({
      './pages/movies.server.ts': {
        default: async () => { throw new Error('DB error'); },
      },
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(500);
    expect((await res.json() as { error: string }).error).toBe('DB error');
  });

  it('resolves lazy glob modules before handling requests', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const lazyGlob = {
      './pages/movies.server.ts': () => Promise.resolve({ default: loaderFn }),
    };
    const app = makeApp(lazyGlob);

    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(200);
    expect(loaderFn).toHaveBeenCalled();
  });

  it('returns 400 when body is missing module field', async () => {
    const app = makeApp({
      './pages/movies.server.ts': { default: vi.fn() },
    });
    const res = await post(app, { location: loc });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('module');
  });

  it('returns 503 when a lazy module loader rejects', async () => {
    const app = makeApp({
      './pages/movies.server.ts': () => Promise.reject(new Error('load failed')),
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('load failed');
  });

  it('derives module name by stripping path and .server.* extension', async () => {
    const loaderFn = vi.fn().mockResolvedValue({ ok: true });
    const app = makeApp({
      './src/pages/movies.server.tsx': { default: loaderFn },
    });
    const res = await post(app, { module: 'movies', location: loc });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run packages/server/src/__tests__/loaders-handler.test.ts
```

Expected: FAIL — `Cannot find module '../loaders-handler.js'`

---

### Task 2: `loadersHandler` — implementation

**Files:**
- Create: `packages/server/src/loaders-handler.ts`

- [ ] **Step 1: Implement the middleware**

```ts
import type { MiddlewareHandler } from 'hono';
import type { RouteHook } from 'preact-iso';

type GlobModule = { default?: unknown; [key: string]: unknown };
type LazyGlob = Record<string, () => Promise<GlobModule>>;
type EagerGlob = Record<string, GlobModule>;

function moduleNameFromPath(filePath: string): string {
  return filePath
    .split('/')
    .pop()!
    .replace(/\.server\.[jt]sx?$/, '');
}

type LoaderFn = (props: { location: RouteHook }) => Promise<unknown>;

async function buildLoadersMap(
  glob: LazyGlob | EagerGlob
): Promise<Record<string, LoaderFn>> {
  const result: Record<string, LoaderFn> = {};
  for (const [filePath, moduleOrLoader] of Object.entries(glob)) {
    const mod =
      typeof moduleOrLoader === 'function'
        ? await (moduleOrLoader as () => Promise<GlobModule>)()
        : (moduleOrLoader as GlobModule);
    if (typeof mod.default === 'function') {
      result[moduleNameFromPath(filePath)] = mod.default as LoaderFn;
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
      return c.json({ error: 'Request body must include string field: module' }, 400);
    }

    const loader = loadersMap[module];
    if (!loader) {
      return c.json({ error: `Module '${module}' not found` }, 404);
    }

    try {
      const result = await loader({ location: location as RouteHook });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run packages/server/src/__tests__/loaders-handler.test.ts
```

Expected: all 8 tests PASS

- [ ] **Step 3: Export from server package index**

In `packages/server/src/index.ts`, add:

```ts
export { HonoContext, useHonoContext } from './context.js';
export { location } from './middleware/location.js';
export { renderPage } from './render.js';
export { actionsHandler } from './actions-handler.js';
export { loadersHandler } from './loaders-handler.js';
```

- [ ] **Step 4: Run all server tests**

```bash
npx vitest run packages/server/src/__tests__
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/loaders-handler.ts packages/server/src/__tests__/loaders-handler.test.ts packages/server/src/index.ts
git commit -m "feat(server): add loadersHandler middleware for unified loader RPC"
```

---

### Task 3: Update `serverOnlyPlugin` — tests first

**Files:**
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Update the default stub tests to expect the new fetch shape**

Replace the two tests that assert `async () => ({})` with assertions on the new RPC stub. Also add a test for module name derivation in the default stub. The full updated test file:

```ts
import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin } from '../index.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean }
) => { code: string; map: unknown } | undefined;

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean } = {}
): { code: string; map: unknown } | undefined {
  const plugin = serverOnlyPlugin() as Plugin & { transform: TransformFn };
  return plugin.transform.call({} as any, code, id, options);
}

describe('serverOnlyPlugin', () => {
  it('replaces a default *.server.* import with an RPC fetch stub', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('fetch(\'/__loaders\'');
    expect(result?.code).toContain('"movies"');
    expect(result?.code).toContain('location.path');
    expect(result?.code).toContain('location.pathParams');
    expect(result?.code).toContain('location.query');
    expect(result?.code).not.toContain('async () => ({})');
  });

  it('replaces serverGuards named import with an empty array stub', () => {
    const code = `import serverLoader, { serverGuards } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('fetch(\'/__loaders\'');
    expect(result?.code).toContain('const serverGuards = [];');
  });

  it('leaves non-server imports untouched (returns undefined)', () => {
    const code = `import { something } from './utils.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result).toBeUndefined();
  });

  it('returns undefined when ssr option is true', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, 'movies.tsx', { ssr: true });
    expect(result).toBeUndefined();
  });

  it('does not transform *.server.* files themselves', () => {
    const code = `export default async function serverLoader() { return {}; }`;
    const result = transform(code, 'movies.server.ts');
    expect(result).toBeUndefined();
  });

  it('returns undefined when the code contains no .server reference', () => {
    const code = `import { helper } from './utils.js';`;
    const result = transform(code, 'page.tsx');
    expect(result).toBeUndefined();
  });

  it('stubs all .server imports when a file has more than one', () => {
    const code = [
      `import serverLoader from './movies.server.js';`,
      `import authLoader from './auth.server.js';`,
    ].join('\n');
    const result = transform(code, '/src/pages/page.tsx');
    expect(result?.code).toContain('"movies"');
    expect(result?.code).toContain('"auth"');
    expect(result?.code).not.toContain('async () => ({})');
  });

  it('replaces serverActions named import with a Proxy stub using module name from filename', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "movies"');
    expect(result?.code).toContain('__action: String(action)');
  });

  it('handles serverActions alongside default import in the same statement', () => {
    const code = `import serverLoader, { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('fetch(\'/__loaders\'');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "movies"');
  });

  it('handles serverActions alongside serverGuards in the same statement', () => {
    const code = `import { serverGuards, serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverGuards = [];');
    expect(result?.code).toContain('const serverActions = new Proxy(');
  });

  it('derives module name from nested path correctly', () => {
    const code = `import { serverActions } from '../../pages/profile.server.ts';`;
    const result = transform(code, '/src/components/nav.tsx');
    expect(result?.code).toContain('__module: "profile"');
  });

  it('leaves serverActions import untouched in SSR builds', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx', { ssr: true });
    expect(result).toBeUndefined();
  });

  it('derives module name for default stub from the import source, not the consumer file', () => {
    const code = `import loader from './profile.server.ts';`;
    const result = transform(code, '/src/pages/some-other-page.tsx');
    expect(result?.code).toContain('"profile"');
    expect(result?.code).not.toContain('"some-other-page"');
  });
});
```

- [ ] **Step 2: Run tests to verify the updated tests fail**

```bash
npx vitest run packages/vite/src/__tests__/server-only-plugin.test.ts
```

Expected: FAIL — tests asserting `fetch('/__loaders'` fail because the stub still returns `async () => ({})`

---

### Task 4: Update `serverOnlyPlugin` — implementation

**Files:**
- Modify: `packages/vite/src/server-only.ts`

- [ ] **Step 1: Replace the default export stub with the RPC fetch stub**

The only change is inside the `specifier.type === 'ImportDefaultSpecifier'` branch. Replace:

```ts
stubs.push(`const ${specifier.local.name} = async () => ({});`);
```

With:

```ts
stubs.push(
  `const ${specifier.local.name} = async ({ location }) => {\n` +
  `  const res = await fetch('/__loaders', {\n` +
  `    method: 'POST',\n` +
  `    headers: { 'Content-Type': 'application/json' },\n` +
  `    body: JSON.stringify({ module: ${JSON.stringify(moduleName)}, location: { path: location.path, pathParams: location.pathParams, query: location.query } }),\n` +
  `  });\n` +
  `  if (!res.ok) {\n` +
  `    const body = await res.json();\n` +
  `    throw new Error(body.error ?? 'Loader failed with status ' + res.status);\n` +
  `  }\n` +
  `  return res.json();\n` +
  `};`
);
```

The full updated `serverOnlyPlugin` function (only the `ImportDefaultSpecifier` branch changes; everything else is identical to the current file):

```ts
import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

function moduleNameFromSource(importSource: string): string {
  return importSource
    .split('/')
    .pop()!
    .replace(/\.server(\.[jt]sx?)?$/, '');
}

export function serverOnlyPlugin(): Plugin {
  return {
    name: 'server-only',
    enforce: 'pre',
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return;
      if (!/\.[jt]sx?$/.test(id)) return;
      if (/\.server\.[jt]sx?$/.test(id)) return;
      if (!code.includes('.server')) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        errorRecovery: true,
      });

      const isServerImport = (node: unknown): node is ImportDeclaration =>
        (node as ImportDeclaration).type === 'ImportDeclaration' &&
        /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value) &&
        (node as ImportDeclaration).specifiers.some(
          (s) =>
            s.type === 'ImportDefaultSpecifier' ||
            (s.type === 'ImportSpecifier' &&
              s.imported.type === 'Identifier' &&
              (s.imported.name === 'serverGuards' ||
                s.imported.name === 'serverActions'))
        );

      const serverImports = ast.program.body.filter(isServerImport);
      if (serverImports.length === 0) return;

      const s = new MagicString(code);

      for (const serverImport of [...serverImports].reverse()) {
        const moduleName = moduleNameFromSource(serverImport.source.value);
        const stubs: string[] = [];

        for (const specifier of serverImport.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            stubs.push(
              `const ${specifier.local.name} = async ({ location }) => {\n` +
              `  const res = await fetch('/__loaders', {\n` +
              `    method: 'POST',\n` +
              `    headers: { 'Content-Type': 'application/json' },\n` +
              `    body: JSON.stringify({ module: ${JSON.stringify(moduleName)}, location: { path: location.path, pathParams: location.pathParams, query: location.query } }),\n` +
              `  });\n` +
              `  if (!res.ok) {\n` +
              `    const body = await res.json();\n` +
              `    throw new Error(body.error ?? 'Loader failed with status ' + res.status);\n` +
              `  }\n` +
              `  return res.json();\n` +
              `};`
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverGuards'
          ) {
            stubs.push(`const ${specifier.local.name} = [];`);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverActions'
          ) {
            stubs.push(
              `const ${specifier.local.name} = new Proxy({}, { get(_, action) { return { __module: ${JSON.stringify(moduleName)}, __action: String(action) }; } });`
            );
          }
        }

        if (stubs.length > 0) {
          s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
        }
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run packages/vite/src/__tests__/server-only-plugin.test.ts
```

Expected: all 13 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "feat(vite): replace serverLoader stub with RPC fetch stub for /__loaders"
```

---

### Task 5: Update iso package tests

**Files:**
- Modify: `packages/iso/src/__tests__/loader.test.tsx`
- Modify: `packages/iso/src/__tests__/page.test.tsx`

- [ ] **Step 1: Update `loader.test.tsx`**

Replace all `clientLoader` occurrences with `serverLoader` and remove `cache.wrap(...)` wrapping (the cache is now written by `page.tsx` after the loader resolves). Full updated file:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { getLoaderData, useReload, type LoaderData } from '../loader.js';
import { createCache } from '../cache.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({})),
  deletePreloadedData: vi.fn(),
}));

import * as preloadModule from '../preload.js';
import { JSX } from 'preact';

const loc = {
  path: '/test',
  url: 'http://localhost/test',
  query: {},
  params: {},
  pathParams: {},
} as any;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  vi.mocked(preloadModule.getPreloadedData).mockReturnValue(null);
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

function Child({ loaderData }: LoaderData<{ msg: string }>) {
  return <div data-testid="child">{loaderData.msg}</div>;
}
Child.defaultProps = { route: '/test' };

function wrap(el: JSX.Element) {
  return render(<LocationProvider>{el}</LocationProvider>);
}

describe('cache hit', () => {
  it('renders cached data without calling serverLoader', async () => {
    const cache = createCache<{ msg: string }>();
    cache.set({ msg: 'from cache' });
    const serverLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { serverLoader, cache });

    wrap(<Wrapped {...loc} />);

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('from cache');
    expect(serverLoader).not.toHaveBeenCalled();
  });
});

describe('preloaded data (hydration path)', () => {
  it('renders preloaded data without calling serverLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({
      msg: 'preloaded',
    } as any);
    const serverLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { serverLoader });

    wrap(<Wrapped {...loc} />);

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('preloaded');
    expect(serverLoader).not.toHaveBeenCalled();
  });
});

describe('cache miss (fetch path)', () => {
  it('calls serverLoader and shows fallback during load', async () => {
    const cache = createCache<{ msg: string }>();
    let resolve!: (v: { msg: string }) => void;
    const serverLoader = vi.fn(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    const Wrapped = getLoaderData(Child, {
      serverLoader,
      cache,
      fallback: <div data-testid="loading">Loading…</div>,
    });

    wrap(<Wrapped {...loc} />);

    await waitFor(() => expect(serverLoader).toHaveBeenCalled());
    expect(serverLoader).toHaveBeenCalledOnce();
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    await act(async () => {
      resolve({ msg: 'loaded' });
    });

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('loaded');
  });
});

describe('useReload', () => {
  it('reload() re-runs serverLoader and updates rendered content', async () => {
    let callCount = 0;
    const cache = createCache<{ msg: string }>();
    const serverLoader = vi.fn(() => {
      callCount++;
      return Promise.resolve({ msg: `call ${callCount}` });
    });

    function ReloadChild({ loaderData }: LoaderData<{ msg: string }>) {
      const { reload } = useReload();
      return (
        <div>
          <span data-testid="msg">{loaderData.msg}</span>
          <button onClick={reload}>reload</button>
        </div>
      );
    }
    ReloadChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(ReloadChild, { serverLoader, cache });
    wrap(<Wrapped {...loc} />);

    const msg = await screen.findByTestId('msg');
    expect(msg).toHaveTextContent('call 1');

    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('call 2');
    expect(serverLoader).toHaveBeenCalledTimes(2);
  });

  it('throws when called outside a getLoaderData component', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad() {
      useReload();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(
      'useReload must be called inside a component rendered by getLoaderData'
    );
    consoleSpy.mockRestore();
  });
});

describe('preloaded empty object (hydration edge case)', () => {
  it('renders preloaded empty object without calling serverLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({} as any);
    const serverLoader = vi.fn().mockResolvedValue({ msg: 'from server' });

    function EmptyChild({ loaderData }: LoaderData<Record<string, never>>) {
      return <div data-testid="empty">{JSON.stringify(loaderData)}</div>;
    }
    EmptyChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(EmptyChild, { serverLoader });
    wrap(<Wrapped {...loc} />);

    await waitFor(() => {}, { timeout: 50 }).catch(() => {});
    expect(serverLoader).not.toHaveBeenCalled();
  });
});

describe('useReload error handling', () => {
  it('exposes the error when serverLoader throws during reload', async () => {
    const cache = createCache<{ msg: string }>();
    const serverLoader = vi.fn()
      .mockResolvedValueOnce({ msg: 'initial' })
      .mockRejectedValueOnce(new Error('network failure'));

    function ErrorChild({ loaderData }: LoaderData<{ msg: string }>) {
      const { reload, error } = useReload();
      return (
        <div>
          <span data-testid="msg">{loaderData.msg}</span>
          <span data-testid="error">{error?.message ?? 'none'}</span>
          <button onClick={reload}>reload</button>
        </div>
      );
    }
    ErrorChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(ErrorChild, { serverLoader, cache });
    wrap(<Wrapped {...loc} />);

    await screen.findByText('initial');

    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('network failure');
    expect(screen.getByTestId('error')).toHaveTextContent('network failure');
    expect(screen.getByTestId('msg')).toHaveTextContent('initial');
  });
});
```

- [ ] **Step 2: Update `page.test.tsx`**

Replace `clientLoader: async () => ({})` with `serverLoader: async () => ({})` in all three guard tests. Full updated file:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { getLoaderData } from '../loader.js';
import { createGuard, GuardRedirect, runGuards } from '../guard.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

const mockRoute = vi.fn();
vi.mock('preact-iso', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: mockRoute }) };
});

import { LocationProvider } from 'preact-iso';

const loc = {
  path: '/test',
  url: 'http://localhost/test',
  query: {},
  params: {},
  pathParams: {},
} as any;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  mockRoute.mockClear();
});
afterEach(() => {
  env.current = originalEnv;
});

describe('guard { render }', () => {
  it('renders the guard-supplied component instead of the page', async () => {
    const ForbiddenPage = () => (
      <div data-testid="forbidden">403 Forbidden</div>
    );
    const guard = createGuard(async (_ctx, _next) => ({
      render: ForbiddenPage,
    }));

    function PageChild() {
      return <div data-testid="page">Protected content</div>;
    }
    PageChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(PageChild, {
      clientGuards: [guard],
      serverLoader: async () => ({}),
    });

    render(
      <LocationProvider>
        <Wrapped {...loc} />
      </LocationProvider>
    );

    const el = await screen.findByTestId('forbidden');
    expect(el).toHaveTextContent('403 Forbidden');
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } in browser', () => {
  it('calls route() with the redirect path when a client guard redirects', async () => {
    const guard = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));

    function PageChild() {
      return <div data-testid="page">Protected</div>;
    }
    PageChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(PageChild, {
      clientGuards: [guard],
      serverLoader: async () => ({}),
    });

    render(
      <LocationProvider>
        <Wrapped {...loc} />
      </LocationProvider>
    );

    await waitFor(() => expect(mockRoute).toHaveBeenCalled());
    expect(mockRoute).toHaveBeenCalledWith('/login');
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } on server', () => {
  it('throws GuardRedirect when a server guard redirects', async () => {
    const guard = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));
    const result = await runGuards([guard], { location: loc });
    expect(result).toHaveProperty('redirect', '/login');
    expect(() => {
      if (result && 'redirect' in result)
        throw new GuardRedirect(result.redirect);
    }).toThrow(GuardRedirect);
  });
});

describe('guard re-runs on navigation', () => {
  it('re-evaluates clientGuards when the path changes', async () => {
    let currentPath = '/public';
    const guard = createGuard(async (_ctx, _next) => {
      if (currentPath === '/admin') return { redirect: '/login' };
    });

    function PageChild() {
      return <div data-testid="page">Content</div>;
    }
    PageChild.defaultProps = { route: '/public' };

    const Wrapped = getLoaderData(PageChild, {
      clientGuards: [guard],
      serverLoader: async () => ({}),
    });

    const locPublic = { ...loc, path: '/public' } as any;
    const { rerender } = render(
      <LocationProvider>
        <Wrapped {...locPublic} />
      </LocationProvider>
    );

    await screen.findByTestId('page');

    currentPath = '/admin';
    const locAdmin = { ...loc, path: '/admin' } as any;
    rerender(
      <LocationProvider>
        <Wrapped {...locAdmin} />
      </LocationProvider>
    );

    await waitFor(() => expect(mockRoute).toHaveBeenCalledWith('/login'));
  });
});
```

- [ ] **Step 3: Run iso tests to verify the ones that test loader behavior fail**

```bash
npx vitest run packages/iso/src/__tests__/loader.test.tsx packages/iso/src/__tests__/page.test.tsx
```

Expected: The "calls serverLoader and shows fallback during load" and "reload() re-runs serverLoader" tests FAIL because `page.tsx` still calls `clientLoader` internally (which defaults to `serverLoader`, so they may actually still pass). If all pass, that's fine — the TypeScript errors will appear when we remove `clientLoader` from the type in the next task.

---

### Task 6: Remove `clientLoader` from `loader.tsx` and `page.tsx`

**Files:**
- Modify: `packages/iso/src/loader.tsx`
- Modify: `packages/iso/src/page.tsx`

- [ ] **Step 1: Update `loader.tsx`**

Remove `clientLoader` from `LoaderProps` and the destructuring in `getLoaderData`. Full updated file:

```tsx
import { type FunctionComponent, type JSX } from 'preact';
import { RouteHook } from 'preact-iso';
import { memo } from 'preact/compat';
import { type GuardFn } from './guard.js';
import { LoaderCache } from './cache.js';
import { Page, WrapperProps } from './page.js';

export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData: T;
  route?: string;
}

export type Loader<T> = (props: { location: RouteHook }) => Promise<T>;

interface LoaderProps<T> {
  serverLoader?: Loader<T>;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  Wrapper?: FunctionComponent<WrapperProps>;
}

export const getLoaderData = <T extends Record<string, unknown>>(
  Component: FunctionComponent<LoaderData<T>>,
  {
    serverLoader,
    cache,
    serverGuards,
    clientGuards,
    fallback,
    Wrapper,
  }: LoaderProps<T> = {}
) => {
  return memo((location: RouteHook) => {
    return (
      <Page
        Child={Component}
        serverLoader={serverLoader}
        location={location}
        cache={cache}
        serverGuards={serverGuards}
        clientGuards={clientGuards}
        fallback={fallback}
        Wrapper={Wrapper}
      />
    );
  });
};

export { useReload } from './page.js';
```

- [ ] **Step 2: Update `page.tsx`**

Remove `clientLoader` from `PageProps`, `GuardedPageProps`, and the `GuardedPage` implementation. Simplify the loader call and rename `clientLoaderRef` to `serverLoaderRef`. Full updated file:

```tsx
import {
  createContext,
  type ComponentChildren,
  type ComponentType,
  type FunctionComponent,
  type JSX,
} from 'preact';
import { RouteHook, useLocation } from 'preact-iso';
import { memo, Suspense } from 'preact/compat';
import { useCallback, useContext, useId, useRef, useState } from 'preact/hooks';
import { type LoaderCache } from './cache';
import { type GuardFn, GuardRedirect, runGuards } from './guard.js';
import { isBrowser } from './is-browser';
import { Loader, LoaderData } from './loader';
import { getPreloadedData } from './preload';
import wrapPromise from './wrap-promise';

type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
  error: Error | null;
};

export const ReloadContext = createContext<ReloadContextValue | undefined>(undefined);

export function useReload(): ReloadContextValue {
  const ctx = useContext(ReloadContext);
  if (!ctx)
    throw new Error(
      'useReload must be called inside a component rendered by getLoaderData'
    );
  return ctx;
}

export type WrapperProps = {
  id: string;
  'data-loader': string;
  children: ComponentChildren;
};

const DefaultWrapper: FunctionComponent<WrapperProps> = (props) => (
  <section {...props} />
);

type PageProps<T> = {
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  serverGuards?: GuardFn[];
  clientGuards?: GuardFn[];
  fallback?: JSX.Element;
  Wrapper?: ComponentType<WrapperProps>;
};

export const Page = memo(function <T extends Record<string, unknown>>({
  Child,
  serverLoader,
  location,
  cache,
  serverGuards = [],
  clientGuards = [],
  fallback,
  Wrapper,
}: PageProps<T>) {
  const id = useId();
  const guards = isBrowser() ? clientGuards : serverGuards;
  const prevGuardPath = useRef(location.path);
  const guardRef = useRef(wrapPromise(runGuards(guards, { location })));

  if (prevGuardPath.current !== location.path) {
    prevGuardPath.current = location.path;
    guardRef.current = wrapPromise(runGuards(guards, { location }));
  }

  return (
    <Suspense fallback={fallback}>
      <GuardedPage
        id={id}
        Child={Child}
        serverLoader={serverLoader}
        location={location}
        cache={cache}
        guardRef={guardRef}
        fallback={fallback}
        Wrapper={Wrapper}
      />
    </Suspense>
  );
});

type GuardedPageProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  serverLoader?: Loader<T>;
  location: RouteHook;
  cache?: LoaderCache<T>;
  guardRef: { current: { read: () => import('./guard.js').GuardResult } };
  fallback?: JSX.Element;
  Wrapper?: ComponentType<WrapperProps>;
};

const GuardedPage = memo(function <T extends Record<string, unknown>>({
  id,
  Child,
  serverLoader = async () => ({}) as T,
  location,
  cache,
  guardRef,
  fallback,
  Wrapper,
}: GuardedPageProps<T>) {
  const { route } = useLocation();
  const [reloading, setReloading] = useState(false);
  const [overrideData, setOverrideData] = useState<T | undefined>(undefined);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const prevPath = useRef(location.path);
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    setOverrideData(undefined);
  }

  const serverLoaderRef = useRef(serverLoader);
  serverLoaderRef.current = serverLoader;
  const locationRef = useRef(location);
  locationRef.current = location;

  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    setLoadError(null);
    serverLoaderRef.current({ location: locationRef.current })
      .then((result) => {
        setOverrideData(result);
        setReloading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
        setReloading(false);
      });
  }, [reloading]);

  const guardResult = guardRef.current.read();

  if (guardResult && 'redirect' in guardResult) {
    if (isBrowser()) {
      route(guardResult.redirect);
      return null;
    } else {
      throw new GuardRedirect(guardResult.redirect);
    }
  }

  if (guardResult && 'render' in guardResult) {
    const Fallback = guardResult.render;
    return <Fallback />;
  }

  const preloaded = getPreloadedData<T>(id);

  if (preloaded !== null) {
    cache?.set(preloaded);
    return (
      <ReloadContext.Provider value={{ reload, reloading, error: loadError }}>
        <Helper
          id={id}
          Child={Child}
          loader={{ read: () => preloaded }}
          overrideData={overrideData}
          Wrapper={Wrapper}
        />
      </ReloadContext.Provider>
    );
  }

  if (isBrowser() && cache?.has()) {
    const cached = cache.get()!;
    return (
      <ReloadContext.Provider value={{ reload, reloading, error: loadError }}>
        <Helper
          id={id}
          Child={Child}
          loader={{ read: () => cached }}
          overrideData={overrideData}
          Wrapper={Wrapper}
        />
      </ReloadContext.Provider>
    );
  }

  const loaderRef = wrapPromise(
    serverLoader({ location }).then((r) => {
      if (isBrowser()) cache?.set(r);
      return r;
    })
  );

  return (
    <ReloadContext.Provider value={{ reload, reloading, error: loadError }}>
      <Suspense fallback={fallback}>
        <Helper
          id={id}
          Child={Child}
          loader={loaderRef}
          overrideData={overrideData}
          Wrapper={Wrapper}
        />
      </Suspense>
    </ReloadContext.Provider>
  );
});

type HelperProps<T> = {
  id: string;
  Child: FunctionComponent<LoaderData<T>>;
  loader: { read: () => T };
  overrideData?: T;
  Wrapper?: ComponentType<WrapperProps>;
};
export const Helper = memo(function <T>({
  id,
  Child,
  loader,
  overrideData,
  Wrapper = DefaultWrapper,
}: HelperProps<T>) {
  const loaderData = overrideData !== undefined ? overrideData : loader.read();
  const stringified = !isBrowser() ? JSON.stringify(loaderData) : '{}';

  return (
    <Wrapper id={id} data-loader={stringified}>
      <Child loaderData={loaderData} id={id} />
    </Wrapper>
  );
});
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/loader.tsx packages/iso/src/page.tsx packages/iso/src/__tests__/loader.test.tsx packages/iso/src/__tests__/page.test.tsx
git commit -m "feat(iso): remove clientLoader — serverLoader is the unified loader"
```
