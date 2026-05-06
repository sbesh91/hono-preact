// @vitest-environment happy-dom
import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import type { JSX } from 'preact';
import { definePage, type PageBindings } from '../define-page.js';
import { defineLoader } from '../define-loader.js';
import type { GuardFn } from '../guard.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const fakeLocation: RouteHook = {
  url: '/test',
  path: '/test',
  query: '',
  pathParams: {},
  searchParams: {},
  route: () => {},
} as RouteHook;

describe('definePage', () => {
  it('returns a routable component that self-wraps in <Page>', async () => {
    const loader = defineLoader(async () => ({ msg: 'hello' }));
    function Body() {
      return <p>body</p>;
    }
    const PageRoute = definePage(Body, { loader });
    render(
      <LocationProvider>
        <PageRoute {...fakeLocation} />
      </LocationProvider>
    );
    expect(await screen.findByText('body')).toBeInTheDocument();
  });

  it('returns a routable component for a binding-less page', async () => {
    function Body() {
      return <p>plain</p>;
    }
    const PageRoute = definePage(Body);
    render(
      <LocationProvider>
        <PageRoute {...fakeLocation} />
      </LocationProvider>
    );
    expect(await screen.findByText('plain')).toBeInTheDocument();
  });

  it('threads fallback, errorFallback, serverGuards, clientGuards into <Page>', async () => {
    const guard: GuardFn = async (_ctx, next) => next();
    const bindings: PageBindings<{ ok: true }> = {
      fallback: <p>loading-state</p>,
      serverGuards: [guard],
      clientGuards: [guard],
    };
    function Body() {
      return <p>ok</p>;
    }
    const PageRoute = definePage(Body, bindings);
    render(
      <LocationProvider>
        <PageRoute {...fakeLocation} />
      </LocationProvider>
    );
    expect(await screen.findByText('ok')).toBeInTheDocument();
  });

  it('preserves the wrapped component name in displayName for debuggability', () => {
    function Movies() {
      return <p>movies</p>;
    }
    Movies.displayName = 'Movies';
    const PageRoute = definePage(Movies);
    expect(PageRoute.displayName).toBe('definePage(Movies)');
  });
});

describe('PageBindings widened surface', () => {
  it('accepts fallback, errorFallback, serverGuards, clientGuards on the bindings type', () => {
    const guard: GuardFn = async (_ctx, next) => next();
    const bindings: PageBindings<{ ok: true }> = {
      fallback: <p>loading</p>,
      errorFallback: (err, reset) => <button onClick={reset}>{err.message}</button>,
      serverGuards: [guard],
      clientGuards: [guard],
    };
    expectTypeOf(bindings.fallback).toEqualTypeOf<JSX.Element | undefined>();
    expectTypeOf(bindings.errorFallback).toMatchTypeOf<
      JSX.Element | ((error: Error, reset: () => void) => JSX.Element) | undefined
    >();
    expectTypeOf(bindings.serverGuards).toEqualTypeOf<GuardFn[] | undefined>();
    expectTypeOf(bindings.clientGuards).toEqualTypeOf<GuardFn[] | undefined>();
  });
});
