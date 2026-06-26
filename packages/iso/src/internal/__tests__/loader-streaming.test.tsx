// @vitest-environment happy-dom
import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { RouteLocationsProvider } from '../route-locations.js';

/**
 * Build a mock SSE Response that emits each chunk in a separate microtask
 * by enqueuing them through a ReadableStream controller. This gives Preact
 * time to flush re-renders between chunks, matching real-network behaviour
 * where each chunk arrives via an I/O event rather than from a buffered
 * string.
 */
function dripSseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
        // Yield to the microtask queue so Preact can flush between chunks.
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('streaming loader: client-driven', () => {
  it('renders pending (loading, no data) then the first chunk, then re-renders on each subsequent chunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          dripSseResponse([
            'data: {"count":1}\n\n',
            'data: {"count":2}\n\n',
            'data: {"count":3}\n\n',
          ])
        )
    );

    // Use __moduleKey so LoaderHost takes the fetch path.
    const ref = defineLoader<{ count: number }>(async () => ({ count: 0 }), {
      __moduleKey: 'test-stream',
    });

    // Loading-aware: with the state model the children render eagerly during the
    // connecting window, so `data` is undefined until the first chunk lands.
    function Page() {
      const s = ref.useData();
      if (!('data' in s)) return <p data-testid="count">pending</p>;
      return <p data-testid="count">{s.data.count}</p>;
    }

    render(
      <LocationProvider>
        <Loader
          loader={ref}
          location={{ path: '/', pathParams: {}, searchParams: {} } as never}
        >
          <Page />
        </Loader>
      </LocationProvider>
    );

    // The children render immediately (no Suspense fallback) in the pending
    // state: the loading marker, not the data.
    expect(screen.getByTestId('count')).toHaveTextContent('pending');

    // The DOM should eventually show 3, proving the stream was fully consumed.
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('3')
    );
  });

  it('surfaces a COLD connect error (rejected before any chunk) in the StreamState error arm in-view, NOT to an outer boundary', async () => {
    // The live/accumulate connect fails before any chunk arrives: `fetch`
    // resolves to an error status, so the first-chunk promise rejects with no
    // accumulated value. The runner lands on { status: 'error', data: undefined }
    // (a cold stream error). The render fn MUST see `status === 'error'` in-view;
    // the page must NOT unwind to an outer boundary (that is the single-value
    // cold-error path, not the streaming one).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'connect refused' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const MODULE_KEY = 'test-stream-cold-err';
    const ref = defineLoader<{ count: number }>(async () => ({ count: 0 }), {
      __moduleKey: MODULE_KEY,
      live: true,
    });

    // Records whether an OUTER boundary caught a throw. A cold STREAM error must
    // never reach it (only single-value cold errors route to the boundary).
    let boundaryCaught: Error | null = null;
    class Boundary extends Component<
      { children: ComponentChildren },
      { err: Error | null }
    > {
      state = { err: null };
      static getDerivedStateFromError(err: Error) {
        boundaryCaught = err;
        return { err };
      }
      render() {
        return this.state.err ? (
          <p data-testid="boundary">boundary:{this.state.err.message}</p>
        ) : (
          this.props.children
        );
      }
    }

    // The real, fully-typed accumulating `.View` consumer path: the render fn
    // receives a `StreamState<number>` directly (no cast at the seam).
    const seen: string[] = [];
    const LiveView = ref.View<number>(
      (s) => {
        seen.push(s.status);
        if (s.status === 'error')
          return <p data-testid="out">stream-error:{s.error.message}</p>;
        if (s.status === 'connecting')
          return <p data-testid="out">connecting</p>;
        return <p data-testid="out">data:{String(s.data)}</p>;
      },
      { initial: 0, reduce: (_acc, chunk) => chunk.count }
    );

    // Structurally a preact-iso RouteHook; assignable with no cast.
    const LOC = { path: '/', pathParams: {}, searchParams: {} };

    render(
      <LocationProvider>
        <Boundary>
          <RouteLocationsProvider moduleKey={MODULE_KEY} location={LOC}>
            <LiveView />
          </RouteLocationsProvider>
        </Boundary>
      </LocationProvider>
    );

    // Before the connect settles the render fn shows the connecting affordance.
    expect(screen.getByTestId('out')).toHaveTextContent('connecting');

    // Once the cold connect error settles it surfaces IN-VIEW via the error arm.
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('stream-error')
    );
    // The error reached the render fn, not an outer boundary.
    expect(boundaryCaught).toBeNull();
    expect(screen.queryByTestId('boundary')).toBeNull();
    expect(seen).toContain('error');
  });

  it('surfaces a post-first-chunk error via useError and keeps last-good data', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          dripSseResponse([
            'data: {"count":1}\n\n',
            'data: {"count":2}\n\n',
            'event: error\ndata: {"message":"mid-stream","name":"Error"}\n\n',
          ])
        )
    );

    const ref = defineLoader<{ count: number }>(async () => ({ count: 0 }), {
      __moduleKey: 'test-stream-err',
    });

    let lastData: { count: number } | null = null;
    let lastError: Error | null = null;
    function Page() {
      const s = ref.useData();
      if ('data' in s) lastData = s.data;
      lastError = ref.useError();
      return null;
    }

    render(
      <LocationProvider>
        <Loader
          loader={ref}
          location={{ path: '/', pathParams: {}, searchParams: {} } as never}
        >
          <Page />
        </Loader>
      </LocationProvider>
    );

    await waitFor(() => expect(lastError).not.toBeNull());
    expect(lastData).toEqual({ count: 2 });
    expect((lastError as Error | null)?.message).toBe('mid-stream');
  });
});

