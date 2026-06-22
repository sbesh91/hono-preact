// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { useReload } from '../../reload-context.js';
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
    const ref = defineLoader<{ msg: string }>(fn);

    function Child() {
      const { msg } = ref.useData();
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
    const ref = defineLoader<{ msg: string }>(fn);

    function Child() {
      const { msg } = ref.useData();
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

    // coerceLoaderLocation is async (even when both schemas are absent), so fn
    // is invoked after a microtask. Wait for it before using resolveInitial.
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

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
    const ref = defineLoader<{ msg: string }>(fn);

    function Child() {
      const { msg } = ref.useData();
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
    const ref = defineLoader<{ msg: string }>(fn);

    function Fallback() {
      const { reload } = useReload();
      return (
        <button data-testid="early-reload" onClick={reload}>
          reload
        </button>
      );
    }

    function Child() {
      const { msg } = ref.useData();
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

    // The fallback is now wrapped in DelayedFallback (100ms default). Wait for
    // it to appear, then click the button inside it.
    const earlyReload = await screen.findByTestId('early-reload');
    await act(async () => {
      earlyReload.click();
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
    const fn = vi.fn(
      ({ location }: { location: RouteHook; signal: AbortSignal }) =>
        Promise.resolve({ q: location.searchParams.q ?? '' })
    );
    const ref = defineLoader<{ q: string }>(fn, { params: ['q'] });

    function Child() {
      const { q } = ref.useData();
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

describe('Loader: parametric loader cache should key on location', () => {
  it('does not serve stale cached data when navigating to a different path param', async () => {
    const calls: string[] = [];
    const ref = defineLoader<{ id: string; title: string }>(
      async ({ location }) => {
        const id = (location.pathParams as Record<string, string>).id;
        calls.push(id);
        return { id, title: `Movie ${id}` };
      }
    );

    function Page({ id }: { id: string }) {
      const data = ref.useData();
      return <p data-testid={`title-${id}`}>{data.title}</p>;
    }

    const makeLoc = (id: string) =>
      ({
        path: `/movies/${id}`,
        url: `http://localhost/movies/${id}`,
        searchParams: {},
        pathParams: { id },
      }) as unknown as RouteHook;

    // First mount with id=1
    const first = render(
      <LocationProvider>
        <Loader loader={ref} location={makeLoc('1')}>
          <Page id="1" />
        </Loader>
      </LocationProvider>
    );
    await waitFor(() => expect(first.queryByTestId('title-1')).not.toBeNull());
    expect(first.queryByTestId('title-1')!.textContent).toBe('Movie 1');

    first.unmount();

    // Remount with id=2. The shared cache must NOT return id=1's data.
    const second = render(
      <LocationProvider>
        <Loader loader={ref} location={makeLoc('2')}>
          <Page id="2" />
        </Loader>
      </LocationProvider>
    );
    await waitFor(() => expect(second.queryByTestId('title-2')).not.toBeNull());
    expect(second.queryByTestId('title-2')!.textContent).toBe('Movie 2');

    // Verify both fetches happened (cache didn't short-circuit the second).
    expect(calls).toEqual(['1', '2']);
  });
});

describe('Loader: no-location error message', () => {
  it('throws with remediation naming the route server module when no location is provided', () => {
    const ref = defineLoader(async () => ({ msg: 'hi' }));
    // Suppress the expected React/Preact error console output from the throw.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      render(
        <LocationProvider>
          <Loader loader={ref}>
            <span />
          </Loader>
        </LocationProvider>
      );
    }).toThrow(
      "wrap the page in a route whose server module includes this loader's .server.ts file"
    );
    errorSpy.mockRestore();
  });
});

describe('Loader: useError() on successful static load', () => {
  it('returns null while data is rendered', async () => {
    const ref = defineLoader(async () => ({ msg: 'hi' }));
    let observed: Error | null | undefined = undefined;
    let observedMsg: string | undefined = undefined;
    function Child() {
      observed = ref.useError();
      observedMsg = ref.useData().msg;
      return null;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    await waitFor(() => expect(observedMsg).toBe('hi'));
    expect(observed).toBe(null);
  });
});
