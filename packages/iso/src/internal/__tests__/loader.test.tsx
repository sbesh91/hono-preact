// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { LocationProvider, type RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { useReload } from '../../reload-context.js';
import { LoaderDataContext } from '../contexts.js';
import { useContext } from 'preact/hooks';
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

// A loading-aware probe: with the state-based loader, children render eagerly
// during the pending window, so `data` may be undefined. It renders a "loading"
// marker until data is present, then the data. This replaces the Suspense
// `fallback` prop, which no longer exists.
function Probe({ testid = 'msg' }: { testid?: string }) {
  const ctx = useContext(LoaderDataContext);
  const data = ctx?.data as { msg: string } | undefined;
  if (ctx?.loading && data === undefined)
    return <span data-testid="loading">loading</span>;
  return <span data-testid={testid}>{data?.msg}</span>;
}

describe('state-based <Loader>: pending/resolved render model', () => {
  it('renders the children with loading=true & data=undefined on a cold load, with NO fallback element or Suspense boundary', async () => {
    let resolve!: (v: { msg: string }) => void;
    let captured: { data: unknown; loading: boolean } | null = null;
    const fn = vi.fn(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    const ref = defineLoader<{ msg: string }>(fn);

    function Capture() {
      captured = useContext(LoaderDataContext) as {
        data: unknown;
        loading: boolean;
      } | null;
      return <Probe />;
    }

    const { container } = render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Capture />
        </Loader>
      </LocationProvider>
    );

    // While pending: render fn ran with loading=true, data=undefined. The
    // children rendered directly (no separate fallback element).
    await waitFor(() => expect(captured?.loading).toBe(true));
    expect(captured?.data).toBeUndefined();
    expect(screen.queryByTestId('loading')).not.toBeNull();
    // The resolved markup is the SAME <section> the Envelope always renders
    // (no Suspense fallback section swapped in/out).
    expect(container.querySelector('section')).not.toBeNull();

    await act(async () => {
      resolve({ msg: 'ready' });
    });

    await screen.findByText('ready');
    expect(captured?.loading).toBe(false);
    expect(captured?.data).toEqual({ msg: 'ready' });
  });

  it('renders a defined-but-falsy resolved value (no undefined-precedence ambiguity)', async () => {
    // A loader resolving to 0 must render 0, not be mistaken for "no data".
    const ref = defineLoader<number>(async () => 0);
    let observed: unknown = 'unset';
    function Capture() {
      const ctx = useContext(LoaderDataContext);
      observed = ctx?.data;
      return <span data-testid="val">{String(ctx?.data)}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Capture />
        </Loader>
      </LocationProvider>
    );
    await waitFor(() => expect(observed).toBe(0));
    expect(screen.getByTestId('val')).toHaveTextContent('0');
  });
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
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      const { reload } = useReload();
      return (
        <div>
          <span data-testid="msg">{data?.msg}</span>
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

  it('preserves child component state across reload (no unmount), keeping the previous data visible', async () => {
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
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      const { reload } = useReload();
      const [count, setCount] = useState(0);
      return (
        <div>
          <span data-testid="msg">{data?.msg}</span>
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
        <Loader loader={ref} location={loc}>
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

    // Trigger reload; should NOT remount Child; the previous data stays
    // visible (stale-while-revalidate) while the reload is in flight.
    await act(async () => {
      screen.getByTestId('reload').click();
    });

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
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      return <span data-testid="msg">{data?.msg}</span>;
    }

    let trigger!: () => void;
    function Outer() {
      const [, force] = useState(0);
      trigger = () => force((n) => n + 1);
      return (
        <Loader loader={ref} location={loc}>
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

    // The children render eagerly during the pending window (no fallback
    // subtree). A useReload() consumer mounted directly in the children can fire
    // reload() before the initial fetch resolves; the runner must queue it.
    function Child() {
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      const { reload } = useReload();
      return (
        <div>
          <span data-testid="msg">{data?.msg}</span>
          <button data-testid="early-reload" onClick={reload}>
            reload
          </button>
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

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

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
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      return <span data-testid="q">{data ? data.q || '(empty)' : ''}</span>;
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
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      return <p data-testid={`title-${id}`}>{data?.title}</p>;
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
    await waitFor(() =>
      expect(first.getByTestId('title-1').textContent).toBe('Movie 1')
    );

    first.unmount();

    // Remount with id=2. The shared cache must NOT return id=1's data.
    const second = render(
      <LocationProvider>
        <Loader loader={ref} location={makeLoc('2')}>
          <Page id="2" />
        </Loader>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(second.getByTestId('title-2').textContent).toBe('Movie 2')
    );

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
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      observedMsg = data?.msg;
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

describe('LoaderRef.useData(): discriminated LoaderState (review #1,#2)', () => {
  it('returns { status: "success", data } once the loader resolves', async () => {
    const ref = defineLoader<{ title: string }>(async () => ({
      title: 'Dune',
    }));
    let seenUseData: unknown = null;
    function Child() {
      // useData() now hands back the discriminated union, not the raw value.
      seenUseData = ref.useData();
      const s = ref.useData();
      const data = 'data' in s ? s.data : undefined;
      return <span data-testid="title">{data?.title}</span>;
    }
    render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Child />
        </Loader>
      </LocationProvider>
    );
    await screen.findByText('Dune');
    expect(seenUseData).toEqual({ status: 'success', data: { title: 'Dune' } });
  });
});
