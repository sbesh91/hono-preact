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
  it('renders cached data without calling serverLoader', async () => {
    const cache = createCache<{ msg: string }>();
    cache.set({ msg: 'from cache' });
    const serverLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { serverLoader, cache });

    wrap(<Wrapped {...loc} />);

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('from cache');
    expect(serverLoader).not.toHaveBeenCalled();
  });
});

describe('preloaded data (hydration path)', () => {
  it('renders preloaded data without calling serverLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({
      msg: 'preloaded',
    } as any);
    const serverLoader = vi.fn();
    const Wrapped = getLoaderData(Child, { serverLoader });

    wrap(<Wrapped {...loc} />);

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('preloaded');
    expect(serverLoader).not.toHaveBeenCalled();
  });
});

describe('cache miss (fetch path)', () => {
  it('calls serverLoader and shows fallback during load', async () => {
    const cache = createCache<{ msg: string }>();
    let resolve!: (v: { msg: string }) => void;
    const serverLoader = vi.fn(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    const Wrapped = getLoaderData(Child, {
      serverLoader,
      cache,
      fallback: <div data-testid="loading">Loading…</div>,
    });

    wrap(<Wrapped {...loc} />);

    await waitFor(() => expect(serverLoader).toHaveBeenCalled());
    expect(serverLoader).toHaveBeenCalledOnce();
    expect(screen.getByTestId('loading')).toBeInTheDocument();

    await act(async () => {
      resolve({ msg: 'loaded' });
    });

    const el = await screen.findByTestId('child');
    expect(el).toHaveTextContent('loaded');
  });
});

describe('useReload', () => {
  it('reload() re-runs serverLoader and updates rendered content', async () => {
    let callCount = 0;
    const cache = createCache<{ msg: string }>();
    const serverLoader = vi.fn(() => {
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

    const Wrapped = getLoaderData(ReloadChild, { serverLoader, cache });
    wrap(<Wrapped {...loc} />);

    const msg = await screen.findByTestId('msg');
    expect(msg).toHaveTextContent('call 1');

    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('call 2');
    expect(serverLoader).toHaveBeenCalledTimes(2);
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
  it('renders preloaded empty object without calling serverLoader', async () => {
    vi.mocked(preloadModule.getPreloadedData).mockReturnValue({} as any);
    const serverLoader = vi.fn().mockResolvedValue({ msg: 'from server' });

    function EmptyChild({ loaderData }: LoaderData<Record<string, never>>) {
      return <div data-testid="empty">{JSON.stringify(loaderData)}</div>;
    }
    EmptyChild.defaultProps = { route: '/test' };

    const Wrapped = getLoaderData(EmptyChild, { serverLoader });
    wrap(<Wrapped {...loc} />);

    await waitFor(() => {}, { timeout: 50 }).catch(() => {});
    expect(serverLoader).not.toHaveBeenCalled();
  });
});

describe('useReload error handling', () => {
  it('exposes the error when serverLoader throws during reload', async () => {
    const cache = createCache<{ msg: string }>();
    const serverLoader = vi.fn()
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

    const Wrapped = getLoaderData(ErrorChild, { serverLoader, cache });
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
