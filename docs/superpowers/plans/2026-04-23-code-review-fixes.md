# Code Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 17 issues identified in `docs/code-review-packages-2026-04-22.md`, covering security, correctness, type safety, and test coverage across the four packages.

**Architecture:** Tasks are ordered by severity (Critical → Important → Minor). Each task is independently committable. Fixes in `packages/iso` dominate; `packages/server` and `packages/vite` each have 2–3 tasks. No new files are needed except a new test file for `preload.ts` and a new barrel entry for Vite plugins.

**Tech Stack:** Preact, Hono, Vite (plugins via `@babel/parser` + `magic-string`), Vitest, `hoofd/preact`

---

## File Map

| File | Tasks |
|---|---|
| `packages/server/src/render.tsx` | T1 (XSS escaper), T6 (env.current) |
| `packages/server/src/__tests__/render.test.tsx` | T1, T6, T9 |
| `packages/iso/src/preload.ts` | T2 (null sentinel) |
| `packages/iso/src/page.tsx` | T2, T4 (stale guards), T5 (reload errors), T10 (type), T11 (data-page), T14 (reload callback) |
| `packages/iso/src/loader.tsx` | T10 (loaderData required, T extends) |
| `packages/iso/src/wrap-promise.ts` | T7 (type hole) |
| `packages/iso/src/__tests__/loader.test.tsx` | T2 (hydration edge cases), T5 |
| `packages/iso/src/__tests__/page.test.tsx` | T4 |
| `packages/iso/src/__tests__/preload.test.ts` | T13 (new file) |
| `packages/vite/src/server-only.ts` | T3 (multi-import) |
| `packages/vite/src/__tests__/server-only-plugin.test.ts` | T3 |
| `packages/vite/src/server-loader-validation.ts` | T12 (export *, sequential error) |
| `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts` | T12 |
| `packages/hono-preact/src/index.ts` | T8 (remove vite re-export) |
| `packages/hono-preact/src/vite.ts` | T8 (new entry) |
| `packages/hono-preact/package.json` | T8 (exports field) |
| `vitest.config.ts` | T13 (add preload.ts to coverage) |

---

## Task 1: Fix XSS — Escape title and lang in render.tsx (C1)

**Files:**
- Modify: `packages/server/src/render.tsx`
- Modify: `packages/server/src/__tests__/render.test.tsx`

- [ ] **Step 1: Write failing XSS tests**

Add to the bottom of `packages/server/src/__tests__/render.test.tsx`:

```typescript
function XssTitle() {
  useTitle('</title><script>alert(1)</script><title>');
  return <html><head></head><body></body></html>;
}

function XssLang() {
  useLang('en" onload="alert(1)');
  return <html><head></head><body></body></html>;
}
```

Add `useLang` to the import at line 3:
```typescript
import { useTitle, useLang } from 'hoofd/preact';
```

Add these tests inside the `describe('renderPage', ...)` block:

```typescript
it('escapes special characters in <title> content', async () => {
  const res = await makeApp(XssTitle).request('http://localhost/');
  const html = await res.text();
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;/title&gt;');
});

it('escapes special characters in the lang attribute', async () => {
  const res = await makeApp(XssLang).request('http://localhost/');
  const html = await res.text();
  expect(html).not.toContain('onload=');
  expect(html).toContain('&quot;');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- packages/server/src/__tests__/render.test.tsx
```

Expected: 2 new tests FAIL (script tag and onload present in output).

- [ ] **Step 3: Add HTML escaper and apply it in render.tsx**

In `packages/server/src/render.tsx`, add after the `toAttrs` function (after line 12):

```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

Change line 35 from:
```typescript
    `<title>${title ?? options?.defaultTitle ?? ''}</title>`,
```
To:
```typescript
    `<title>${escapeHtml(title ?? options?.defaultTitle ?? '')}</title>`,
```

Change line 42 from:
```typescript
      <html lang="${lang ?? 'en-US'}">
