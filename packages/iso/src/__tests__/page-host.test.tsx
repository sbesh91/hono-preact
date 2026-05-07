// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { PageHost } from '../page-host.js';
import { setLatestFragment, clearLatestFragment, registerRouteMode } from '../navigator.js';

afterEach(cleanup);

const loc = { path: '/docs/x', url: '/docs/x', searchParams: {}, pathParams: { slug: 'x' } } as RouteHook;

describe('PageHost (pre-island)', () => {
  it('renders the user component with location prop', () => {
    function User(props: RouteHook) {
      return <p data-testid="page">slug={props.pathParams!.slug}</p>;
    }
    render(
      <LocationProvider>
        <PageHost component={User} location={loc} path="/docs/:slug" />
      </LocationProvider>
    );
    expect(screen.getByTestId('page')).toHaveTextContent('slug=x');
  });
});

describe('PageHost (island mode)', () => {
  beforeEach(() => clearLatestFragment());

  it('splices fragment HTML and hydrates the user component into the host div', async () => {
    function User(props: RouteHook) {
      return <p data-testid="island">island slug={props.pathParams!.slug}</p>;
    }
    const { container } = render(
      <LocationProvider>
        <PageHost component={User} location={loc} path="/docs/:slug" />
      </LocationProvider>
    );
    // Server-rendered fragment: a <p> with the same shape as User would
    // produce, so hydrate matches.
    setLatestFragment('/docs/:slug', '<p data-testid="island">island slug=x</p>');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('island')).toHaveTextContent('island slug=x');
    // The host div is the only child rendered by the outer tree; the <p> is
    // inside it as a hydrated island.
    const host = container.querySelector('[data-hp-island="true"]');
    expect(host).not.toBeNull();
    expect(host!.querySelector('p')).not.toBeNull();
  });

  it('outer rerender with new location does not blank the host innerHTML', async () => {
    function User(props: RouteHook) {
      return <p data-testid="island">island slug={props.pathParams!.slug}</p>;
    }
    registerRouteMode('/docs/:slug', 'ssr');
    const loc1 = { ...loc, pathParams: { slug: 'x' } } as RouteHook;
    const loc2 = { ...loc, pathParams: { slug: 'y' }, path: '/docs/y', url: '/docs/y' } as RouteHook;

    const { rerender, container } = render(
      <LocationProvider>
        <PageHost component={User} location={loc1} path="/docs/:slug" />
      </LocationProvider>
    );

    setLatestFragment('/docs/:slug', '<p data-testid="island">island slug=x</p>');
    await new Promise((r) => setTimeout(r, 0));
    const host = container.querySelector('[data-hp-island="true"]') as HTMLDivElement;
    expect(host).not.toBeNull();
    expect(host.innerHTML.length).toBeGreaterThan(0);

    // Rerender outer tree with a new location prop.
    rerender(
      <LocationProvider>
        <PageHost component={User} location={loc2} path="/docs/:slug" />
      </LocationProvider>
    );

    // The host element is the same DOM node and its innerHTML has been
    // re-hydrated by the useLayoutEffect (because location changed),
    // but it MUST NOT have been blanked by Preact's outer reconciler
    // between the rerender and the layout effect.
    const sameHost = container.querySelector('[data-hp-island="true"]') as HTMLDivElement;
    expect(sameHost).toBe(host);
    expect(sameHost.innerHTML.length).toBeGreaterThan(0);
  });
});
