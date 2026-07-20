// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/preact';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { useLoaderRunner } from '../use-loader-runner.js';

// Spy on the cold-fetch path so we can assert NO network call happens when a
// baked deny marker is present. Wraps the real module (not a stub) so every
// other runner behavior (streaming, cache adoption, etc.) stays real.
vi.mock('../loader-runner.js', async (orig) => {
  const actual = await orig<typeof import('../loader-runner.js')>();
  return { ...actual, runLoader: vi.fn(actual.runLoader) };
});
import { runLoader } from '../loader-runner.js';

// Runner-level harness: exercises useLoaderRunner directly with a FIXED id, so
// the `data-loader-deny` marker can be pre-seeded in the DOM before mount
// deterministically. A DOM-timing test that discovers the id via `useId()`
// across separate render() calls is fragile (useId is not stable across
// remounts); this harness sidesteps that entirely.
const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

type Data = { ok: boolean };
type Captured = ReturnType<typeof useLoaderRunner<Data>>;
let captured: Captured;

// `loaderRef` (not `ref`): `ref` is a Preact-reserved prop, intercepted by the
// renderer rather than passed through.
function Harness({
  loaderRef,
}: {
  loaderRef: Parameters<typeof useLoaderRunner<Data>>[0];
}) {
  captured = useLoaderRunner<Data>(loaderRef, loc, 'FIXED_ID');
  return null;
}

function seedDenyMarker(message: string) {
  const el = document.createElement('section');
  el.id = 'FIXED_ID';
  el.setAttribute('data-loader-deny', JSON.stringify({ message }));
  document.body.appendChild(el);
  return el;
}

describe('useLoaderRunner seeds coldError from an SSR-baked deny marker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a coldError with fromBakedDeny and does not fetch', () => {
    seedDenyMarker('gone');
    const fn = vi.fn(() => Promise.resolve({ ok: true }));
    const ref = defineLoader<Data>(fn);

    render(<Harness loaderRef={ref} />);

    expect(captured.view.kind).toBe('coldError');
    if (captured.view.kind === 'coldError') {
      expect(captured.view.error).toBeInstanceOf(Error);
      expect(captured.view.error.message).toBe('gone');
      expect(captured.view.fromBakedDeny).toBe(true);
    }
    expect(runLoader).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });

  it('reload() clears the seed and runs a real fetch', async () => {
    seedDenyMarker('gone');
    const fn = vi.fn(() => Promise.resolve({ ok: true }));
    const ref = defineLoader<Data>(fn);

    render(<Harness loaderRef={ref} />);
    expect(captured.view.kind).toBe('coldError');
    expect(runLoader).not.toHaveBeenCalled();

    await act(async () => {
      captured.reload();
    });

    // A reload supersedes the baked seed: the real loader fetch runs. The
    // direct-fn dispatch lives behind a dynamic import, so `fn` lands a
    // microtask later than `reload()` itself; wait for it (mirrors
    // loader-runner regression tests elsewhere in this suite).
    expect(runLoader).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    // The seed is gone: the reload resolves and the view moves off coldError
    // entirely (no lingering fromBakedDeny).
    await waitFor(() => expect(captured.view.kind).toBe('render'));
    if (captured.view.kind === 'render' && 'data' in captured.view.state) {
      expect(captured.view.state.data).toEqual({ ok: true });
    }
  });
});
