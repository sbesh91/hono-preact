// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { RouteManifestContext } from '../internal/route-manifest.js';
import { usePrefetch } from '../use-prefetch.js';
import { defineLoader } from '../define-loader.js';
import type { FlatRoute } from '../define-routes.js';
import type { LoaderRef } from '../define-loader.js';

const prefetchSpy = vi.fn();
vi.mock('../prefetch.js', () => ({
  prefetch: (...args: unknown[]) => prefetchSpy(...args),
}));

beforeEach(() => prefetchSpy.mockClear());
afterEach(cleanup);

const FLAT: ReadonlyArray<FlatRoute> = [
  {
    path: '/demo/projects/:projectId/issues/:issueId',
    component: () => null,
    key: 'k1',
  },
];

const ref = defineLoader(async () => ({ ok: true }), { __moduleKey: 'pf' });

function Harness({
  href,
  refs,
}: {
  href: string;
  refs: LoaderRef<unknown> | ReadonlyArray<LoaderRef<unknown>>;
}) {
  const prefetch = usePrefetch(href, refs);
  return <button onClick={prefetch}>go</button>;
}

function renderIn(href: string, refs: LoaderRef<unknown>) {
  return render(
    <RouteManifestContext.Provider value={FLAT}>
      <Harness href={href} refs={refs} />
    </RouteManifestContext.Provider>
  );
}

describe('usePrefetch', () => {
  it('resolves params from the manifest and prefetches the loader', () => {
    const { getByRole } = renderIn('/demo/projects/p1/issues/i1', ref);
    fireEvent.click(getByRole('button'));
    expect(prefetchSpy).toHaveBeenCalledWith(ref, {
      location: {
        path: '/demo/projects/p1/issues/i1',
        pathParams: { projectId: 'p1', issueId: 'i1' },
        searchParams: {},
      },
    });
  });

  it('is a no-op when no manifest route matches', () => {
    const { getByRole } = renderIn('/nope', ref);
    fireEvent.click(getByRole('button'));
    expect(prefetchSpy).not.toHaveBeenCalled();
  });
});