```
To:
```typescript
      <html lang="${escapeHtml(lang ?? 'en-US')}">
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- packages/server/src/__tests__/render.test.tsx
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/__tests__/render.test.tsx
git commit -m "fix(server): escape title and lang values to prevent XSS in SSR output"
```

---

## Task 2: Fix hydration sentinel for empty/falsy loader results (C2)

**Files:**
- Modify: `packages/iso/src/preload.ts`
- Modify: `packages/iso/src/page.tsx`
- Modify: `packages/iso/src/__tests__/loader.test.tsx`

- [ ] **Step 1: Write failing tests for empty-object hydration**

Add a new `describe` block at the bottom of `packages/iso/src/__tests__/loader.test.tsx`:

```typescript
describe('preloaded data — edge cases', () => {
  it('uses preloaded empty object without calling clientLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({} as any);
    // mark as "initialized" — after fix, {} from server should NOT trigger clientLoader
    // The mock must signal that data was actually loaded (not the default sentinel).
    // We test this by verifying clientLoader is NOT called when preload returns {}.
    // NOTE: this test will fail before the fix because {} is treated as "no data".
    const clientLoader = vi.fn().mockResolvedValue({ msg: 'from client' });
    const Wrapped = getLoaderData(Child, { clientLoader });
    wrap(<Wrapped {...loc} />);
    // Give clientLoader time to be called if the bug is present
    await waitFor(() => {}, { timeout: 50 }).catch(() => {});
    expect(clientLoader).not.toHaveBeenCalled();
  });
});
```

Wait — this test depends on the mock signaling "initialized". The mock can't do that with the current `getPreloadedData` signature. We need to update the mock AFTER the implementation changes. So:

**Revised Step 1 approach:** Update `preload.ts` first (Step 3), then write the test against the new contract.

- [ ] **Step 1 (revised): Write failing test using the new null-sentinel contract**

The new contract: `getPreloadedData` returns `null` when no data is preloaded (not in browser, no element, or parse failed). It returns the parsed value (including `{}`) when data was genuinely preloaded.

Add to `packages/iso/src/__tests__/loader.test.tsx`:

```typescript
describe('preloaded empty object (hydration edge case)', () => {
  it('renders preloaded empty object without calling clientLoader', async () => {
    // Simulate server rendering {} as the loader result
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({} as any);
    const clientLoader = vi.fn().mockResolvedValue({ msg: 'from client' });

    function EmptyChild({ loaderData }: LoaderData<Record<string, never>>) {
      return <div data-testid="empty">{JSON.stringify(loaderData)}</div>;
    }
    EmptyChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(EmptyChild, { clientLoader });
    wrap(<Wrapped {...loc} />);

    const el = await screen.findByTestId('empty');
    expect(el).toHaveTextContent('{}');
    expect(clientLoader).not.toHaveBeenCalled();
  });
});
```

Note: this test will pass even before the fix because the mock returns `{}` but the `isLoaded` check will be false with the old code — `clientLoader` WILL be called. Run first to confirm it fails.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- packages/iso/src/__tests__/loader.test.tsx
```

Expected: new test FAILS — `clientLoader` is called once (bug behavior).

- [ ] **Step 3: Update preload.ts to return null as the no-data sentinel**

Replace all of `packages/iso/src/preload.ts`:

```typescript
import { isBrowser } from './is-browser';

export function getPreloadedData<T>(id: string): T | null {
  if (!isBrowser()) {
    return null;
  }

  const el = document.getElementById(id);
  if (!el || !('loader' in el.dataset)) {
    return null;
  }

  try {
    return JSON.parse(el.dataset.loader ?? 'null') as T;
  } catch {
    return null;
  } finally {
    deletePreloadedData(id);
  }
}

export function deletePreloadedData(id: string) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }

  delete el.dataset.loader;
}
```

Key changes:
- Return type is `T | null` instead of `T`
- Returns `null` (not `{} as T`) for all no-data cases
- Checks `'loader' in el.dataset` (truthy even for `data-loader=""`) to distinguish "element exists, data was written" from "element not found"

- [ ] **Step 4: Update page.tsx to use null check**

In `packages/iso/src/page.tsx`, replace lines 151–152:

```typescript
  const preloaded = getPreloadedData<T>(id);
  const isLoaded = Object.keys(preloaded).length > 0;
```

With:

```typescript
  const preloaded = getPreloadedData<T>(id);
```

Replace the `if (isLoaded)` block (lines 154–167) with:

```typescript
  if (preloaded !== null) {
    cache?.set(preloaded);
    return (
      <ReloadContext.Provider value={{ reload, reloading }}>
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
```

Also update the mock return value in `loader.test.tsx` `beforeEach` — it currently returns `{} as any` to mean "no data". It must now return `null`:

```typescript
beforeEach(() => {
  env.current = 'browser';
  vi.mocked(preloadModule.getPreloadedData).mockReturnValue(null);
});
```

