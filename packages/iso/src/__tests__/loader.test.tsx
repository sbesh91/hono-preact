// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { getLoaderData, useReload, type LoaderData } from '../loader.js';
import { createCache } from '../cache.js';
import { env } from '../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({})),
  deletePreloadedData: vi.fn(),
}));

import * as preloadModule from '../preload.js';
import { JSX } from 'preact';

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
  vi.mocked(preloadModule.getPreloadedData).mockReturnValue(null);
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

function Child({ loaderData }: LoaderData<{ msg: string }>) {
  return <div data-testid="child">{loaderData.msg}</div>;
}
Child.defaultProps = { route: '/test' };

function wrap(el: JSX.Element) {
  return render(<LocationProvider>{el}</LocationProvider>);
}

describe('cache hit', () => {
  it('renders cached data without calling clientLoader', async () => {
    const cache = createCache<{ msg: string }>();
    cache.set({ msg: 'from cache' });
    const clientLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { clientLoader, cache });

    wrap(<Wrapped {...loc} />);

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('from cache');
    expect(clientLoader).not.toHaveBeenCalled();
  });
});

describe('preloaded data (hydration path)', () => {
  it('renders preloaded data without calling clientLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({
      msg: 'preloaded',
    } as any);
    const clientLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { clientLoader });

    wrap(<Wrapped {...loc} />);

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('preloaded');
    expect(clientLoader).not.toHaveBeenCalled();
  });
});

describe('cache miss (fetch path)', () => {
  it('calls clientLoader and shows fallback during load', async () => {
    const cache = createCache<{ msg: string }>();
    let resolve!: (v: { msg: string }) => void;
    const rawLoader = vi.fn(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    // cache.wrap prevents re-renders from calling rawLoader again after it resolves
    const Wrapped = getLoaderData(Child, {
      clientLoader: cache.wrap(rawLoader),
      cache,
      fallback: <div data-testid="loading">Loading…</div>,
    });

    wrap(<Wrapped {...loc} />);

    // Guard resolves first, then clientLoader is called — wait for the call
    await waitFor(() => expect(rawLoader).toHaveBeenCalled());
    expect(rawLoader).toHaveBeenCalledOnce();
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    await act(async () => {
      resolve({ msg: 'loaded' });
    });

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('loaded');
  });
});

describe('useReload', () => {
  it('reload() re-runs clientLoader and updates rendered content', async () => {
    let callCount = 0;
    const cache = createCache<{ msg: string }>();
    // Use raw clientLoader (not cache.wrap) so reload() calls it fresh each time.
    // Provide cache so re-renders after setReloading(true) take the cache path
    // instead of creating a new wrapPromise and calling clientLoader a third time.
    const clientLoader = vi.fn(() => {
      callCount++;
      return Promise.resolve({ msg: `call ${callCount}` });
    });

    function ReloadChild({ loaderData }: LoaderData<{ msg: string }>) {
      const { reload } = useReload();
      return (
        <div>
          <span data-testid="msg">{loaderData.msg}</span>
          <button onClick={reload}>reload</button>
        </div>
      );
    }
    ReloadChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(ReloadChild, { clientLoader, cache });
    wrap(<Wrapped {...loc} />);

    const msg = await screen.findByTestId('msg');
    expect(msg).toHaveTextContent('call 1');

    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('call 2');
    expect(clientLoader).toHaveBeenCalledTimes(2);
  });

  it('throws when called outside a getLoaderData component', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Bad() {
      useReload();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(
      'useReload must be called inside a component rendered by getLoaderData'
    );
    consoleSpy.mockRestore();
  });
});

describe('preloaded empty object (hydration edge case)', () => {
  it('renders preloaded empty object without calling clientLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({} as any);
    const clientLoader = vi.fn().mockResolvedValue({ msg: 'from client' });

    function EmptyChild({ loaderData }: LoaderData<Record<string, never>>) {
      return <div data-testid="empty">{JSON.stringify(loaderData)}</div>;
    }
    EmptyChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(EmptyChild, { clientLoader });
    wrap(<Wrapped {...loc} />);

    await waitFor(() => {}, { timeout: 50 }).catch(() => {});
    expect(clientLoader).not.toHaveBeenCalled();
  });
});

describe('useReload error handling', () => {
  it('exposes the error when clientLoader throws during reload', async () => {
    const cache = createCache<{ msg: string }>();
    const clientLoader = vi.fn()
      .mockResolvedValueOnce({ msg: 'initial' })
      .mockRejectedValueOnce(new Error('network failure'));

    function ErrorChild({ loaderData }: LoaderData<{ msg: string }>) {
      const { reload, error } = useReload();
      return (
        <div>
          <span data-testid="msg">{loaderData.msg}</span>
          <span data-testid="error">{error?.message ?? 'none'}</span>
          <button onClick={reload}>reload</button>
        </div>
      );
    }
    ErrorChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(ErrorChild, { clientLoader, cache });
    wrap(<Wrapped {...loc} />);

    await screen.findByText('initial');

    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('network failure');
    expect(screen.getByTestId('error')).toHaveTextContent('network failure');
    expect(screen.getByTestId('msg')).toHaveTextContent('initial');
  });
});
