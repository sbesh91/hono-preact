// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/preact';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { Route, Router, wrapWithPage } from '../route.js';
import { useLoaderData } from '../use-loader-data.js';
import { env } from '../is-browser.js';
import { definePage } from '../define-page.js';
import { lazy } from '../lazy.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  window.history.pushState({}, '', '/');
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

describe('wrapWithPage', () => {
  it('renders the component inside <Page> with no loader (no-data page)', async () => {
    const Inner = () => <p data-testid="inner">hello</p>;
    const Wrapped = wrapWithPage(Inner, {});
    render(
      <LocationProvider>
        <Wrapped {...loc} />
      </LocationProvider>
    );
    const el = await screen.findByTestId('inner');
    expect(el).toHaveTextContent('hello');
  });

  it('renders the component with loader data via useLoaderData', async () => {
    const fn = vi.fn(async () => ({ msg: 'ok' }));
    const ref = defineLoader<{ msg: string }>(fn, { __moduleKey: 'wrap-with-page-test' });
    const Inner = () => {
      const { msg } = useLoaderData<typeof ref>();
      return <p data-testid="msg">{msg}</p>;
    };
    const Page = definePage(Inner, { loader: ref });
    const Wrapped = wrapWithPage(Page, {});
    render(
      <LocationProvider>
        <Wrapped {...loc} />
      </LocationProvider>
    );
    const el = await screen.findByText('ok');
    expect(el).toBeInTheDocument();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('<Router> + <Route>', () => {
  it('renders the matched route wrapped in <Page> with loader data', async () => {
    const fn = vi.fn(async () => ({ msg: 'foo-data' }));
    const ref = defineLoader<{ msg: string }>(fn, { __moduleKey: 'router-route-test' });
    const Foo = () => {
      const { msg } = useLoaderData<typeof ref>();
      return <p data-testid="foo">{msg}</p>;
    };
    const Page = definePage(Foo, { loader: ref });

    window.history.pushState({}, '', '/foo');
    render(
      <LocationProvider>
        <Router>
          <Route path="/foo" component={Page} />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('foo');
    expect(el).toHaveTextContent('foo-data');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes non-Route children through unchanged (e.g. default fallback)', async () => {
    const Foo = () => <p data-testid="foo">foo</p>;
    const Default = (_props: { default?: boolean }) => (
      <p data-testid="default">not found</p>
    );

    window.history.pushState({}, '', '/nope');
    render(
      <LocationProvider>
        <Router>
          <Route path="/foo" component={Foo} />
          <Default default />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('default');
    expect(el).toHaveTextContent('not found');
    expect(screen.queryByTestId('foo')).toBeNull();
  });

  it('renders nothing when no route path matches', async () => {
    const Foo = () => <p data-testid="foo">foo</p>;

    window.history.pushState({}, '', '/nope');
    render(
      <LocationProvider>
        <Router>
          <Route path="/foo" component={Foo} />
        </Router>
      </LocationProvider>
    );

    expect(screen.queryByTestId('foo')).toBeNull();
  });

  it('reads loader/cache/Wrapper from PAGE_BINDINGS on the component', async () => {
    const fn = vi.fn(async () => ({ msg: 'page-data' }));
    const ref = defineLoader<{ msg: string }>(fn, { __moduleKey: 'page-bindings-test' });

    const Inner = () => {
      const { msg } = useLoaderData<typeof ref>();
      return <p data-testid="page">{msg}</p>;
    };
    const Wrapped = definePage(Inner, { loader: ref });

    window.history.pushState({}, '', '/page');
    render(
      <LocationProvider>
        <Router>
          <Route path="/page" component={Wrapped} />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('page');
    expect(el).toHaveTextContent('page-data');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reads PAGE_BINDINGS off a lazy component once resolved', async () => {
    const fn = vi.fn(async () => ({ msg: 'lazy-data' }));
    const ref = defineLoader<{ msg: string }>(fn, { __moduleKey: 'page-bindings-lazy-test' });

    const Inner = () => {
      const { msg } = useLoaderData<typeof ref>();
      return <p data-testid="lazy-page">{msg}</p>;
    };
    const Wrapped = definePage(Inner, { loader: ref });
    const Lazy = lazy(async () => ({ default: Wrapped }));

    window.history.pushState({}, '', '/lazy');
    render(
      <LocationProvider>
        <Router>
          <Route path="/lazy" component={Lazy} />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('lazy-page');
    expect(el).toHaveTextContent('lazy-data');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('renders a component with no PAGE_BINDINGS without a loader (no-data page)', async () => {
    const Inner = () => <p data-testid="bare">no-data</p>;

    window.history.pushState({}, '', '/bare');
    render(
      <LocationProvider>
        <Router>
          <Route path="/bare" component={Inner} />
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('bare');
    expect(el).toHaveTextContent('no-data');
  });
});

describe('<Route> rendered directly', () => {
  it('returns null and renders nothing', () => {
    const Foo = () => <p data-testid="foo">foo</p>;
    const { container } = render(<Route path="/foo" component={Foo} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('Route symbol marker', () => {
  it('marks Route with a cross-realm-safe Symbol identity', () => {
    const marker = Symbol.for('@hono-preact/iso/Route');
    expect((Route as unknown as Record<symbol, unknown>)[marker]).toBe(true);
  });
});

describe('<Router> Fragment recursion', () => {
  it('matches a <Route> nested inside an explicit <Fragment>', async () => {
    const Foo = () => <p data-testid="foo">foo-frag</p>;

    window.history.pushState({}, '', '/foo');
    render(
      <LocationProvider>
        <Router>
          <Fragment>
            <Route path="/foo" component={Foo} />
          </Fragment>
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('foo');
    expect(el).toHaveTextContent('foo-frag');
  });

  it('matches a <Route> nested inside a short-form <>...</> fragment', async () => {
    const Foo = () => <p data-testid="foo">foo-short</p>;
    const Bar = () => <p data-testid="bar">bar-short</p>;

    window.history.pushState({}, '', '/bar');
    render(
      <LocationProvider>
        <Router>
          <>
            <Route path="/foo" component={Foo} />
            <Route path="/bar" component={Bar} />
          </>
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('bar');
    expect(el).toHaveTextContent('bar-short');
    expect(screen.queryByTestId('foo')).toBeNull();
  });

  it('matches a <Route> nested inside a Fragment inside a Fragment', async () => {
    const Foo = () => <p data-testid="foo">foo-deep</p>;

    window.history.pushState({}, '', '/foo');
    render(
      <LocationProvider>
        <Router>
          <Fragment>
            <>
              <Fragment>
                <Route path="/foo" component={Foo} />
              </Fragment>
            </>
          </Fragment>
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('foo');
    expect(el).toHaveTextContent('foo-deep');
  });

  it('still matches a conditional `cond && <Route />` (regression)', async () => {
    const Foo = () => <p data-testid="foo">foo-cond</p>;
    const enabled = true;

    window.history.pushState({}, '', '/foo');
    render(
      <LocationProvider>
        <Router>
          {enabled && <Route path="/foo" component={Foo} />}
        </Router>
      </LocationProvider>
    );

    const el = await screen.findByTestId('foo');
    expect(el).toHaveTextContent('foo-cond');
  });
});

describe('<Router> re-render stability', () => {
  it('does not remount the route component when Router re-renders', async () => {
    let mountCount = 0;
    const Counter = () => {
      const [count, setCount] = useState(0);
      if (count === 0 && mountCount === 0) mountCount++;
      return (
        <div>
          <span data-testid="count">{count}</span>
          <button data-testid="bump" onClick={() => setCount((c) => c + 1)}>
            bump
          </button>
        </div>
      );
    };

    // Wrap Router in a component that we can re-render externally
    let triggerOuterRender!: () => void;
    function Outer() {
      const [, force] = useState(0);
      triggerOuterRender = () => force((n) => n + 1);
      return (
        <Router>
          <Route path="/x" component={Counter} />
        </Router>
      );
    }

    window.history.pushState({}, '', '/x');
    render(
      <LocationProvider>
        <Outer />
      </LocationProvider>
    );

    await screen.findByTestId('count');
    // Bump the inner state to a non-zero value
    await act(async () => {
      screen.getByTestId('bump').click();
      screen.getByTestId('bump').click();
    });
    expect(screen.getByTestId('count')).toHaveTextContent('2');

    // Force the outer (and thus the Router) to re-render
    await act(async () => {
      triggerOuterRender();
      triggerOuterRender();
    });

    // If the route component remounted, the count would reset to 0
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });
});
