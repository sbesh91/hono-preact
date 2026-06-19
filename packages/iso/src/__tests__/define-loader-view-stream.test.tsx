// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsProvider } from '../internal/route-locations.js';

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
    // `live` + `__moduleKey` so the runner takes the client fetch path (the
    // accumulating form requires a live loader; on the client `live` is inert).
    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'test-view-stream',
      live: true,
    });
    const Feed = ref.View<number[]>(
      ({ data, status }) => (
        <p data-testid="out">
          {data.join(',')}|{status}
        </p>
      ),
      {
        initial: [],
        reduce: (acc, chunk) => [...acc, chunk.n],
        fallback: <p data-testid="out">connecting</p>,
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

    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'test-view-reload',
      live: true,
    });
    const Feed = ref.View<number[]>(
      ({ data, status, reload }) => (
        <div>
          <p data-testid="out">
            {/* If reload overwrote Acc with a raw chunk, `data` is an object,
                not an array, and this surfaces it instead of crashing. */}
            {Array.isArray(data)
              ? data.join(',')
              : `NOT-ARRAY:${JSON.stringify(data)}`}
            |{status}
          </p>
          <button data-testid="reload" onClick={reload}>
            reload
          </button>
        </div>
      ),
      {
        initial: [],
        reduce: (acc, chunk) => [...acc, chunk.n],
        fallback: <p data-testid="out">connecting</p>,
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
});
