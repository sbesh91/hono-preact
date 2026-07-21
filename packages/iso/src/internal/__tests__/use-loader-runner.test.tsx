// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/preact';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { useLoaderRunner } from '../use-loader-runner.js';
import * as preload from '../preload.js';
import { env } from '../../is-browser.js';

// The runner reads the SSR preload payload through this module; stub it so each
// test controls whether a preloaded value is present (default: absent).
vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => ({ present: false })),
  deletePreloadedData: vi.fn(),
  getPreloadedDeny: vi.fn(() => ({ present: false })),
  deletePreloadedDeny: vi.fn(),
}));

// State-machine tests for useLoaderRunner. They drive the runner DIRECTLY (no
// <Loader>/Suspense) so they assert the RETURNED state, never a thrown reader: a
// Probe component captures each render's runner state into a module-scoped
// variable. The runner now returns the discriminated `view` union (plus the
// `reloading` flag); these helpers read the same data/loading/error the old
// scalar fields exposed STRUCTURALLY off the union, so the assertions are
// unchanged in meaning.
describe('useLoaderRunner exposes data/loading state without throwing', () => {
  const originalEnv = env.current;
  beforeEach(() => {
    env.current = 'browser';
    vi.mocked(preload.getPreloadedData).mockReturnValue({ present: false });
  });
  afterEach(() => {
    env.current = originalEnv;
    cleanup();
    vi.clearAllMocks();
  });

  const stateLoc = {
    path: '/state',
    url: 'http://localhost/state',
    searchParams: {},
    pathParams: {},
  } as unknown as RouteHook;

  type Data = { msg: string };
  type Captured = ReturnType<typeof useLoaderRunner<Data>>;
  let captured: Captured;

  // Read the settled value off the rendered union (the `data`-bearing arms),
  // mirroring the old `runner.data`. Cold-error / loading carry none.
  const viewData = (c: Captured): Data | undefined =>
    c.view.kind === 'render' && 'data' in c.view.state
      ? c.view.state.data
      : undefined;
  // A fetch/stream-connect in flight: the cold `loading` arm or `revalidating`
  // (the old `runner.loading`). A cold error is not loading.
  const viewLoading = (c: Captured): boolean =>
    c.view.kind === 'render' &&
    (c.view.state.status === 'loading' ||
      c.view.state.status === 'revalidating');
  // The surfaced error (cold-error signal or the stale-error arm), mirroring the
  // old `runner.error`.
  const viewError = (c: Captured): Error | null =>
    c.view.kind === 'coldError'
      ? c.view.error
      : c.view.kind === 'render' && c.view.state.status === 'error'
        ? c.view.state.error
        : null;

  // `loaderRef` (not `ref`): `ref` is a Preact-reserved prop and is intercepted
  // by the renderer rather than passed through to the component.
  function Probe({
    loaderRef,
    location = stateLoc,
  }: {
    loaderRef: Parameters<typeof useLoaderRunner<Data>>[0];
    location?: RouteHook;
  }) {
    captured = useLoaderRunner<Data>(loaderRef, location, 'probe-id');
    return null;
  }

  it('cold load exposes loading then data without throwing', async () => {
    let resolve!: (v: Data) => void;
    const fn = vi.fn(
      () =>
        new Promise<Data>((r) => {
          resolve = r;
        })
    );
    const ref = defineLoader<Data>(fn);

    render(<Probe loaderRef={ref} />);

    // Cold load in flight: no data yet, loading true. Reading the bridge reader
    // would throw the suspender; we assert the returned state instead.
    expect(viewData(captured)).toBeUndefined();
    expect(viewLoading(captured)).toBe(true);
    expect(viewError(captured)).toBeNull();

    // coerceLoaderLocation is async, so the loader fn runs a microtask later;
    // wait for it before resolving (mirrors loader.test.tsx).
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolve({ msg: 'hello' });
    });

    await waitFor(() => expect(viewData(captured)).toEqual({ msg: 'hello' }));
    expect(viewLoading(captured)).toBe(false);
    expect(viewError(captured)).toBeNull();
  });

  it('reload retains previous data while loading (stale-while-revalidate)', async () => {
    let resolveInitial!: (v: Data) => void;
    let resolveReload!: (v: Data) => void;
    const fn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Data>((r) => {
            resolveInitial = r;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Data>((r) => {
            resolveReload = r;
          })
      );
    const ref = defineLoader<Data>(fn);

    render(<Probe loaderRef={ref} />);

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveInitial({ msg: 'A' });
    });
    await waitFor(() => expect(viewData(captured)).toEqual({ msg: 'A' }));
    expect(viewLoading(captured)).toBe(false);

    // Reload with a pending fetch: data stays the PREVIOUS value, loading true.
    await act(async () => {
      captured.reload();
    });
    expect(viewLoading(captured)).toBe(true);
    expect(viewData(captured)).toEqual({ msg: 'A' });

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveReload({ msg: 'B' });
    });
    await waitFor(() => expect(viewData(captured)).toEqual({ msg: 'B' }));
    expect(viewLoading(captured)).toBe(false);
  });

  it('preloaded data is available immediately with loading false', () => {
    vi.mocked(preload.getPreloadedData).mockReturnValue({
      present: true,
      value: { msg: 'preloaded' },
    });
    const fn = vi.fn(() => Promise.resolve({ msg: 'fetched' }));
    const ref = defineLoader<Data>(fn);

    render(<Probe loaderRef={ref} />);

    // SSR-preload path resolves synchronously: data present, never pending,
    // loading false. The fetch fn is not invoked for the initial value.
    expect(viewData(captured)).toEqual({ msg: 'preloaded' });
    expect(viewLoading(captured)).toBe(false);
    expect(viewError(captured)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('browser-cache hit is available immediately with loading false', () => {
    const fn = vi.fn(() => Promise.resolve({ msg: 'fetched' }));
    const ref = defineLoader<Data>(fn);
    // Seed the loader cache under the key the runner derives for stateLoc
    // (serializeLocationForCache: `${path}?${sortedSearch}`, no params here).
    ref.cache.set({ msg: 'cached' }, '/state?');

    render(<Probe loaderRef={ref} />);

    expect(viewData(captured)).toEqual({ msg: 'cached' });
    expect(viewLoading(captured)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a loader resolving to undefined clears loading (review #10)', async () => {
    let resolve!: (v: Data | undefined) => void;
    const fn = vi.fn(
      () =>
        new Promise<Data>((r) => {
          resolve = r as (v: Data) => void;
        })
    );
    const ref = defineLoader<Data>(fn);
    render(<Probe loaderRef={ref} />);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolve(undefined);
    });
    // Resolved to undefined: loading must clear (not stay stuck on the sentinel).
    await waitFor(() => expect(viewLoading(captured)).toBe(false));
    expect(viewData(captured)).toBeUndefined();
    expect(viewError(captured)).toBeNull();
  });

  it('reloading is false on a cold load and true only during reload (review #5)', async () => {
    let resolveInitial!: (v: Data) => void;
    let resolveReload!: (v: Data) => void;
    const fn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Data>((r) => {
            resolveInitial = r;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Data>((r) => {
            resolveReload = r;
          })
      );
    const ref = defineLoader<Data>(fn);
    render(<Probe loaderRef={ref} />);
    // Cold load in flight: loading true, reloading false.
    expect(viewLoading(captured)).toBe(true);
    expect(captured.reloading).toBe(false);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveInitial({ msg: 'A' });
    });
    await waitFor(() => expect(viewData(captured)).toEqual({ msg: 'A' }));
    expect(captured.reloading).toBe(false);
    // Explicit reload: reloading true.
    await act(async () => {
      captured.reload();
    });
    expect(captured.reloading).toBe(true);
    expect(viewLoading(captured)).toBe(true);
    // The direct-fn (non-keyed) loader path is now async: the server dispatch
    // lives behind a dynamic import (kept off client bundles), so the reload's
    // loader invocation lands a microtask later. Wait for it before resolving,
    // exactly as the cold load above waits for call #1.
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveReload({ msg: 'B' });
    });
    await waitFor(() => expect(viewData(captured)).toEqual({ msg: 'B' }));
    expect(captured.reloading).toBe(false);
  });

  it('does not re-read the SSR preload on a client navigation (gated on first render)', async () => {
    // Regression: the SSR preload is a one-time hydration handoff. On a client
    // navigation the loader's <section> is still mounted carrying the
    // `data-loader` the client <Envelope> re-wrote on the previous render
    // ("null" for the state path). Re-reading it would adopt that stale value as
    // a present preload, skip the fetch, and land on null without ever showing
    // loading (the second-nav bug). The runner must only consult the preload on
    // the instance's FIRST render.
    const fn = vi
      .fn<() => Promise<Data>>()
      .mockResolvedValueOnce({ msg: 'A' })
      .mockResolvedValueOnce({ msg: 'B' });
    const ref = defineLoader<Data>(fn);

    const locA = {
      ...stateLoc,
      path: '/a',
      url: 'http://localhost/a',
    } as unknown as RouteHook;
    const locB = {
      ...stateLoc,
      path: '/b',
      url: 'http://localhost/b',
    } as unknown as RouteHook;

    // First mount: preload absent (default mock) -> cold fetch A.
    const { rerender } = render(<Probe loaderRef={ref} location={locA} />);
    await waitFor(() => expect(viewData(captured)).toEqual({ msg: 'A' }));
    expect(preload.getPreloadedData).toHaveBeenCalledTimes(1);

    // Now the persisted client-written attribute would report a present `null`
    // IF the runner re-read it on the navigation.
    vi.mocked(preload.getPreloadedData).mockReturnValue({
      present: true,
      value: null as unknown as Data,
    });

    // Navigate (location change): must cold-fetch B and surface loading, never
    // adopt the stale `null`.
    await act(async () => {
      rerender(<Probe loaderRef={ref} location={locB} />);
    });
    await waitFor(() => expect(viewData(captured)).toEqual({ msg: 'B' }));
    // The preload was NOT consulted again on the navigation.
    expect(preload.getPreloadedData).toHaveBeenCalledTimes(1);
  });
});
