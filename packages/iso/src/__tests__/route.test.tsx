// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { Route, Router, wrapWithPage } from '../route.js';
import { useLoaderData } from '../use-loader-data.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  query: {},
  params: {},
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
    const ref = defineLoader<{ msg: string }>(fn);
    const Inner = () => {
      const { msg } = useLoaderData(ref);
      return <p data-testid="msg">{msg}</p>;
    };
    const Wrapped = wrapWithPage(Inner, { loader: ref });
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
    const ref = defineLoader<{ msg: string }>(fn);
    const Foo = () => {
      const { msg } = useLoaderData(ref);
      return <p data-testid="foo">{msg}</p>;
    };

    window.history.pushState({}, '', '/foo');
    render(
      <LocationProvider>
        <Router>
          <Route path="/foo" component={Foo} loader={ref} />
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
});

describe('<Route> rendered directly', () => {
  it('returns null and renders nothing', () => {
    const Foo = () => <p data-testid="foo">foo</p>;
    const { container } = render(<Route path="/foo" component={Foo} />);
    expect(container.innerHTML).toBe('');
  });
});
