// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { h } from 'preact';
import { render, waitFor } from '@testing-library/preact';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';

// In happy-dom, isBrowser() returns true, which would cause LoaderHost to
// use the fetch path (POST /__loaders) instead of calling the fn directly.
// That path requires a running server, so mock it off for unit tests.
vi.mock('../is-browser.js', () => ({
  isBrowser: () => false,
  env: { current: 'server' },
}));

describe('LoaderRef.Boundary', () => {
  it('renders the loader fallback then transitions to children with data', async () => {
    let resolveData: (v: { value: number }) => void = () => {};
    const ref = defineLoader<{ value: number }>(
      () => new Promise((res) => { resolveData = res; }),
      { __moduleKey: 'pages/test-boundary' }
    );

    const Probe = () => {
      const data = ref.useData();
      return <span data-testid="data">{data.value}</span>;
    };

    const locMap = new Map();
    locMap.set('pages/test-boundary', { path: '/', pathParams: {}, searchParams: {} });

    const tree = (
      <RouteLocationsContext.Provider value={locMap}>
        <ref.Boundary fallback={<span data-testid="fallback">loading</span>}>
          <Probe />
        </ref.Boundary>
      </RouteLocationsContext.Provider>
    );

    const { findByTestId, queryByTestId } = render(tree);
    expect(queryByTestId('fallback')).not.toBeNull();
    resolveData({ value: 42 });
    const el = await findByTestId('data');
    expect(el.textContent).toBe('42');
  });
});
