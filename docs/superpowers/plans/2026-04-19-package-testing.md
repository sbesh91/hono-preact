# Package Unit Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Vitest unit tests for all logic-owning files in `packages/`, surface coverage in the GitHub Actions job summary, and keep a `next` git tag on the latest green `main` build.

**Architecture:** Single `vitest.config.ts` at the monorepo root covers all three packages via include globs. Pure-logic tests run in Node; component/hook tests opt into happy-dom via a per-file pragma. A two-job GitHub Actions workflow runs tests on every push/PR and moves the `next` git tag on successful `main` builds.

**Tech Stack:** Vitest, `@vitest/coverage-v8`, `happy-dom`, `@testing-library/preact`, GitHub Actions

---

## File Map

| Action | Path |
|---|---|
| Modify | `package.json` (root) |
| Create | `vitest.config.ts` (root) |
| Create | `packages/iso/src/__tests__/cache.test.ts` |
| Create | `packages/iso/src/__tests__/guard.test.ts` |
| Create | `packages/iso/src/__tests__/wrap-promise.test.ts` |
| Create | `packages/iso/src/__tests__/is-browser.test.ts` |
| Create | `packages/iso/src/__tests__/loader.test.tsx` |
| Create | `packages/iso/src/__tests__/page.test.tsx` |
| Create | `packages/server/src/__tests__/location.test.ts` |
| Create | `packages/vite/src/__tests__/server-only-plugin.test.ts` |
| Create | `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts` |
| Create | `.github/workflows/ci.yml` |

---

## Task 1: Install dependencies and configure Vitest

**Files:**
- Modify: `package.json` (root)
- Create: `vitest.config.ts` (root)

- [ ] **Step 1: Install devDependencies at the monorepo root**

```bash
pnpm add -D -w vitest @vitest/coverage-v8 happy-dom @testing-library/preact
```

Expected: packages added to root `package.json` devDependencies, lockfile updated.

- [ ] **Step 2: Add test scripts to root `package.json`**

Open `package.json` at the monorepo root and add these three scripts alongside the existing ones:

```json
{
  "scripts": {
    "dev": "pnpm --filter app run dev",
    "build": "pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm --filter app build",
    "deploy": "pnpm --filter app run deploy",
    "preview": "pnpm --filter app run preview",
    "visualize": "pnpm --filter app run visualize",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

- [ ] **Step 3: Create `vitest.config.ts` at the monorepo root**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    include: [
      'packages/iso/src/__tests__/**/*.test.{ts,tsx}',
      'packages/server/src/__tests__/**/*.test.ts',
      'packages/vite/src/__tests__/**/*.test.ts',
    ],
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

- [ ] **Step 4: Verify Vitest can start**

```bash
pnpm test
```

Expected: Vitest starts and reports "No test files found" (no tests written yet). Exit code 0 or a clear "no tests" message. If you see import errors, check that `preact`, `hono`, and `preact-iso` are hoisted in `node_modules/` (they come from `apps/app`'s dependencies via pnpm workspace hoisting).

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.ts pnpm-lock.yaml
git commit -m "chore: add vitest and coverage infrastructure"
```

---

## Task 2: `cache.test.ts`

**Files:**
- Create: `packages/iso/src/__tests__/cache.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createCache } from '../cache.js';

describe('createCache', () => {
  it('get() returns null initially', () => {
    const cache = createCache<{ name: string }>();
    expect(cache.get()).toBeNull();
  });

  it('set() + get() round-trip', () => {
    const cache = createCache<{ name: string }>();
    cache.set({ name: 'hello' });
    expect(cache.get()).toEqual({ name: 'hello' });
  });

  it('has() is false before set, true after', () => {
    const cache = createCache<{ name: string }>();
    expect(cache.has()).toBe(false);
    cache.set({ name: 'hello' });
    expect(cache.has()).toBe(true);
  });

  it('wrap() calls loader on cache miss and stores the result', async () => {
    const cache = createCache<{ name: string }>();
    const loader = vi.fn().mockResolvedValue({ name: 'fetched' });
    const wrapped = cache.wrap(loader);
    const result = await wrapped({ location: {} as any });
    expect(loader).toHaveBeenCalledOnce();
    expect(result).toEqual({ name: 'fetched' });
    expect(cache.get()).toEqual({ name: 'fetched' });
  });

  it('wrap() returns cached value on hit without calling loader', async () => {
    const cache = createCache<{ name: string }>();
    cache.set({ name: 'cached' });
    const loader = vi.fn();
    const wrapped = cache.wrap(loader);
    const result = await wrapped({ location: {} as any });
    expect(loader).not.toHaveBeenCalled();
    expect(result).toEqual({ name: 'cached' });
  });

  it('invalidate() resets to null; next wrap() call re-fetches', async () => {
    const cache = createCache<{ name: string }>();
    cache.set({ name: 'old' });
    cache.invalidate();
    expect(cache.get()).toBeNull();
    const loader = vi.fn().mockResolvedValue({ name: 'new' });
    const wrapped = cache.wrap(loader);
    const result = await wrapped({ location: {} as any });
    expect(loader).toHaveBeenCalledOnce();
    expect(result).toEqual({ name: 'new' });
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected output: `6 tests passed` for `cache.test.ts`. If any fail, re-read `packages/iso/src/cache.ts` to check the logic matches the test expectations.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/cache.test.ts
git commit -m "test(iso): cache unit tests"
```

