// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { RouteManifestContext } from '../internal/route-manifest.js';
import { usePrefetch } from '../use-prefetch.js';
import { defineLoader } from '../define-loader.js';
import { defineRoutes } from '../define-routes.js';
import type { AnyLoaderRef } from '../define-loader.js';

const prefetchSpy = vi.fn();
vi.mock('../prefetch.js', () => ({
  prefetch: (...args: unknown[]) => prefetchSpy(...args),
}));

beforeEach(() => prefetchSpy.mockClear());
afterEach(cleanup);

// Build the manifest the way an app does: a layout group with a nested leaf
// that has a server module. The leaf pattern lives in `serverRoutes`, NOT in
// `flat` (flat only has the group `/demo` and `/demo/*`).
const manifest = defineRoutes([
  {
    path: '/demo',
    layout: () =>
      Promise.resolve({
        default: ({ children }: { children: unknown }) => children as never,
      }),
    children: [
      {
        path: 'projects/:projectId/issues/:issueId',
        view: () => Promise.resolve({ default: () => null }),
        server: () => Promise.resolve({}),
      },
    ],
  },
]);

const ref = defineLoader(async () => ({ ok: true }), { __moduleKey: 'pf' });

function Harness({
  href,
  refs,
}: {
  href: string;
  refs: AnyLoaderRef | ReadonlyArray<AnyLoaderRef>;
}) {
  const prefetch = usePrefetch(href, refs);
  return <button onClick={prefetch}>go</button>;
}

function renderIn(href: string, refs: AnyLoaderRef) {
  return render(
    <RouteManifestContext.Provider value={manifest.serverRoutes}>
      <Harness href={href} refs={refs} />
    </RouteManifestContext.Provider>
  );
}

// The hook loads `prefetch.js` through a dynamic `import()` (it is deferred so
// a NavLink that never prefetches does not ship it), so the call lands a
// microtask after the click rather than synchronously inside the handler.
const flushDynamicImport = () => new Promise((r) => setTimeout(r, 0));

describe('usePrefetch', () => {
  it('resolves nested-leaf params from the manifest and prefetches the loader', async () => {
    const { getByRole } = renderIn('/demo/projects/p1/issues/i1', ref);
    fireEvent.click(getByRole('button'));
    await flushDynamicImport();
    expect(prefetchSpy).toHaveBeenCalledWith(ref, {
      location: {
        path: '/demo/projects/p1/issues/i1',
        pathParams: { projectId: 'p1', issueId: 'i1' },
        searchParams: {},
      },
    });
  });

  it('is a no-op when no manifest route matches', async () => {
    const { getByRole } = renderIn('/nope', ref);
    fireEvent.click(getByRole('button'));
    await flushDynamicImport();
    expect(prefetchSpy).not.toHaveBeenCalled();
  });
});