And in `page.test.tsx`, update the same:
```typescript
vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));
```

- [ ] **Step 5: Run all tests to verify they pass**

```bash
pnpm test
```

Expected: all tests pass, including the new edge case test.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/preload.ts packages/iso/src/page.tsx packages/iso/src/__tests__/loader.test.tsx packages/iso/src/__tests__/page.test.tsx
git commit -m "fix(iso): use null sentinel in getPreloadedData so empty-object loader results hydrate correctly"
```

---

## Task 3: Fix serverOnlyPlugin to stub all .server imports per file (C3)

**Files:**
- Modify: `packages/vite/src/server-only.ts`
- Modify: `packages/vite/src/__tests__/server-only-plugin.test.ts`

- [ ] **Step 1: Write failing test for multiple .server imports**

Add to `packages/vite/src/__tests__/server-only-plugin.test.ts` inside the `describe` block:

```typescript
it('stubs all .server imports when a file has more than one', () => {
  const code = [
    `import serverLoader from './movies.server.js';`,
    `import authLoader from './auth.server.js';`,
  ].join('\n');
  const result = transform(code, 'page.tsx');
  expect(result?.code).toContain('const serverLoader = async () => ({});');
  expect(result?.code).toContain('const authLoader = async () => ({});');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- packages/vite/src/__tests__/server-only-plugin.test.ts
```

Expected: new test FAILS — only `serverLoader` stub is present, `authLoader` stub is missing.

- [ ] **Step 3: Replace .find() with .filter() and process all matches**

Replace all of `packages/vite/src/server-only.ts`:

```typescript
import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

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
              s.imported.name === 'serverGuards')
        );

      const serverImports = ast.program.body.filter(isServerImport);
      if (serverImports.length === 0) return;

      const s = new MagicString(code);

      // Process in reverse order to preserve character offsets
      for (const serverImport of [...serverImports].reverse()) {
        const stubs: string[] = [];

        for (const specifier of serverImport.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            stubs.push(`const ${specifier.local.name} = async () => ({});`);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverGuards'
          ) {
            stubs.push(`const ${specifier.local.name} = [];`);
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- packages/vite/src/__tests__/server-only-plugin.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-only.ts packages/vite/src/__tests__/server-only-plugin.test.ts
git commit -m "fix(vite): stub all .server imports per file, not just the first one"
```

---

## Task 4: Fix stale guards after client-side navigation (I1)

**Files:**
- Modify: `packages/iso/src/page.tsx`
- Modify: `packages/iso/src/__tests__/page.test.tsx`

- [ ] **Step 1: Write failing test for guard re-evaluation on navigation**

Add a new `describe` block in `packages/iso/src/__tests__/page.test.tsx`:

```typescript
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
      clientLoader: async () => ({}),
    });

    const locPublic = { ...loc, path: '/public' } as any;
    const { rerender } = render(
      <LocationProvider>
        <Wrapped {...locPublic} />
      </LocationProvider>
    );

    await screen.findByTestId('page');

    // Simulate navigation to /admin
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

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- packages/iso/src/__tests__/page.test.tsx
```

Expected: new test FAILS — guard does not redirect on navigation.

- [ ] **Step 3: Reset guardRef when path changes in Page**

In `packages/iso/src/page.tsx`, update the `Page` component (lines 57–87). Add a `prevGuardPath` ref and reset the guard when path changes:

```typescript
export const Page = memo(function <T extends {}>({
  Child,
  serverLoader,
  clientLoader,
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
        clientLoader={clientLoader}
        location={location}
        cache={cache}
        guardRef={guardRef}
        fallback={fallback}
        Wrapper={Wrapper}
      />
    </Suspense>
  );
});
```

- [ ] **Step 4: Run all iso tests to verify they pass**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/page.tsx packages/iso/src/__tests__/page.test.tsx
git commit -m "fix(iso): re-run guards when route path changes on client navigation"
```

---

## Task 5: Expose reload errors via ReloadContextValue (I2)

**Files:**
- Modify: `packages/iso/src/page.tsx`
- Modify: `packages/iso/src/__tests__/loader.test.tsx`

- [ ] **Step 1: Write failing test for reload error exposure**

Add a new `describe` block in `packages/iso/src/__tests__/loader.test.tsx`:

