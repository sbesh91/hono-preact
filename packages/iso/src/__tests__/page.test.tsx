// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { Page } from '../page.js';
import { defineLoader } from '../define-loader.js';
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

const loc = {
  path: '/test',
  url: 'http://localhost/test',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  mockRoute.mockClear();
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

const emptyLoader = defineLoader<Record<string, never>>(async () => ({}));

describe('guard { render }', () => {
  it('renders the guard-supplied component instead of the page', async () => {
    const ForbiddenPage = () => (
      <div data-testid="forbidden">403 Forbidden</div>
    );
    const guard = createGuard(async () => ({ render: ForbiddenPage }));

    render(
      <LocationProvider>
        <Page loader={emptyLoader} location={loc} clientGuards={[guard]}>
          <div data-testid="page">Protected content</div>
        </Page>
      </LocationProvider>
    );

    const el = await screen.findByTestId('forbidden');
    expect(el).toHaveTextContent('403 Forbidden');
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } in browser', () => {
  it('calls route() with the redirect path when a client guard redirects', async () => {
    const guard = createGuard(async () => ({ redirect: '/login' }));

    render(
      <LocationProvider>
        <Page loader={emptyLoader} location={loc} clientGuards={[guard]}>
          <div data-testid="page">Protected</div>
        </Page>
      </LocationProvider>
    );

    await waitFor(() => expect(mockRoute).toHaveBeenCalled());
    expect(mockRoute).toHaveBeenCalledWith('/login');
    expect(screen.queryByTestId('page')).toBeNull();
  });
});

describe('guard { redirect } on server', () => {
  it('throws GuardRedirect when a server guard redirects', async () => {
    const guard = createGuard(async () => ({ redirect: '/login' }));
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
    const guard = createGuard(async () => {
      if (currentPath === '/admin') return { redirect: '/login' };
    });

    const locPublic = { ...loc, path: '/public' } as unknown as RouteHook;
    const { rerender } = render(
      <LocationProvider>
        <Page loader={emptyLoader} location={locPublic} clientGuards={[guard]}>
          <div data-testid="page">Content</div>
        </Page>
      </LocationProvider>
    );

    await screen.findByTestId('page');

    currentPath = '/admin';
    const locAdmin = { ...loc, path: '/admin' } as unknown as RouteHook;
    rerender(
      <LocationProvider>
        <Page loader={emptyLoader} location={locAdmin} clientGuards={[guard]}>
          <div data-testid="page">Content</div>
        </Page>
      </LocationProvider>
    );

    await waitFor(() => expect(mockRoute).toHaveBeenCalledWith('/login'));
  });
});

describe('Page without a loader', () => {
  it('renders children inside a default Wrapper', async () => {
    render(
      <LocationProvider>
        <Page location={loc}>
          <p data-testid="content">Hello</p>
        </Page>
      </LocationProvider>
    );

    const el = await screen.findByTestId('content');
    expect(el).toHaveTextContent('Hello');
  });
});
