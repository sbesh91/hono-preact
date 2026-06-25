// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/preact';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { useLoaderRunner } from '../use-loader-runner.js';
import * as preload from '../preload.js';
import { env } from '../../is-browser.js';

// The runner reads the SSR preload payload through this module; stub it so each
// test controls whether a preloaded value is present (default: none).
vi.mock('../preload.js', () => ({
  getPreloadedData: vi.fn(() => null),
  deletePreloadedData: vi.fn(),
}));

// State-machine tests for useLoaderRunner's data/loading fields. They drive the
// runner DIRECTLY (no <Loader>/Suspense) so they assert the RETURNED state,
// never a thrown reader: a Probe component captures each render's runner state
// into a module-scoped variable.
describe('useLoaderRunner exposes data/loading state without throwing', () => {
  const originalEnv = env.current;
  beforeEach(() => {
    env.current = 'browser';
    vi.mocked(preload.getPreloadedData).mockReturnValue(null);
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
    expect(captured.data).toBeUndefined();
    expect(captured.loading).toBe(true);
    expect(captured.error).toBeNull();

    // coerceLoaderLocation is async, so the loader fn runs a microtask later;
    // wait for it before resolving (mirrors loader.test.tsx).
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolve({ msg: 'hello' });
    });

    await waitFor(() => expect(captured.data).toEqual({ msg: 'hello' }));
    expect(captured.loading).toBe(false);
    expect(captured.error).toBeNull();
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
    await waitFor(() => expect(captured.data).toEqual({ msg: 'A' }));
    expect(captured.loading).toBe(false);

    // Reload with a pending fetch: data stays the PREVIOUS value, loading true.
    await act(async () => {
      captured.reload();
    });
    expect(captured.loading).toBe(true);
    expect(captured.data).toEqual({ msg: 'A' });

    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveReload({ msg: 'B' });
    });
    await waitFor(() => expect(captured.data).toEqual({ msg: 'B' }));
    expect(captured.loading).toBe(false);
  });

  it('preloaded data is available immediately with loading false', () => {
    vi.mocked(preload.getPreloadedData).mockReturnValue({ msg: 'preloaded' });
    const fn = vi.fn(() => Promise.resolve({ msg: 'fetched' }));
    const ref = defineLoader<Data>(fn);

    render(<Probe loaderRef={ref} />);

    // SSR-preload path resolves synchronously: data present, never pending,
    // loading false. The fetch fn is not invoked for the initial value.
    expect(captured.data).toEqual({ msg: 'preloaded' });
    expect(captured.loading).toBe(false);
    expect(captured.error).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('browser-cache hit is available immediately with loading false', () => {
    const fn = vi.fn(() => Promise.resolve({ msg: 'fetched' }));
    const ref = defineLoader<Data>(fn);
    // Seed the loader cache under the key the runner derives for stateLoc
    // (serializeLocationForCache: `${path}?${sortedSearch}`, no params here).
    ref.cache.set({ msg: 'cached' }, '/state?');

    render(<Probe loaderRef={ref} />);

    expect(captured.data).toEqual({ msg: 'cached' });
    expect(captured.loading).toBe(false);
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
    await waitFor(() => expect(captured.loading).toBe(false));
    expect(captured.data).toBeUndefined();
    expect(captured.error).toBeNull();
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
    expect(captured.loading).toBe(true);
    expect(captured.reloading).toBe(false);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveInitial({ msg: 'A' });
    });
    await waitFor(() => expect(captured.data).toEqual({ msg: 'A' }));
    expect(captured.reloading).toBe(false);
    // Explicit reload: reloading true.
    await act(async () => {
      captured.reload();
    });
    expect(captured.reloading).toBe(true);
    expect(captured.loading).toBe(true);
    await act(async () => {
      resolveReload({ msg: 'B' });
    });
    await waitFor(() => expect(captured.data).toEqual({ msg: 'B' }));
    expect(captured.reloading).toBe(false);
  });
});
