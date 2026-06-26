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
import { getPreloadedData } from '../preload.js';

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
// during the pending window, so the union is in its `loading` arm (no data). It
// renders a "loading" marker until a data-carrying arm is present, then the
// data. This replaces the Suspense `fallback` prop, which no longer exists.
function Probe({ testid = 'msg' }: { testid?: string }) {
  const ctx = useContext(LoaderDataContext);
  if (ctx?.status === 'loading')
    return <span data-testid="loading">loading</span>;
  const data =
    ctx && 'data' in ctx
      ? (ctx.data as { msg: string } | undefined)
      : undefined;
  return <span data-testid={testid}>{data?.msg}</span>;
}

describe('state-based <Loader>: pending/resolved render model', () => {
  it('renders the children with the loading arm (no data) on a cold load, with NO fallback element or Suspense boundary', async () => {
    let resolve!: (v: { msg: string }) => void;
    let captured: { status: string; data?: unknown } | null = null;
    const fn = vi.fn(
      () =>
        new Promise<{ msg: string }>((r) => {
          resolve = r;
        })
    );
    const ref = defineLoader<{ msg: string }>(fn);

    function Capture() {
      captured = useContext(LoaderDataContext);
      return <Probe />;
    }

    const { container } = render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Capture />
        </Loader>
      </LocationProvider>
    );

    // While pending: the union is in its `loading` arm (no data). The children
    // rendered directly (no separate fallback element).
    await waitFor(() => expect(captured?.status).toBe('loading'));
    expect(captured && 'data' in captured).toBe(false);
    expect(screen.queryByTestId('loading')).not.toBeNull();
    // The resolved markup is the SAME <section> the Envelope always renders
    // (no Suspense fallback section swapped in/out).
    expect(container.querySelector('section')).not.toBeNull();

    await act(async () => {
      resolve({ msg: 'ready' });
    });

    await screen.findByText('ready');
    expect(captured?.status).toBe('success');
    expect(captured && 'data' in captured ? captured.data : undefined).toEqual({
      msg: 'ready',
    });
  });

  it('renders a defined-but-falsy resolved value (no undefined-precedence ambiguity)', async () => {
    // A loader resolving to 0 must render 0, not be mistaken for "no data".
    const ref = defineLoader<number>(async () => 0);
    let observed: unknown = 'unset';
    function Capture() {
      const ctx = useContext(LoaderDataContext);
      const data = ctx && 'data' in ctx ? ctx.data : undefined;
      observed = data;
      return <span data-testid="val">{String(data)}</span>;
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

// End-to-end regressions the high-effort review of #192 found. These render
// through the `<Loader>` boundary and consume the projected union via
// `loader.useData()` (the same context union `loader.View` reads), so they
// exercise the projection seam end-to-end, not the runner in isolation.
describe('loader-state end-to-end regressions (review #1,#2,#3,#7)', () => {
  // #1: a loader that legitimately resolves to `undefined` must render the
  // `success` arm, not collapse back to `loading` forever. The old projection
  // keyed on `data === undefined`, which cannot tell "cold, no value" from
  // "settled to undefined" and so reported `loading` indefinitely.
  it('renders success (not loading-forever) when the loader resolves to undefined', async () => {
    let resolve!: (v: string | undefined) => void;
    const fn = vi.fn(
      () =>
        new Promise<string | undefined>((r) => {
          resolve = r;
        })
    );
    const ref = defineLoader<string | undefined>(fn);

    function Child() {
      const s = ref.useData();
      if (s.status === 'loading') return <span data-testid="out">loading</span>;
      if (s.status === 'success')
        return <span data-testid="out">done:{String(s.data)}</span>;
      return <span data-testid="out">other:{s.status}</span>;
    }

    render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Child />
        </Loader>
      </LocationProvider>
    );

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolve(undefined);
    });

    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('done:undefined')
    );
  });

  // #2: a reload over a value that was hydrated from an SSR preload must enter
  // `revalidating` (so consumers get refresh feedback) while keeping the prior
  // data visible. The old `runReload` read only `phaseValue(p)` as the prior,
  // which is `undefined` for a preload-hydrated loader (its phase is still
  // `loading`), so it fell back to a cold `loading` and never revalidated.
  it('enters revalidating (keeping prior data) on reload over an SSR preload', async () => {
    vi.mocked(getPreloadedData).mockReturnValueOnce({ n: 1 });
    let resolveReload: (v: { n: number }) => void = () => {};
    const fn = vi.fn(
      () =>
        new Promise<{ n: number }>((r) => {
          resolveReload = r;
        })
    );
    const ref = defineLoader<{ n: number }>(fn);

    function Child() {
      const s = ref.useData();
      const { reload } = useReload();
      let body: string;
      if (s.status === 'revalidating') body = `reval:${JSON.stringify(s.data)}`;
      else if (s.status === 'loading') body = 'loading';
      else if (s.status === 'success') body = `done:${JSON.stringify(s.data)}`;
      else body = `other:${s.status}`;
      return (
        <div>
          <span data-testid="out">{body}</span>
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

    // Preload hydrates synchronously: success with the preloaded value, and the
    // fetch fn is not invoked for the initial value.
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('done:{"n":1}')
    );
    expect(fn).not.toHaveBeenCalled();

    // Reload with the next fetch left pending: revalidating, prior data kept.
    await act(async () => {
      screen.getByTestId('reload').click();
    });
    expect(screen.getByTestId('out')).toHaveTextContent('reval:{"n":1}');

    // Settle cleanly so no promise dangles past the test.
    await act(async () => {
      resolveReload({ n: 2 });
    });
  });

  // #3: when a reload over a preload-hydrated value resolves to `undefined`,
  // the view must show the NEW undefined, not the stale prior value. The old
  // derivation fell back to `syncDataRef.current` whenever the settled value
  // was `undefined`, masking a real resolve-to-undefined as stale data.
  it('shows the new undefined value (not stale preload) when a reload resolves to undefined', async () => {
    vi.mocked(getPreloadedData).mockReturnValueOnce({ n: 1 });
    let resolveReload: (v: { n: number } | undefined) => void = () => {};
    const fn = vi.fn(
      () =>
        new Promise<{ n: number } | undefined>((r) => {
          resolveReload = r;
        })
    );
    const ref = defineLoader<{ n: number } | undefined>(fn);

    function Child() {
      const s = ref.useData();
      const { reload } = useReload();
      let body: string;
      if (s.status === 'revalidating') body = 'reval';
      else if (s.status === 'loading') body = 'loading';
      else if (s.status === 'success')
        body = `done:${s.data === undefined ? 'undefined' : JSON.stringify(s.data)}`;
      else body = `other:${s.status}`;
      return (
        <div>
          <span data-testid="out">{body}</span>
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

    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('done:{"n":1}')
    );

    await act(async () => {
      screen.getByTestId('reload').click();
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveReload(undefined);
    });

    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('done:undefined')
    );
  });

  // #7: `useData()` must hand back a referentially stable object across
  // re-renders that do not change the loader state, so memoized consumers do
  // not see a "new" value every render. The old `useData()` rebuilt a fresh
  // union object on every call.
  it('useData() is referentially stable across re-renders with unchanged state', async () => {
    const ref = defineLoader<{ v: number }>(async () => ({ v: 1 }));
    const seen: unknown[] = [];
    function Child() {
      const s = ref.useData();
      seen.push(s);
      const [, setN] = useState(0);
      return (
        <button data-testid="bump" onClick={() => setN((n) => n + 1)}>
          bump
        </button>
      );
    }

    render(
      <LocationProvider>
        <Loader loader={ref} location={loc}>
          <Child />
        </Loader>
      </LocationProvider>
    );

    // Settle into success (initial render is loading, then a success render).
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
    const before = seen.length;

    // Force a re-render via unrelated child state; loader state is unchanged.
    await act(async () => {
      screen.getByTestId('bump').click();
    });
    expect(seen.length).toBeGreaterThan(before);

    const last = seen[seen.length - 1];
    const prev = seen[seen.length - 2];
    expect(Object.is(last, prev)).toBe(true);
  });
});