---

## Task 3: `guard.test.ts`

**Files:**
- Create: `packages/iso/src/__tests__/guard.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, vi } from 'vitest';
import { createGuard, runGuards, GuardRedirect } from '../guard.js';
import type { GuardContext } from '../guard.js';

const ctx: GuardContext = { location: {} as any };

describe('createGuard', () => {
  it('returns the function unchanged', () => {
    const fn = async (_ctx: GuardContext, next: () => Promise<any>) => next();
    expect(createGuard(fn)).toBe(fn);
  });
});

describe('runGuards', () => {
  it('resolves to undefined with an empty guard list', async () => {
    const result = await runGuards([], ctx);
    expect(result).toBeUndefined();
  });

  it('single guard returning { redirect } short-circuits', async () => {
    const guard = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));
    const result = await runGuards([guard], ctx);
    expect(result).toEqual({ redirect: '/login' });
  });

  it('single guard returning { render } short-circuits', async () => {
    const ForbiddenPage = () => null;
    const guard = createGuard(async (_ctx, _next) => ({ render: ForbiddenPage }));
    const result = await runGuards([guard], ctx);
    expect(result).toEqual({ render: ForbiddenPage });
  });

  it('single guard calling next() passes through to undefined', async () => {
    const guard = createGuard(async (_ctx, next) => next());
    const result = await runGuards([guard], ctx);
    expect(result).toBeUndefined();
  });

  it('first guard redirect prevents second guard from running', async () => {
    const secondFn = vi.fn();
    const first = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));
    const second = createGuard(async (_ctx, _next) => { secondFn(); return undefined; });
    await runGuards([first, second], ctx);
    expect(secondFn).not.toHaveBeenCalled();
  });

  it('first guard passes, second guard redirects', async () => {
    const first = createGuard(async (_ctx, next) => next());
    const second = createGuard(async (_ctx, _next) => ({ redirect: '/forbidden' }));
    const result = await runGuards([first, second], ctx);
    expect(result).toEqual({ redirect: '/forbidden' });
  });
});

describe('GuardRedirect', () => {
  it('is an Error subclass', () => {
    expect(new GuardRedirect('/login')).toBeInstanceOf(Error);
  });

  it('has the correct location property', () => {
    const err = new GuardRedirect('/login');
    expect(err.location).toBe('/login');
  });

  it('has name set to GuardRedirect', () => {
    const err = new GuardRedirect('/login');
    expect(err.name).toBe('GuardRedirect');
  });

  it('has a descriptive message', () => {
    const err = new GuardRedirect('/login');
    expect(err.message).toBe('Guard redirect to /login');
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `10 tests passed` across `guard.test.ts`. The prior 6 from `cache.test.ts` also still pass.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/guard.test.ts
git commit -m "test(iso): guard unit tests"
```

---

## Task 4: `wrap-promise.test.ts`

**Files:**
- Create: `packages/iso/src/__tests__/wrap-promise.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect } from 'vitest';
import wrapPromise from '../wrap-promise.js';

describe('wrapPromise', () => {
  it('read() throws a Promise while the original promise is pending', () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const wrapped = wrapPromise(promise);
    let thrown: unknown;
    try { wrapped.read(); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Promise);
    resolve('cleanup');
  });

  it('read() returns the resolved value after the promise settles', async () => {
    const promise = Promise.resolve('hello');
    const wrapped = wrapPromise(promise);
    await promise; // flush the .then() handler registered by wrapPromise
    expect(wrapped.read()).toBe('hello');
  });

  it('read() throws the rejection reason after the promise rejects', async () => {
    const err = new Error('boom');
    const promise = Promise.reject(err);
    const wrapped = wrapPromise(promise);
    await promise.catch(() => {}); // suppress unhandled rejection warning, flush handler
    expect(() => wrapped.read()).toThrow('boom');
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `3 tests passed` for `wrap-promise.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/wrap-promise.test.ts
git commit -m "test(iso): wrapPromise unit tests"
```

---

## Task 5: `is-browser.test.ts`

**Files:**
- Create: `packages/iso/src/__tests__/is-browser.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { env, isBrowser } from '../is-browser.js';

