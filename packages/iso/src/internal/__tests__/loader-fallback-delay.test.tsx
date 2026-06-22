// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { env } from '../../is-browser.js';

vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

const loc = {
  path: '/test',
  url: 'http://localhost/test',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const originalEnv = env.current;
beforeEach(() => {
  env.current = 'browser';
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  env.current = originalEnv;
  cleanup();
});

const Loading = () => <div data-testid="loading">Loading…</div>;

describe('LoaderHost delayed fallback', () => {
  it('delays the loader fallback by the 100ms default', () => {
    const ref = defineLoader(() => new Promise<{ msg: string }>(() => {}));
    function Child() {
      return <span>{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(screen.queryByTestId('loading')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('loading')).not.toBeNull();
  });

  it('never shows the fallback when the loader resolves before the delay', async () => {
    let resolve!: (v: { msg: string }) => void;
    const ref = defineLoader(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    function Child() {
      return <span data-testid="msg">{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).toBeNull();

    // coerceLoaderLocation is async even with no schemas, so fn is invoked
    // after a microtask. One Promise.resolve() flush is enough; waitFor would
    // fight fake timers.
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolve({ msg: 'done' });
    });
    // Use findByTestId to handle any deferred Suspense re-render scheduling.
    const msgEl = await screen.findByTestId('msg');
    expect(msgEl).toHaveTextContent('done');
    expect(screen.queryByTestId('loading')).toBeNull();

    // The fallback's timer was cleared on unmount, so advancing past the
    // threshold must not resurrect it.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('respects a custom fallbackDelay', () => {
    const ref = defineLoader(() => new Promise<{ msg: string }>(() => {}), {
      fallbackDelay: 50,
    });
    function Child() {
      return <span>{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId('loading')).not.toBeNull();
  });

  it('shows the fallback immediately when fallbackDelay is 0', () => {
    const ref = defineLoader(() => new Promise<{ msg: string }>(() => {}), {
      fallbackDelay: 0,
    });
    function Child() {
      return <span>{ref.useData().msg}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Loading />}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    expect(screen.queryByTestId('loading')).not.toBeNull();
  });
});