```typescript
describe('useReload error handling', () => {
  it('exposes the error when clientLoader throws during reload', async () => {
    const cache = createCache<{ msg: string }>();
    const clientLoader = vi.fn()
      .mockResolvedValueOnce({ msg: 'initial' })
      .mockRejectedValueOnce(new Error('network failure'));

    function ErrorChild({ loaderData }: LoaderData<{ msg: string }>) {
      const { reload, error } = useReload();
      return (
        <div>
          <span data-testid="msg">{loaderData?.msg}</span>
          <span data-testid="error">{error?.message ?? 'none'}</span>
          <button onClick={reload}>reload</button>
        </div>
      );
    }
    ErrorChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(ErrorChild, { clientLoader, cache });
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

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- packages/iso/src/__tests__/loader.test.tsx
```

Expected: FAIL — TypeScript error that `error` does not exist on `ReloadContextValue`, or test fails because error is never set.

- [ ] **Step 3: Add error field to ReloadContextValue and wire it up**

In `packages/iso/src/page.tsx`:

Change the `ReloadContextValue` type (lines 18–21):

```typescript
type ReloadContextValue = {
  reload: () => void;
  reloading: boolean;
  error: Error | null;
};
```

In `GuardedPage`, add state for the error after the existing `useState` calls (around line 113):

```typescript
  const [reloading, setReloading] = useState(false);
  const [overrideData, setOverrideData] = useState<T | undefined>(undefined);
  const [loadError, setLoadError] = useState<Error | null>(null);
```

Update the `reload` callback (lines 122–133) to clear and set the error:

```typescript
  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    setLoadError(null);
    clientLoader({ location })
      .then((result) => {
        setOverrideData(result);
        setReloading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
        setReloading(false);
      });
  }, [reloading, clientLoader, location]);
```

Update all three `<ReloadContext.Provider value={...}>` call sites to include `error: loadError`:

```typescript
<ReloadContext.Provider value={{ reload, reloading, error: loadError }}>
```

There are three of these in `GuardedPage` (preloaded path, cache path, fetch path).

