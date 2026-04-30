// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { wrapWithPage } from '../route.js';
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
