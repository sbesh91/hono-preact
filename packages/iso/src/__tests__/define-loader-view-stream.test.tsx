// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/preact';
import { useEffect, useRef } from 'preact/hooks';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { useReload } from '../reload-context.js';
import { RouteLocationsProvider } from '../internal/route-locations.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Drip each SSE frame in its own microtask so Preact flushes between chunks.
function dripSseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
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
  // restoreAllMocks does NOT undo vi.stubGlobal('fetch', ...); unstub explicitly
  // so a stale fetch stub cannot bleed into other files under a concurrent run.
  vi.unstubAllGlobals();
});

const LOC = { path: '/', pathParams: {}, searchParams: {} } as never;

describe('loader.View (accumulating / streaming form)', () => {
  it('folds EVERY chunk into accumulated data and exposes status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          dripSseResponse([
            'data: {"n":1}\n\n',
            'data: {"n":2}\n\n',
            'data: {"n":3}\n\n',
          ])
        )
    );
    // Generator fn + `__moduleKey` so the runner takes the client fetch path.
    // The generator fn drives the LoaderRef<T, true> type discriminant so the
    // accumulating .View form is available. On the client `live` is inert.
    const ref = defineLoader<{ n: number }>(
      async function* () {
        yield { n: 0 };
      },
      {
        __moduleKey: 'test-view-stream',
        live: true,
      }
    );
    const Feed = ref.View<number[]>(
      (s) => (
        <p data-testid="out">
          {(s.status === 'connecting' ? [] : s.data).join(',')}|{s.status}
        </p>
      ),
      {
        initial: [],
        reduce: (acc, chunk) => [...acc, chunk.n],
      }
    );

    render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey="test-view-stream" location={LOC}>
          <Feed />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    // Every chunk lands (no coalescing loss); the stream closes -> 'closed'.
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('1,2,3|closed')
    );
  });

  it('reload() resubscribes and re-folds from initial (never overwrites Acc with a raw chunk)', async () => {
    const fetchMock = vi
      .fn()
      // First subscribe: folds to [1,2].
      .mockResolvedValueOnce(
        dripSseResponse(['data: {"n":1}\n\n', 'data: {"n":2}\n\n'])
      )
      // After reload: a fresh stream that folds to [9].
      .mockResolvedValueOnce(dripSseResponse(['data: {"n":9}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const ref = defineLoader<{ n: number }>(
      async function* () {
        yield { n: 0 };
      },
      {
        __moduleKey: 'test-view-reload',
        live: true,
      }
    );
    const Feed = ref.View<number[]>(
      (s) => {
        const { reload } = useReload();
        const data = s.status === 'connecting' ? [] : s.data;
        return (
          <div>
            <p data-testid="out">
              {/* If reload overwrote Acc with a raw chunk, `data` is an object,
                  not an array, and this surfaces it instead of crashing. */}
              {Array.isArray(data)
                ? data.join(',')
                : `NOT-ARRAY:${JSON.stringify(data)}`}
              |{s.status}
            </p>
            <button data-testid="reload" onClick={reload}>
              reload
            </button>
          </div>
        );
      },
      {
        initial: [],
        reduce: (acc, chunk) => [...acc, chunk.n],
      }
    );

    render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey="test-view-reload" location={LOC}>
          <Feed />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('1,2|closed')
    );

    await act(async () => {
      screen.getByTestId('reload').click();
    });

    // The accumulator reset to `initial` and re-folded the new stream; `data`
    // stayed an array throughout.
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('9|closed')
    );
    expect(screen.getByTestId('out').textContent).not.toContain('NOT-ARRAY');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reload() reconnect projects connecting BEFORE the next chunk arrives', async () => {
    // Finding 1: a live reload surfaces data = accumulate.initial ([]) together
    // with status 'connecting'. The render fn must observe `connecting`
    // (mirroring a fresh mount), not `open` with the empty seed. Hold the
    // reload's fetch pending so the reconnect stays in the connecting window for
    // a deterministic assertion.
    const second = deferred<Response>();
    const fetchMock = vi
      .fn()
      // First subscribe: folds to [1,2], then closes.
      .mockResolvedValueOnce(
        dripSseResponse(['data: {"n":1}\n\n', 'data: {"n":2}\n\n'])
      )
      // After reload: a stream we keep pending to hold the connecting window.
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);

    const ref = defineLoader<{ n: number }>(
      async function* () {
        yield { n: 0 };
      },
      {
        __moduleKey: 'test-view-reload-connecting',
        live: true,
      }
    );
    const Feed = ref.View<number[]>(
      (s) => {
        const { reload } = useReload();
        const data = s.status === 'connecting' ? [] : s.data;
        return (
          <div>
            <p data-testid="out">
              {data.join(',')}|{s.status}
            </p>
            <button data-testid="reload" onClick={reload}>
              reload
            </button>
          </div>
        );
      },
      {
        initial: [],
        reduce: (acc, chunk) => [...acc, chunk.n],
      }
    );

    render(
      <LocationProvider>
        <RouteLocationsProvider
          moduleKey="test-view-reload-connecting"
          location={LOC}
        >
          <Feed />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('1,2|closed')
    );

    // Reload: its fetch (second) stays pending, so the reconnect holds in the
    // connecting window rather than racing to the next chunk.
    await act(async () => {
      screen.getByTestId('reload').click();
    });

    // The render fn observes status 'connecting' during the reconnect, BEFORE
    // any chunk re-arrives. Without the projection fix this would read 'open'
    // (the empty `initial` seed surfaced as data with no chunk yet).
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('|connecting')
    );

    // Resolve the held stream; the fresh fold wins and the stream closes.
    await act(async () => {
      second.resolve(dripSseResponse(['data: {"n":9}\n\n']));
    });
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('9|closed')
    );
  });

  it('drains a reload() queued during the initial pre-first-chunk window', async () => {
    // The first subscribe stays pending while the view (rendered eagerly in the
    // connecting state) fires reload(); that reload is queued (the initial fetch
    // is in flight). When the first chunk finally settles, the queued reload must
    // drain and resubscribe. With the state model the view fn renders during the
    // connecting window (no separate Suspense fallback subtree), so the
    // useReload() consumer lives inside the render fn itself.
    const first = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(dripSseResponse(['data: {"n":7}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const ref = defineLoader<{ n: number }>(
      async function* () {
        yield { n: 0 };
      },
      {
        __moduleKey: 'test-view-queued-reload',
        live: true,
      }
    );

    // Fires reload() exactly once while the bar is still connecting (before the
    // first chunk arrives). Lives inside the eagerly-rendered view fn.
    function ConnectingReloader() {
      const { reload } = useReload();
      const fired = useRef(false);
      useEffect(() => {
        if (!fired.current) {
          fired.current = true;
          reload();
        }
      }, [reload]);
      return null;
    }

    const Feed = ref.View<number[]>(
      (s) => (
        <p data-testid="out">
          {(s.status === 'connecting' ? [] : s.data).join(',')}|{s.status}
          {s.status === 'connecting' ? <ConnectingReloader /> : null}
        </p>
      ),
      {
        initial: [],
        reduce: (acc, chunk) => [...acc, chunk.n],
      }
    );

    render(
      <LocationProvider>
        <RouteLocationsProvider
          moduleKey="test-view-queued-reload"
          location={LOC}
        >
          <Feed />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    // Fallback mounted and queued a reload; only the initial fetch has fired.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Settle the initial subscribe: settleAcc must drain the queued reload.
    await act(async () => {
      first.resolve(dripSseResponse(['data: {"n":1}\n\n']));
    });

    // The queued reload fired a second subscribe; the re-folded stream wins.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('7|closed')
    );
  });
});
