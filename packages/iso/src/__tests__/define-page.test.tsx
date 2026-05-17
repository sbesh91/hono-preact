// @vitest-environment happy-dom
import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import type { JSX } from 'preact';
import type { Context } from 'hono';
import { definePage, type PageBindings } from '../define-page.js';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsContext } from '../internal/route-locations.js';
import {
  defineServerGuard,
  defineClientGuard,
  type GuardFn,
} from '../guard.js';
import { HonoRequestContext } from '../internal/contexts.js';

const fakeC = {} as Context;

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

// Suppress isBrowser in tests so Loader uses fn() directly rather than fetch.
vi.mock('../is-browser.js', () => ({
  isBrowser: () => false,
  env: { current: 'server' },
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
  it('renders a loader.View component placed inside the page body', async () => {
    const loader = defineLoader(async () => ({ msg: 'hello' }), {
      __moduleKey: 'test/define-page-loader-view',
    });

    const locMap = new Map();
    locMap.set('test/define-page-loader-view', fakeLocation);

    const Body = loader.View(
      ({ data }) => <p data-testid="msg">{data.msg}</p>,
      { fallback: <p>loading</p> }
    );

    function PageBody() {
      return <Body />;
    }

    const PageRoute = definePage(PageBody);

    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <RouteLocationsContext.Provider value={locMap}>
          <LocationProvider>
            <PageRoute {...fakeLocation} />
          </LocationProvider>
        </RouteLocationsContext.Provider>
      </HonoRequestContext.Provider>
    );

    expect(await screen.findByTestId('msg')).toHaveTextContent('hello');
  });

  it('returns a routable component for a binding-less page', async () => {
    function Body() {
      return <p>plain</p>;
    }
    const PageRoute = definePage(Body);
    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <LocationProvider>
          <PageRoute {...fakeLocation} />
        </LocationProvider>
      </HonoRequestContext.Provider>
    );
    expect(await screen.findByText('plain')).toBeInTheDocument();
  });

  it('threads errorFallback and guards into <Page>', async () => {
    const sg = defineServerGuard(async (_ctx, next) => next());
    const cg = defineClientGuard(async (_ctx, next) => next());
    const bindings: PageBindings = {
      errorFallback: (err, reset) => (
        <button onClick={reset}>{err.message}</button>
      ),
      guards: [sg, cg],
    };
    function Body() {
      return <p>ok</p>;
    }
    const PageRoute = definePage(Body, bindings);
    render(
      <HonoRequestContext.Provider value={{ context: fakeC }}>
        <LocationProvider>
          <PageRoute {...fakeLocation} />
        </LocationProvider>
      </HonoRequestContext.Provider>
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

describe('PageBindings surface', () => {
  it('accepts errorFallback and guards on the bindings type', () => {
    const guard = defineServerGuard(async (_ctx, next) => next());
    const bindings: PageBindings = {
      errorFallback: (err, reset) => (
        <button onClick={reset}>{err.message}</button>
      ),
      guards: [guard],
    };
    expectTypeOf(bindings.errorFallback).toMatchTypeOf<
      | JSX.Element
      | ((error: Error, reset: () => void) => JSX.Element)
      | undefined
    >();
    expectTypeOf(bindings.guards).toEqualTypeOf<GuardFn[] | undefined>();
  });
});
