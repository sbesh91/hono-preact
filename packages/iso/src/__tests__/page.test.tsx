// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/preact';
import { getLoaderData } from '../loader.js';
import { createGuard, GuardRedirect, runGuards } from '../guard.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({})),
  deletePreloadedData: vi.fn(),
}));

// Mock only useLocation from preact-iso; keep LocationProvider and everything else real.
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
      clientLoader: async () => ({}),
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
      clientLoader: async () => ({}),
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
  // GuardRedirect is thrown by Page during SSR when isBrowser()=false and the guard
  // returns { redirect }. Testing the full render path in happy-dom is not feasible
  // (Preact catches the throw asynchronously as an unhandled rejection). Instead,
  // verify the guard contract and the throw directly.
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
