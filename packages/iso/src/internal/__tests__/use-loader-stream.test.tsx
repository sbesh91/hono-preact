// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { RouteLocationsProvider } from '../route-locations.js';

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

describe('loader.useStream', () => {
  it('accumulates EVERY chunk (no coalescing loss) and ends closed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        dripSseResponse([
          'data: {"n":1}\n\n',
          'data: {"n":2}\n\n',
          'data: {"n":3}\n\n',
        ])
      )
    );
    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'test-stream',
    });
    function Probe() {
      const { data, status } = ref.useStream<number[]>({
        reduce: (acc, c) => [...acc, c.n],
        initial: [],
      });
      return (
        <p data-testid="out">
          {data.join(',')}|{status}
        </p>
      );
    }
    render(
      <LocationProvider>
        <RouteLocationsProvider moduleKey="test-stream" location={LOC}>
          <Probe />
        </RouteLocationsProvider>
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('1,2,3|closed')
    );
  });

  it('reports an error status when used with no resolvable location', async () => {
    const ref = defineLoader<{ n: number }>(async () => ({ n: 0 }), {
      __moduleKey: 'no-loc',
    });
    function Probe() {
      const { status } = ref.useStream<number[]>({
        reduce: (acc) => acc,
        initial: [],
      });
      return <p data-testid="out">{status}</p>;
    }
    render(
      <LocationProvider>
        <Probe />
      </LocationProvider>
    );
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('error')
    );
  });
});