- [ ] **Step 4: Run all iso tests to verify they pass**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/iso/src/page.tsx packages/iso/src/__tests__/loader.test.tsx
git commit -m "feat(iso): expose reload errors via ReloadContextValue.error field"
```

---

## Task 6: Auto-set env.current to 'server' inside renderPage (I3)

**Files:**
- Modify: `packages/server/src/render.tsx`
- Modify: `packages/server/src/__tests__/render.test.tsx`

- [ ] **Step 1: Write failing test for env.current enforcement**

Add to `packages/server/src/__tests__/render.test.tsx`:

```typescript
import { env } from '@hono-preact/iso';
```

Add this test in the `describe('renderPage', ...)` block:

```typescript
it('sets env.current to server during render and restores it after', async () => {
  let envDuringRender: string | undefined;

  function EnvSnoop() {
    envDuringRender = env.current;
    return <html><head></head><body></body></html>;
  }

  const originalEnv = env.current;
  await makeApp(EnvSnoop).request('http://localhost/');

  expect(envDuringRender).toBe('server');
  expect(env.current).toBe(originalEnv);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- packages/server/src/__tests__/render.test.tsx
```

Expected: new test FAILS — `envDuringRender` is `'browser'` (the default).

- [ ] **Step 3: Set env.current in renderPage**

In `packages/server/src/render.tsx`, add `env` to the import from `@hono-preact/iso` (line 5):

```typescript
import { GuardRedirect, env } from '@hono-preact/iso';
```

Wrap the `prerender` call to set and restore `env.current`:

```typescript
export async function renderPage(
  c: Context,
  node: VNode,
  options?: { defaultTitle?: string }
): Promise<Response> {
  const dispatcher = createDispatcher();

  const previousEnv = env.current;
  env.current = 'server';

  let html: string;
  try {
    ({ html } = await prerender(
      <HoofdProvider value={dispatcher}>{node}</HoofdProvider>
    ));
  } catch (e: unknown) {
    if (e instanceof GuardRedirect) return c.redirect(e.location);
    throw e;
  } finally {
    env.current = previousEnv;
  }

  // ... rest of function unchanged
```

- [ ] **Step 4: Run all server tests to verify they pass**

```bash
pnpm test -- packages/server
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/render.tsx packages/server/src/__tests__/render.test.tsx
git commit -m "fix(server): set env.current='server' inside renderPage so isBrowser() is correct during SSR"
```

---

## Task 7: Fix wrapPromise type hole in error path (I4)

**Files:**
- Modify: `packages/iso/src/wrap-promise.ts`

- [ ] **Step 1: Run existing tests first to confirm they pass**

```bash
pnpm test -- packages/iso/src/__tests__/wrap-promise.test.ts
```

Expected: all 3 tests pass. (The existing test already covers the error path functionally — this task is a type safety fix.)

- [ ] **Step 2: Fix the variable types**

Replace all of `packages/iso/src/wrap-promise.ts`:

```typescript
export function wrapPromise<T>(promise: Promise<T>) {
  let status = "pending";
  let result: T;
  let error: unknown;

  const suspender = promise.then(
    (res) => {
      status = "success";
      result = res;
    },
    (err) => {
      status = "error";
      error = err;
    }
  );

  const read = () => {
    switch (status) {
      case "pending":
        throw suspender;
      case "error":
        throw error;
      default:
        return result;
    }
  };

  return { read };
}

export default wrapPromise;
```

- [ ] **Step 3: Run tests to verify they still pass**

```bash
pnpm test -- packages/iso/src/__tests__/wrap-promise.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/wrap-promise.ts
git commit -m "fix(iso): separate result and error variables in wrapPromise to close type hole"
```

---

## Task 8: Move Vite plugin exports to a separate barrel entry (I5)

**Files:**
- Modify: `packages/hono-preact/src/index.ts`
- Create: `packages/hono-preact/src/vite.ts`
- Modify: `packages/hono-preact/package.json`

No tests needed (this is a package structure change; imports are validated by TypeScript build).

- [ ] **Step 1: Remove the vite re-export from the root barrel**

Replace `packages/hono-preact/src/index.ts` with:

```typescript
export * from '@hono-preact/iso';
export * from '@hono-preact/server';
```

- [ ] **Step 2: Create the separate vite entry**

Create `packages/hono-preact/src/vite.ts`:

```typescript
export * from '@hono-preact/vite';
```

- [ ] **Step 3: Add the ./vite export to package.json**

Update `packages/hono-preact/package.json` `exports` field:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./vite": {
    "types": "./dist/vite.d.ts",
    "import": "./dist/vite.js"
  }
}
```

- [ ] **Step 4: Verify TypeScript builds cleanly**

```bash
pnpm --filter hono-preact build
```

Expected: build succeeds, `dist/index.js` and `dist/vite.js` are generated.

- [ ] **Step 5: Commit**

```bash
git add packages/hono-preact/src/index.ts packages/hono-preact/src/vite.ts packages/hono-preact/package.json
git commit -m "refactor(hono-preact): move Vite plugin exports to hono-preact/vite entry point"
```

---

## Task 9: Add missing render.tsx test coverage (I7)

**Files:**
- Modify: `packages/server/src/__tests__/render.test.tsx`

- [ ] **Step 1: Write tests for meta, link, lang injection**

Add imports to `packages/server/src/__tests__/render.test.tsx`:

```typescript
import { useTitle, useLang, useMeta, useLink } from 'hoofd/preact';
```

Add new page components and tests:

```typescript
function MetaPage() {
  useMeta({ name: 'description', content: 'A test page' });
  return <html><head></head><body></body></html>;
}

function LinkPage() {
  useLink({ rel: 'stylesheet', href: '/styles.css' });
  return <html><head></head><body></body></html>;
}

function LangPage() {
  useLang('fr-FR');
  return <html><head></head><body></body></html>;
}

function NoHeadPage() {
  return <html><body><div>no head tag</div></body></html>;
}
```

Add inside `describe('renderPage', ...)`:

```typescript
it('injects <meta> tags from useMeta into SSR output', async () => {
  const res = await makeApp(MetaPage).request('http://localhost/');
  const html = await res.text();
  expect(html).toContain('<meta name="description"');
  expect(html).toContain('content="A test page"');
});

it('injects <link> tags from useLink into SSR output', async () => {
  const res = await makeApp(LinkPage).request('http://localhost/');
  const html = await res.text();
  expect(html).toContain('<link rel="stylesheet"');
  expect(html).toContain('href="/styles.css"');
});

it('sets the lang attribute from useLang', async () => {
  const res = await makeApp(LangPage).request('http://localhost/');
  const html = await res.text();
  expect(html).toContain('lang="fr-FR"');
});

it('defaults lang to en-US when useLang is not called', async () => {
  const res = await makeApp(UntitledPage).request('http://localhost/');
  const html = await res.text();
  expect(html).toContain('lang="en-US"');
});

it('produces valid HTML when the component has no <head> tag', async () => {
  const res = await makeApp(NoHeadPage).request('http://localhost/');
  expect(res.status).toBe(200);
  // head tags are injected before </head> — if no </head> exists, injection is silently skipped
  // Assert the body content is intact
  const html = await res.text();
  expect(html).toContain('no head tag');
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm test -- packages/server/src/__tests__/render.test.tsx
```

Expected: all new tests pass (meta/link/lang are already supported by render.tsx; this is coverage, not new behavior).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/__tests__/render.test.tsx
git commit -m "test(server): add coverage for meta, link, lang injection and no-head-tag edge case"
```

---

## Task 10: Tighten types — make loaderData required and constrain T (M1, M2)

**Files:**
- Modify: `packages/iso/src/loader.tsx`
- Modify: `packages/iso/src/page.tsx`

- [ ] **Step 1: Run all iso tests to establish baseline**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 2: Make loaderData required in LoaderData<T>**

In `packages/iso/src/loader.tsx`, change lines 8–12 from:

```typescript
export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData?: T;
  route?: string;
}
```

To:

```typescript
export interface LoaderData<T> extends JSX.IntrinsicAttributes {
  id?: string;
  loaderData: T;
  route?: string;
}
```

- [ ] **Step 3: Tighten T extends {} to T extends Record<string, unknown>**

In `packages/iso/src/loader.tsx` line 26, change:

```typescript
export const getLoaderData = <T extends {}>(
```

To:

```typescript
export const getLoaderData = <T extends Record<string, unknown>>(
```

In `packages/iso/src/page.tsx` line 57, change:

```typescript
export const Page = memo(function <T extends {}>({
```

To:

```typescript
export const Page = memo(function <T extends Record<string, unknown>>({
```

In `packages/iso/src/page.tsx` line 101, change:

```typescript
const GuardedPage = memo(function <T extends {}>({
```

To:

```typescript
const GuardedPage = memo(function <T extends Record<string, unknown>>({
```

Also update the default for `serverLoader` (line 104), which uses `({}) as T` — this is fine since `{}` satisfies `Record<string, unknown>`.

- [ ] **Step 4: Update test components to remove unnecessary ?. optional chains**

In `packages/iso/src/__tests__/loader.test.tsx`, the `Child` component uses `loaderData?.msg`. Since `loaderData` is now required, update:

```typescript
function Child({ loaderData }: LoaderData<{ msg: string }>) {
  return <div data-testid="child">{loaderData.msg}</div>;
}
```

(Remove `?? 'no data'` and the `?.` optional chain.)

- [ ] **Step 5: Run all iso tests to verify they pass**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/iso/src/loader.tsx packages/iso/src/page.tsx packages/iso/src/__tests__/loader.test.tsx
git commit -m "fix(iso): make loaderData required in LoaderData<T> and tighten T constraint to Record<string, unknown>"
```

---

## Task 11: Remove unused data-page attribute (M3)

**Files:**
- Modify: `packages/iso/src/page.tsx`

- [ ] **Step 1: Run tests to establish baseline**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 2: Remove data-page from WrapperProps and JSX**

In `packages/iso/src/page.tsx`, remove `'data-page': boolean;` from `WrapperProps` (line 37):

```typescript
export type WrapperProps = {
  id: string;
  'data-loader': string;
  children: ComponentChildren;
};
```

In the `Helper` component JSX (line 226), remove `data-page` from the `Wrapper` props:

```typescript
  return (
    <Wrapper id={id} data-loader={stringified}>
      <Child loaderData={loaderData} id={id} />
    </Wrapper>
  );
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/page.tsx
git commit -m "chore(iso): remove unused data-page attribute from WrapperProps and Helper output"
```

---

## Task 12: Fix serverLoaderValidationPlugin — add export * check and combine errors (M4, M5)

**Files:**
- Modify: `packages/vite/src/server-loader-validation.ts`
- Modify: `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/vite/src/__tests__/server-loader-validation-plugin.test.ts`:

```typescript
it('fails when a *.server.* file uses export * from', () => {
  const code = [
    `export * from './helpers.js';`,
    `export default async function serverLoader() { return {}; }`,
  ].join('\n');
  const { error } = transform(code, 'movies.server.ts');
  expect(error).toContain('export *');
});

it('reports both errors when a file has disallowed exports AND no default export', () => {
  const code = `export const helper = () => {};`;
  const { error } = transform(code, 'movies.server.ts');
  expect(error).toContain('found: helper');
  expect(error).toContain('must have a default export');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- packages/vite/src/__tests__/server-loader-validation-plugin.test.ts
```

Expected: both new tests FAIL.

- [ ] **Step 3: Update serverLoaderValidationPlugin**

Replace all of `packages/vite/src/server-loader-validation.ts`:

```typescript
import { parse } from '@babel/parser';
import type { ExportAllDeclaration, ExportNamedDeclaration } from '@babel/types';
import type { Plugin } from 'vite';

export function serverLoaderValidationPlugin(): Plugin {
  return {
    name: 'server-loader-validation',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!/\.server\.[jt]sx?$/.test(id)) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        errorRecovery: true,
      });

      let hasDefault = false;
      const namedExports: string[] = [];
      const errors: string[] = [];

      for (const node of ast.program.body) {
        if (node.type === 'ExportDefaultDeclaration') {
          hasDefault = true;
        } else if (node.type === 'ExportAllDeclaration') {
          errors.push(
            `${id}: .server files may not use 'export * from ...'. Use explicit named exports only.`
          );
        } else if (node.type === 'ExportNamedDeclaration') {
          const named = node as ExportNamedDeclaration;
          if (named.exportKind === 'type') continue;

          for (const s of named.specifiers) {
            namedExports.push(
              s.exported.type === 'Identifier'
                ? s.exported.name
                : s.exported.value
            );
          }
          if (
            named.declaration?.type === 'FunctionDeclaration' &&
            named.declaration.id
          ) {
            namedExports.push(named.declaration.id.name);
          } else if (named.declaration?.type === 'VariableDeclaration') {
            for (const decl of named.declaration.declarations) {
              if (decl.id.type === 'Identifier')
                namedExports.push(decl.id.name);
            }
          }
        }
      }

      const disallowedExports = namedExports.filter((n) => n !== 'serverGuards');
      if (disallowedExports.length > 0) {
        errors.push(
          `${id}: .server files may only export 'serverGuards' as a named export (found: ${disallowedExports.join(', ')}). ` +
            `Export the server loader as the default export only.`
        );
      }
      if (!hasDefault) {
        errors.push(
          `${id}: .server files must have a default export. ` +
            `Export the server loader as: export default async function serverLoader(...) { ... }`
        );
      }

      if (errors.length > 0) {
        this.error(errors.join('\n'));
      }
    },
  };
}
```

- [ ] **Step 4: Run all vite tests to verify they pass**

```bash
pnpm test -- packages/vite
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/vite/src/server-loader-validation.ts packages/vite/src/__tests__/server-loader-validation-plugin.test.ts
git commit -m "fix(vite): detect export * in .server files and report all validation errors in one throw"
```

---

## Task 13: Add direct unit tests for preload.ts (M6)

**Files:**
- Create: `packages/iso/src/__tests__/preload.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Remove preload.ts from coverage exclusion list**

In `vitest.config.ts`, remove `'packages/iso/src/preload.ts',` from the `coverage.exclude` array:

```typescript
exclude: [
  'packages/*/src/__tests__/**',
  'packages/iso/src/index.ts',
  'packages/server/src/index.ts',
  'packages/server/src/context.ts',
  'packages/hono-preact/**',
],
```

- [ ] **Step 2: Create preload.test.ts**

Create `packages/iso/src/__tests__/preload.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { getPreloadedData, deletePreloadedData } from '../preload.js';
import { env } from '../is-browser.js';

function makeElement(id: string, loaderJson?: string): HTMLElement {
  const el = document.createElement('section');
  el.id = id;
  if (loaderJson !== undefined) {
    el.dataset.loader = loaderJson;
  }
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  env.current = 'browser';
});

describe('getPreloadedData', () => {
  it('returns null when not in browser', () => {
    env.current = 'server';
    makeElement('test-id', '{"msg":"hi"}');
    expect(getPreloadedData('test-id')).toBeNull();
  });

  it('returns null when the element does not exist', () => {
    expect(getPreloadedData('no-such-id')).toBeNull();
  });

  it('returns null when the element has no data-loader attribute', () => {
    makeElement('test-id'); // no loaderJson
    expect(getPreloadedData('test-id')).toBeNull();
  });

  it('returns the parsed object when data-loader contains valid JSON', () => {
    makeElement('test-id', '{"msg":"hello"}');
    expect(getPreloadedData('test-id')).toEqual({ msg: 'hello' });
  });

  it('returns an empty object when data-loader is "{}"', () => {
    makeElement('test-id', '{}');
    expect(getPreloadedData('test-id')).toEqual({});
  });

  it('returns null when data-loader contains malformed JSON', () => {
    makeElement('test-id', '{not valid json}');
    expect(getPreloadedData('test-id')).toBeNull();
  });

  it('deletes data-loader from the element after reading (finally block)', () => {
    const el = makeElement('test-id', '{"msg":"hi"}');
    getPreloadedData('test-id');
    expect(el.dataset.loader).toBeUndefined();
  });

  it('deletes data-loader even when JSON parse throws', () => {
    const el = makeElement('test-id', '{bad}');
    getPreloadedData('test-id');
    expect(el.dataset.loader).toBeUndefined();
  });

  it('returns null on a second call to the same id (data was deleted on first call)', () => {
    makeElement('test-id', '{"msg":"hi"}');
    getPreloadedData('test-id');
    expect(getPreloadedData('test-id')).toBeNull();
  });
});

describe('deletePreloadedData', () => {
  it('removes data-loader from an existing element', () => {
    const el = makeElement('test-id', '{"x":1}');
    deletePreloadedData('test-id');
    expect(el.dataset.loader).toBeUndefined();
  });

  it('does nothing when the element does not exist', () => {
    expect(() => deletePreloadedData('no-such-id')).not.toThrow();
  });
});
```

- [ ] **Step 3: Run new tests to verify they pass**

```bash
pnpm test -- packages/iso/src/__tests__/preload.test.ts
```

Expected: all 11 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/__tests__/preload.test.ts vitest.config.ts
git commit -m "test(iso): add direct unit tests for preload.ts and include it in coverage"
```

---

## Task 14: Stabilize reload() callback by using refs for clientLoader and location (M7)

**Files:**
- Modify: `packages/iso/src/page.tsx`

- [ ] **Step 1: Run tests to establish baseline**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 2: Update the reload callback in GuardedPage**

In `packages/iso/src/page.tsx`, after the `prevPath` ref (around line 116), add refs for the unstable dependencies:

```typescript
  const prevPath = useRef(location.path);
  if (prevPath.current !== location.path) {
    prevPath.current = location.path;
    setOverrideData(undefined);
  }

  const clientLoaderRef = useRef(clientLoader);
  clientLoaderRef.current = clientLoader;
  const locationRef = useRef(location);
  locationRef.current = location;
```

Update the `reload` callback to use the refs and remove them from the dependency array:

```typescript
  const reload = useCallback(() => {
    if (reloading) return;
    setReloading(true);
    setLoadError(null);
    clientLoaderRef.current({ location: locationRef.current })
      .then((result) => {
        setOverrideData(result);
        setReloading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err : new Error(String(err)));
        setReloading(false);
      });
  }, [reloading]);
```

- [ ] **Step 3: Run all iso tests to verify they pass**

```bash
pnpm test -- packages/iso
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/iso/src/page.tsx
git commit -m "fix(iso): stabilize reload() callback identity using refs for clientLoader and location"
```

---

## Self-Review

### Spec Coverage Check

| Issue | Task | Covered? |
|---|---|---|
| C1 — XSS title/lang | T1 | ✅ |
| C2 — Hydration sentinel | T2 | ✅ |
| C3 — Multi-import stubbing | T3 | ✅ |
| I1 — Stale guards | T4 | ✅ |
| I2 — Reload error exposure | T5 | ✅ |
| I3 — env.current in renderPage | T6 | ✅ |
| I4 — wrapPromise type hole | T7 | ✅ |
| I5 — Barrel vite re-export | T8 | ✅ |
| I6 — isLoaded edge cases | T2 (fixed + tested) | ✅ |
| I7 — render.tsx test gaps | T9 | ✅ |
| M1 — loaderData required | T10 | ✅ |
| M2 — T extends {} | T10 | ✅ |
| M3 — data-page unused | T11 | ✅ |
| M4 — export * validation | T12 | ✅ |
| M5 — Sequential this.error() | T12 | ✅ |
| M6 — preload.ts tests | T13 | ✅ |
| M7 — reload callback stability | T14 | ✅ |

### Dependency Order Notes

- T2 must come before T10 (T10 test updates assume `getPreloadedData` returns `null` not `{}`)
- T5 must come before T14 (T14 modifies the `reload` callback body that T5 first adds `setLoadError` to)
- All other tasks are independent
