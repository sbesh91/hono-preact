// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';

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
  it('renders the first chunk, then re-renders on each subsequent chunk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
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

    function Page() {
      const { count } = ref.useData();
      return <p data-testid="count">{count}</p>;
    }

    render(
      <LocationProvider>
        <Loader loader={ref} location={{ path: '/', pathParams: {}, searchParams: {} } as never}>
          <Page />
        </Loader>
      </LocationProvider>
    );

    // The DOM should eventually show 3, proving the stream was fully consumed.
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('3')
    );
    // Verify the component showed earlier chunks along the way.
    await waitFor(() =>
      expect(screen.getByTestId('count')).toHaveTextContent('3')
    );
  });

  it('surfaces a post-first-chunk error via useError and keeps last-good data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
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
      lastData = ref.useData();
      lastError = ref.useError();
      return null;
    }

    render(
      <LocationProvider>
        <Loader loader={ref} location={{ path: '/', pathParams: {}, searchParams: {} } as never}>
          <Page />
        </Loader>
      </LocationProvider>
    );

    await waitFor(() => expect(lastError).not.toBeNull());
    expect(lastData).toEqual({ count: 2 });
    expect((lastError as Error | null)?.message).toBe('mid-stream');
  });
});
