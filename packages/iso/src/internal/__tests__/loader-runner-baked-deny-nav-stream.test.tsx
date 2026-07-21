// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/preact';
import type { RouteHook } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { useLoaderRunner } from '../use-loader-runner.js';
import type { AccumulateOptions } from '../use-loader-runner.js';

// Spy on the cold-fetch/streaming path so we can assert whether a network call
// happens. Wraps the real module (not a stub) so every other runner behavior
// stays real.
vi.mock('../loader-runner.js', async (orig) => {
  const actual = await orig<typeof import('../loader-runner.js')>();
  return { ...actual, runLoader: vi.fn(actual.runLoader) };
});
import { runLoader } from '../loader-runner.js';

const loc = {
  path: '/x',
  url: 'http://localhost/x',
  searchParams: {},
  pathParams: {},
} as unknown as RouteHook;

const loc2 = {
  path: '/y',
  url: 'http://localhost/y',
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
  location,
  accumulate,
}: {
  loaderRef: Parameters<typeof useLoaderRunner<Data>>[0];
  location: RouteHook;
  accumulate?: AccumulateOptions;
}) {
  captured = useLoaderRunner<Data>(loaderRef, location, 'FIXED_ID', accumulate);
  return null;
}

function seedDenyMarker(message: string) {
  const el = document.createElement('section');
  el.id = 'FIXED_ID';
  el.setAttribute('data-loader-deny', JSON.stringify({ message }));
  document.body.appendChild(el);
  return el;
}

describe('Finding 1: baked deny seed cleared on client navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('a location change that resolves fresh data supersedes the baked deny (view becomes render, not stuck on coldError)', async () => {
    seedDenyMarker('gone');
    const fn = vi.fn(() => Promise.resolve({ ok: true }));
    const ref = defineLoader<Data>(fn);

    const { rerender } = render(<Harness loaderRef={ref} location={loc} />);
    expect(captured.view.kind).toBe('coldError');
    expect(runLoader).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<Harness loaderRef={ref} location={loc2} />);
    });

    // The navigation superseded the stale SSR-baked deny: a fresh fetch ran
    // and the view must project the resolved success, not remain wedged on
    // the stale coldError forever.
    await waitFor(() => expect(captured.view.kind).toBe('render'));
    if (captured.view.kind === 'render' && 'data' in captured.view.state) {
      expect(captured.view.state.data).toEqual({ ok: true });
    }
  });
});

describe('Finding 3: streaming/accumulate loaders honor the baked deny marker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('an accumulate loader seeded with a baked deny renders coldError with fromBakedDeny and never subscribes/fetches', () => {
    seedDenyMarker('gone');
    const fn = vi.fn(() => Promise.resolve({ ok: true }));
    const ref = defineLoader<Data>(fn);
    const accumulate: AccumulateOptions = {
      initial: [] as unknown,
      reduce: (acc, chunk) => (acc as unknown[]).concat(chunk),
    };

    render(<Harness loaderRef={ref} location={loc} accumulate={accumulate} />);

    expect(captured.view.kind).toBe('coldError');
    if (captured.view.kind === 'coldError') {
      expect(captured.view.error).toBeInstanceOf(Error);
      expect(captured.view.error.message).toBe('gone');
      expect(captured.view.fromBakedDeny).toBe(true);
    }
    expect(runLoader).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
  });
});