const original = env.current;
afterEach(() => { env.current = original; });

describe('isBrowser', () => {
  it('returns false when env.current is server', () => {
    env.current = 'server';
    expect(isBrowser()).toBe(false);
  });

  it('returns true when env.current is browser', () => {
    env.current = 'browser';
    expect(isBrowser()).toBe(true);
  });
});

describe('env', () => {
  it('can be set to server and read back', () => {
    env.current = 'server';
    expect(env.current).toBe('server');
  });

  it('can be set to browser and read back', () => {
    env.current = 'browser';
    expect(env.current).toBe('browser');
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `4 tests passed` for `is-browser.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/is-browser.test.ts
git commit -m "test(iso): is-browser unit tests"
```

---

## Task 6: `loader.test.tsx` (happy-dom)

Tests `getLoaderData` through its public API: cache hit, cache miss/fetch, preloaded data path, `useReload`, and the `useReload` context error.

**Files:**
- Create: `packages/iso/src/__tests__/loader.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { getLoaderData, useReload, type LoaderData } from '../loader.js';
import { createCache } from '../cache.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({})),
  deletePreloadedData: vi.fn(),
}));

import * as preloadModule from '../preload.js';

const loc = { path: '/test', url: 'http://localhost/test', query: {}, params: {}, pathParams: {} } as any;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  vi.mocked(preloadModule.getPreloadedData).mockReturnValue({} as any);
});
afterEach(() => {
  env.current = originalEnv;
});

function Child({ loaderData, testId }: LoaderData<{ msg: string }> & { testId?: string }) {
  return <div data-testid={testId ?? 'child'}>{loaderData?.msg ?? 'no data'}</div>;
}
Child.defaultProps = { route: '/test' };

function wrap(el: JSX.Element) {
  return render(<LocationProvider>{el}</LocationProvider>);
}

describe('cache hit', () => {
  it('renders cached data without calling clientLoader', async () => {
    const cache = createCache<{ msg: string }>();
    cache.set({ msg: 'from cache' });
    const clientLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { clientLoader, cache });

    wrap(<Wrapped {...loc} />);

    await waitFor(() => {
      expect(screen.getByTestId('child')).toHaveTextContent('from cache');
    });
    expect(clientLoader).not.toHaveBeenCalled();
  });
});

describe('preloaded data (hydration path)', () => {
  it('renders preloaded data without calling clientLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({ msg: 'preloaded' } as any);
    const clientLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { clientLoader });

    wrap(<Wrapped {...loc} />);

    await waitFor(() => {
      expect(screen.getByTestId('child')).toHaveTextContent('preloaded');
    });
    expect(clientLoader).not.toHaveBeenCalled();
  });
});

describe('cache miss (fetch path)', () => {
  it('calls clientLoader and shows fallback during load', async () => {
    let resolve!: (v: { msg: string }) => void;
    const clientLoader = vi.fn(
      () => new Promise<{ msg: string }>((r) => { resolve = r; })
    );
    const Wrapped = getLoaderData(Child, {
      clientLoader,
      fallback: <div data-testid="loading">Loading…</div>,
    });

    wrap(<Wrapped {...loc} />);

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toBeInTheDocument();
    });
    expect(clientLoader).toHaveBeenCalledOnce();

    await act(async () => { resolve({ msg: 'loaded' }); });

    await waitFor(() => {
      expect(screen.getByTestId('child')).toHaveTextContent('loaded');
    });
  });
});

describe('useReload', () => {
  it('reload() re-runs clientLoader and updates rendered content', async () => {
    let callCount = 0;
    const clientLoader = vi.fn(() => {
      callCount++;
      return Promise.resolve({ msg: `call ${callCount}` });
    });

    function ReloadChild({ loaderData }: LoaderData<{ msg: string }>) {
      const { reload } = useReload();
      return (
        <div>
          <span data-testid="msg">{loaderData?.msg}</span>
          <button onClick={reload}>reload</button>
        </div>
      );
    }
    ReloadChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(ReloadChild, { clientLoader });
    wrap(<Wrapped {...loc} />);

    await waitFor(() => {
      expect(screen.getByTestId('msg')).toHaveTextContent('call 1');
    });

    await act(async () => { screen.getByRole('button').click(); });

    await waitFor(() => {
      expect(screen.getByTestId('msg')).toHaveTextContent('call 2');
    });
    expect(clientLoader).toHaveBeenCalledTimes(2);
  });

  it('throws when called outside a getLoaderData component', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad() { useReload(); return null; }
    expect(() => render(<Bad />)).toThrow(
      'useReload must be called inside a component rendered by getLoaderData'
    );
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `5 tests passed` in `loader.test.tsx`. If you see a Preact JSX resolution error, confirm `esbuild.jsxImportSource: 'preact'` is in `vitest.config.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/loader.test.tsx
git commit -m "test(iso): loader/getLoaderData integration tests"
```

---

## Task 7: `page.test.tsx` (happy-dom)

Tests guard-branch logic in `Page`/`GuardedPage`: the `{ render }` guard result and the server-side `{ redirect }` guard result (which throws `GuardRedirect`).

**Files:**
- Create: `packages/iso/src/__tests__/page.test.tsx`

- [ ] **Step 1: Create the test file**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { getLoaderData } from '../loader.js';
import { createGuard, GuardRedirect } from '../guard.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({})),
  deletePreloadedData: vi.fn(),
}));

// Mock only useLocation from preact-iso; keep LocationProvider and everything else real.
const mockRoute = vi.fn();
vi.mock('preact-iso', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, useLocation: () => ({ route: mockRoute }) };
});

import { LocationProvider } from 'preact-iso';

const loc = { path: '/test', url: 'http://localhost/test', query: {}, params: {}, pathParams: {} } as any;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  mockRoute.mockClear();
});
afterEach(() => { env.current = originalEnv; });

describe('guard { render }', () => {
  it('renders the guard-supplied component instead of the page', async () => {
    const ForbiddenPage = () => <div data-testid="forbidden">403 Forbidden</div>;
    const guard = createGuard(async (_ctx, _next) => ({ render: ForbiddenPage }));

    function PageChild() { return <div data-testid="page">Protected content</div>; }
    PageChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(PageChild, {
      clientGuards: [guard],
      clientLoader: async () => ({}),
    });

    render(
      <LocationProvider>
        <Wrapped {...loc} />
      </LocationProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('forbidden')).toHaveTextContent('403 Forbidden');
    });
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } in browser', () => {
  it('calls route() with the redirect path when a client guard redirects', async () => {
    const guard = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));

    function PageChild() { return <div data-testid="page">Protected</div>; }
    PageChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(PageChild, {
      clientGuards: [guard],
      clientLoader: async () => ({}),
    });

    render(
      <LocationProvider>
        <Wrapped {...loc} />
      </LocationProvider>
    );

    await waitFor(() => {
      expect(mockRoute).toHaveBeenCalledWith('/login');
    });
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } on server', () => {
  it('throws GuardRedirect when a server guard redirects', async () => {
    env.current = 'server';
    const guard = createGuard(async (_ctx, _next) => ({ redirect: '/login' }));

    function PageChild() { return <div>Protected</div>; }
    PageChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(PageChild, {
      serverGuards: [guard],
      serverLoader: async () => ({}),
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      waitFor(() =>
        render(
          <LocationProvider>
            <Wrapped {...loc} />
          </LocationProvider>
        )
      )
    ).rejects.toThrow(GuardRedirect);

    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `3 tests passed` in `page.test.tsx`.

- [ ] **Step 3: Commit**

```bash
git add packages/iso/src/__tests__/page.test.tsx
git commit -m "test(iso): Page guard-branch tests"
```

---

## Task 8: `location.test.ts`

**Files:**
- Create: `packages/server/src/__tests__/location.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('preact-iso/prerender', () => ({
  locationStub: vi.fn(),
}));

import { locationStub } from 'preact-iso/prerender';
import { location } from '../middleware/location.js';

beforeEach(() => {
  vi.mocked(locationStub).mockClear();
});

function makeApp() {
  const app = new Hono();
  app.use(location);
  app.get('*', (c) => c.text('ok'));
  return app;
}

describe('location middleware', () => {
  it('calls locationStub with the request pathname', async () => {
    await makeApp().request('http://localhost/some/path');
    expect(locationStub).toHaveBeenCalledWith('/some/path');
  });

  it('strips query string from the pathname passed to locationStub', async () => {
    await makeApp().request('http://localhost/search?q=hello');
    expect(locationStub).toHaveBeenCalledWith('/search');
  });

  it('calls next() so the handler runs', async () => {
    const res = await makeApp().request('http://localhost/ping');
    expect(await res.text()).toBe('ok');
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `3 tests passed` in `location.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/location.test.ts
git commit -m "test(server): location middleware unit tests"
```

---

## Task 9: `server-only-plugin.test.ts`

**Files:**
- Create: `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Create the test file**

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
  it('replaces a default *.server.* import with an async no-op stub', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result?.code).toBe('const serverLoader = async () => ({});');
  });

  it('replaces serverGuards named import with an empty array stub', () => {
    const code = `import serverLoader, { serverGuards } from './movies.server.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result?.code).toContain('const serverLoader = async () => ({});');
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
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `6 tests passed` in `server-only-plugin.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "test(vite): serverOnlyPlugin unit tests"
```

---

## Task 10: `server-loader-validation-plugin.test.ts`

**Files:**
- Create: `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect, vi } from 'vitest';
import { serverLoaderValidationPlugin } from '../index.js';
import type { Plugin } from 'vite';

type TransformFn = (code: string, id: string) => void;

function transform(code: string, id: string): { error: string | null } {
  const plugin = serverLoaderValidationPlugin() as Plugin & { transform: TransformFn };
  const context = {
    error: vi.fn((msg: string) => { throw new Error(msg); }),
  };
  try {
    plugin.transform.call(context as any, code, id);
    return { error: null };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

describe('serverLoaderValidationPlugin', () => {
  it('ignores files that are not *.server.* files', () => {
    const { error } = transform('export default function() {}', 'movies.tsx');
    expect(error).toBeNull();
  });

  it('passes a *.server.* file with only a default export', () => {
    const code = `export default async function serverLoader() { return {}; }`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('passes a *.server.* file with default + serverGuards named export', () => {
    const code = [
      'export default async function serverLoader() { return {}; }',
      'export const serverGuards = [];',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toBeNull();
  });

  it('fails when a *.server.* file has a disallowed named export', () => {
    const code = [
      'export const helper = () => {};',
      'export default async function serverLoader() { return {}; }',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('found: helper');
  });

  it('fails when a *.server.* file has no default export', () => {
    const code = `export const serverGuards = [];`;
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('must have a default export');
  });

  it('fails when a *.server.* file has multiple disallowed named exports', () => {
    const code = [
      'export const helper = () => {};',
      'export const util = () => {};',
      'export default async function serverLoader() { return {}; }',
    ].join('\n');
    const { error } = transform(code, 'movies.server.ts');
    expect(error).toContain('helper');
    expect(error).toContain('util');
  });
});
```

- [ ] **Step 2: Run tests and verify all pass**

```bash
pnpm test
```

Expected: `6 tests passed` in `server-loader-validation-plugin.test.ts`. Total across all test files at this point: `~41 tests`.

- [ ] **Step 3: Run coverage and confirm output**

```bash
pnpm test:coverage
```

Expected: Coverage table printed to stdout. Verify `packages/iso/src/cache.ts`, `guard.ts`, `wrap-promise.ts`, `is-browser.tsx`, `loader.tsx`, `page.tsx`, `packages/server/src/middleware/location.ts`, and `packages/vite/src/index.ts` all appear in the coverage report.

- [ ] **Step 4: Commit**

```bash
git add packages/vite/src/__tests__/server-loader-validation-plugin.test.ts
git commit -m "test(vite): serverLoaderValidationPlugin unit tests"
```

---

## Task 11: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the `.github/workflows/` directory and the workflow file**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests with coverage
        shell: bash
        run: |
          set -o pipefail
          echo "## Test Coverage" >> $GITHUB_STEP_SUMMARY
          pnpm test:coverage 2>&1 | tee -a $GITHUB_STEP_SUMMARY

  build-and-tag:
    name: Build and tag next
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: latest

      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages and app
        run: pnpm build

      - name: Move next tag to HEAD
        run: |
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git config user.name "github-actions[bot]"
          git tag -f next
          git push origin next --force
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test + build-and-tag workflow"
```

- [ ] **Step 3: Push to main and verify CI triggers**

```bash
git push origin main
```

Open the repository on GitHub → Actions tab. Confirm:
- The `CI` workflow appears and starts running
- The `Test` job installs deps, runs `pnpm test:coverage`, and writes the coverage table to the job summary
- The `Build and tag next` job runs after `Test` passes
- After both jobs succeed, the `next` tag appears under the repo's Tags page pointing to the HEAD commit

If the `build-and-tag` job fails on `pnpm build` because the packages' `dist/` directories are stale, check that each package's `tsconfig.json` has `outDir` set and that `pnpm build` (root script) runs `pnpm --filter '@hono-preact/*' --filter hono-preact build && pnpm --filter app build`. The `apps/app` build requires Cloudflare workers tooling — if it times out or errors in CI, scope the build step to packages only: `pnpm --filter '@hono-preact/*' --filter hono-preact build`.
