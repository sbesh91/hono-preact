// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
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
    // __moduleKey so the runner takes the client fetch path.
    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'test-view-stream',
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
});