/**
 * Build a mock SSE Response that emits one chunk and stays OPEN (never closes
 * its controller) so the loader settles on the `open` status rather than racing
 * to `closed`. Returns a `close()` to end it cleanly after the assertion.
 */
function openSseResponse(chunk: string): {
  res: Response;
  close: () => void;
} {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      controller.enqueue(enc.encode(chunk));
      // Intentionally left open: the loader should report `open`, not `closed`.
    },
  });
  return {
    res: new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
    close: () => ctrl.close(),
  };
}

// Re-review of #192 (DEEP FIX): the `stream` finding. `toStreamState` keyed its
// connecting/open/closed decision on `data === undefined`, so a streaming
// accumulator that is legitimately `undefined` was trapped on `connecting` even
// after the stream went `open` / `closed`. These render through the real
// accumulating `.View` and FAIL against the pre-fix `data === undefined` guard.
describe('streaming loader: undefined accumulator (re-review #192 deep fix)', () => {
  it('shows the open arm (not connecting) for an open stream whose accumulator is undefined', async () => {
    const { res, close } = openSseResponse('data: {"count":1}\n\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

    const MODULE_KEY = 'test-stream-open-undef';
    const ref = defineLoader<{ count: number }>(async () => ({ count: 0 }), {
      __moduleKey: MODULE_KEY,
      live: true,
    });

    const LiveView = ref.View(
      (s) => {
        if (s.status === 'open')
          return <p data-testid="out">open:{String(s.data)}</p>;
        if (s.status === 'closed')
          return <p data-testid="out">closed:{String(s.data)}</p>;
        if (s.status === 'error') return <p data-testid="out">error</p>;
        return <p data-testid="out">connecting</p>;
      },
      { initial: undefined, reduce: () => undefined }
    );

    const LOC = { path: '/', pathParams: {}, searchParams: {} };
    render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey={MODULE_KEY} location={LOC}>
          <LiveView />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    // Before the first chunk: connecting (no data yet).
    expect(screen.getByTestId('out')).toHaveTextContent('connecting');

    // After the chunk folds the accumulator to `undefined` and the stream stays
    // open, the view is the `open` arm with `data === undefined`, NOT connecting.
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('open:undefined')
    );

    await act(async () => {
      close();
    });
  });

  it('shows the closed arm (not connecting) when a stream with an undefined accumulator ends', async () => {
    // One chunk (folded to `undefined`) then the stream closes. After `onEnd` the
    // status is `closed` with `data === undefined`; that must surface as `closed`,
    // not `connecting`.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(dripSseResponse(['data: {"count":1}\n\n']))
    );

    const MODULE_KEY = 'test-stream-closed-undef';
    const ref = defineLoader<{ count: number }>(async () => ({ count: 0 }), {
      __moduleKey: MODULE_KEY,
      live: true,
    });

    const LiveView = ref.View(
      (s) => {
        if (s.status === 'closed')
          return <p data-testid="out">closed:{String(s.data)}</p>;
        if (s.status === 'open')
          return <p data-testid="out">open:{String(s.data)}</p>;
        if (s.status === 'error') return <p data-testid="out">error</p>;
        return <p data-testid="out">connecting</p>;
      },
      { initial: undefined, reduce: () => undefined }
    );

    const LOC = { path: '/', pathParams: {}, searchParams: {} };
    render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey={MODULE_KEY} location={LOC}>
          <LiveView />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('closed:undefined')
    );
  });
});
