// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, hydrate } from 'preact';
import { act } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsProvider } from '../internal/route-locations.js';
import { env } from '../is-browser.js';

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

const LOC = { path: '/', pathParams: {}, searchParams: {} } as never;
const originalEnv = env.current;

afterEach(() => {
  env.current = originalEnv;
  vi.restoreAllMocks();
});

// Guards the headline fix of this PR: a live `.View` SSR'd inside a layout must
// (a) never run its (infinite) generator on the server (no renderToStringAsync
// hang) and (b) emit a `useId`-anchored `<section data-loader="null">` fallback
// that hydration ADOPTS rather than orphaning (the two-overlapping-bars
// regression, same class as PR #63 / preactjs/preact#4442). A refactor of the
// `liveServer` short-circuit or the anchor shape breaks one of these assertions.
describe('live loader.View: SSR no-hang + hydration adoption', () => {
  it('renders the anchored fallback on the server without invoking the loader', () => {
    let invoked = 0;
    async function* live() {
      invoked++;
      yield { n: 1 };
    }
    const ref = defineLoader<{ n: number }>(live, {
      __moduleKey: 'test-ssr-live-1',
      live: true,
    });
    const Bar = ref.View<number[]>(
      ({ data, status }) => (
        <p data-testid="bar">
          {data.join(',')}|{status}
        </p>
      ),
      {
        initial: [],
        reduce: (acc, c) => [...acc, c.n],
        fallback: <p data-testid="bar">connecting</p>,
      }
    );
    const App = () => (
      <LocationProvider>
        <RouteLocationsProvider moduleKey="test-ssr-live-1" location={LOC}>
          <Bar />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    env.current = 'server';
    const container = document.createElement('div');
    render(<App />, container);

    // The infinite generator is never started on the server.
    expect(invoked).toBe(0);
    // Exactly one anchored fallback section, carrying the fallback content.
    const sections = container.querySelectorAll('section[data-loader]');
    expect(sections.length).toBe(1);
    expect(sections[0].getAttribute('data-loader')).toBe('null');
    expect(container.textContent).toContain('connecting');

    render(null, container);
  });

  it('hydrates the SSR fallback markup as a single element (no orphaned duplicate)', async () => {
    let invoked = 0;
    async function* live() {
      invoked++;
      yield { n: 1 };
    }
    const ref = defineLoader<{ n: number }>(live, {
      __moduleKey: 'test-ssr-live-2',
      live: true,
    });
    const Bar = ref.View<number[]>(
      ({ data, status }) => (
        <p data-testid="bar">
          {data.join(',')}|{status}
        </p>
      ),
      {
        initial: [],
        reduce: (acc, c) => [...acc, c.n],
        fallback: <p data-testid="bar">connecting</p>,
      }
    );
    const App = () => (
      <LocationProvider>
        <RouteLocationsProvider moduleKey="test-ssr-live-2" location={LOC}>
          <Bar />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    // Produce the server markup (env=server skips the loader, emits the anchor).
    env.current = 'server';
    const ssr = document.createElement('div');
    render(<App />, ssr);
    const ssrHtml = ssr.innerHTML;
    render(null, ssr);
    expect(ssr.querySelectorAll('section').length).toBe(0); // unmounted clean

    // Hydrate that exact markup in the browser. The client suspends on the first
    // RPC chunk and shows the SAME anchored fallback, which Preact must adopt.
    env.current = 'browser';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(dripSseResponse(['data: {"n":1}\n\n']))
    );
    const host = document.createElement('div');
    host.innerHTML = ssrHtml;
    document.body.appendChild(host);

    await act(async () => {
      hydrate(<App />, host);
    });

    // Adoption, not orphaning: still exactly one section (a second would be the
    // two-overlapping-bars bug). The live loader's fn is never invoked on the
    // client either (it streams over RPC, not by calling the fn).
    expect(host.querySelectorAll('section').length).toBe(1);
    expect(invoked).toBe(0);

    host.remove();
  });
});
