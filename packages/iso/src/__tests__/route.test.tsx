// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, Router } from 'preact-iso';
import { Route } from '../route.js';
import {
  lookupRouteMode,
  clearRegistry,
  setLatestFragment,
  clearLatestFragment,
  findMatchingPattern,
  uninstallClickInterceptor,
} from '../navigator.js';

beforeEach(() => {
  clearRegistry();
  clearLatestFragment();
  window.history.pushState({}, '', '/');
});
afterEach(() => {
  cleanup();
  uninstallClickInterceptor();
});

describe('<Route> wrapper', () => {
  it('passes through to preact-iso Route when navigate is omitted', async () => {
    function Page() { return <p data-testid="spa">spa</p>; }
    window.history.pushState({}, '', '/spa');
    render(
      <LocationProvider>
        {/* Router expects NestedArray<VNode> children; wrap in array to satisfy the type */}
        <Router>{[<Route key="r" path="/spa" component={Page} />]}</Router>
      </LocationProvider>
    );
    expect(await screen.findByTestId('spa')).toHaveTextContent('spa');
    expect(lookupRouteMode('/spa')).toBe('spa');
  });

  it('registers SSR mode when navigate="ssr"', () => {
    function Page() { return null; }
    render(
      <LocationProvider>
        <Router>{[<Route key="r" path="/docs/:slug" component={Page} navigate="ssr" />]}</Router>
      </LocationProvider>
    );
    expect(lookupRouteMode('/docs/intro')).toBe('ssr');
  });

  it('does not register the matched URL as an additional pattern after navigation', async () => {
    function Page(props: any) {
      return <p data-testid="x">slug={props.pathParams.slug}</p>;
    }
    window.history.pushState({}, '', '/docs/intro');
    render(
      <LocationProvider>
        <Router>{[<Route key="r" path="/docs/:slug" component={Page} navigate="ssr" />]}</Router>
      </LocationProvider>
    );
    await screen.findByTestId('x');
    expect(findMatchingPattern('/docs/intro')).toBe('/docs/:slug');
  });

  it('substitutes PageHost for SSR routes', async () => {
    function Page(props: any) {
      return <p data-testid="spa-render">spa-render slug={props.pathParams.slug}</p>;
    }
    window.history.pushState({}, '', '/docs/intro');
    render(
      <LocationProvider>
        <Router>{[<Route key="r" path="/docs/:slug" component={Page} navigate="ssr" />]}</Router>
      </LocationProvider>
    );
    // Pre-island: same as SPA-mode
    expect(await screen.findByTestId('spa-render')).toHaveTextContent('spa-render slug=intro');

    // Island: deliver a fragment matching that path pattern. After delivery,
    // PageHost switches to the host div. The data-testid attribute from the
    // server HTML is preserved during hydration (Preact skips attribute updates
    // in hydrate mode); text content comes from the hydrated component.
    setLatestFragment('/docs/:slug', '<p data-testid="island-render">spa-render slug=intro</p>');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('island-render')).toHaveTextContent('spa-render slug=intro');
  });
});
