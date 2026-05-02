// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { Loader } from '../loader.js';
import { useLoaderData } from '../use-loader-data.js';
import { useReload } from '../reload-context.js';
import { env } from '../is-browser.js';

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
});
afterEach(() => {
  env.current = originalEnv;
  cleanup();
});

describe('v3 <Loader> stability', () => {
  it('does not refire the loader on internal re-renders triggered by reload()', async () => {
    let callCount = 0;
    const fn = vi.fn(() => {
      callCount++;
      return Promise.resolve({ msg: `call ${callCount}` });
    });
    const ref = defineLoader<{ msg: string }>('refire-test', fn);

    function Child() {
      const { msg } = useLoaderData<typeof ref>();
      const { reload } = useReload();
      return (
        <div>
          <span data-testid="msg">{msg}</span>
          <button onClick={reload}>reload</button>
        </div>
      );
    }

    render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Child />
        </Loader>
      </LocationProvider>
    );

    await screen.findByText('call 1');
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.getByRole('button').click();
    });

    await screen.findByText('call 2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('preserves child component state across reload (no Suspense unmount)', async () => {
    let resolveInitial!: (v: { msg: string }) => void;
    let resolveReload!: (v: { msg: string }) => void;
    const fn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ msg: string }>((r) => {
            resolveInitial = r;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ msg: string }>((r) => {
            resolveReload = r;
          })
      );
    const ref = defineLoader<{ msg: string }>('preserve-state-test', fn);

    function Child() {
      const { msg } = useLoaderData<typeof ref>();
      const { reload } = useReload();
      const [count, setCount] = useState(0);
      return (
        <div>
          <span data-testid="msg">{msg}</span>
          <span data-testid="count">{count}</span>
          <button data-testid="bump" onClick={() => setCount((c) => c + 1)}>
            bump
          </button>
          <button data-testid="reload" onClick={reload}>
            reload
          </button>
        </div>
      );
    }

    render(
      <LocationProvider>
        <Loader
          loader={ref}
          location={loc}
          fallback={<div data-testid="loading">Loading…</div>}
        >
          <Child />
        </Loader>
      </LocationProvider>
    );

    await act(async () => {
      resolveInitial({ msg: 'initial' });
    });
    await screen.findByText('initial');

    // Increment local state in the child.
    await act(async () => {
      screen.getByTestId('bump').click();
      screen.getByTestId('bump').click();
    });
    expect(screen.getByTestId('count')).toHaveTextContent('2');

    // Trigger reload — should NOT remount Child or show fallback.
    await act(async () => {
      screen.getByTestId('reload').click();
    });

    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.getByTestId('msg')).toHaveTextContent('initial');
    expect(screen.getByTestId('count')).toHaveTextContent('2');

    await act(async () => {
      resolveReload({ msg: 'reloaded' });
    });

    await screen.findByText('reloaded');
    // Child state survived the reload.
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('does not fire a duplicate XHR when the host re-renders before the initial fetch resolves', async () => {
    let resolve!: (v: { msg: string }) => void;
    const fn = vi.fn(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    const ref = defineLoader<{ msg: string }>('dup-xhr-test', fn);

    function Child() {
      const { msg } = useLoaderData<typeof ref>();
      return <span data-testid="msg">{msg}</span>;
    }

    let trigger!: () => void;
    function Outer() {
      const [, force] = useState(0);
      trigger = () => force((n) => n + 1);
      return (
        <Loader
          loader={ref}
          location={loc}
          fallback={<div data-testid="loading">Loading…</div>}
        >
          <Child />
        </Loader>
      );
    }

    render(
      <LocationProvider>
        <Outer />
      </LocationProvider>
    );

    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(fn).toHaveBeenCalledTimes(1);

    // Force parent re-renders while the loader fetch is still pending.
    await act(async () => {
      trigger();
      trigger();
    });

    // Even after multiple re-renders, the loader should still have been
    // invoked exactly once.
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ msg: 'done' });
    });
    await screen.findByText('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('queues reload() invoked before the initial fetch resolves', async () => {
    let resolveInitial!: (v: { msg: string }) => void;
    let resolveReload!: (v: { msg: string }) => void;
    const fn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ msg: string }>((r) => {
            resolveInitial = r;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ msg: string }>((r) => {
            resolveReload = r;
          })
      );
    const ref = defineLoader<{ msg: string }>('search-test', fn);

    function Fallback() {
      const { reload } = useReload();
      return (
        <button data-testid="early-reload" onClick={reload}>
          reload
        </button>
      );
    }

    function Child() {
      const { msg } = useLoaderData<typeof ref>();
      return <span data-testid="msg">{msg}</span>;
    }

    render(
      <LocationProvider>
        <Loader loader={ref} location={loc} fallback={<Fallback />}>
          <Child />
        </Loader>
      </LocationProvider>
    );

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

    await act(async () => {
      screen.getByTestId('early-reload').click();
    });

    // The reload should not have fired yet because the initial fetch is
    // still pending. The click is queued, not dropped and not racing.
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInitial({ msg: 'initial' });
    });

    // Once the initial settles, the queued reload fires.
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveReload({ msg: 'reloaded' });
    });

    await screen.findByText('reloaded');
  });

  it('refetches when searchParams change even though path is stable', async () => {
    const fn = vi.fn(({ location }: { location: RouteHook }) =>
      Promise.resolve({ q: location.searchParams.q ?? '' })
    );
    const ref = defineLoader<{ q: string }>('search-q-test', fn);

    function Child() {
      const { q } = useLoaderData<typeof ref>();
      return <span data-testid="q">{q || '(empty)'}</span>;
    }

    const make = (q: string) =>
      ({
        path: '/search',
        url: `http://localhost/search?q=${q}`,
        searchParams: { q },
        pathParams: {},
      }) as unknown as RouteHook;

    const { rerender } = render(
      <LocationProvider>
        <Loader loader={ref} location={make('alpha')}>
          <Child />
        </Loader>
      </LocationProvider>
    );

    await screen.findByText('alpha');
    expect(fn).toHaveBeenCalledTimes(1);

    rerender(
      <LocationProvider>
        <Loader loader={ref} location={make('beta')}>
          <Child />
        </Loader>
      </LocationProvider>
    );

    await screen.findByText('beta');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
