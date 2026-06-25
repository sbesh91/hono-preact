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
  // restoreAllMocks does NOT undo vi.stubGlobal('fetch', ...); unstub explicitly.
  vi.unstubAllGlobals();
});

// Guards the load-bearing pieces of the headline fix: a live `.View` SSR'd in a
// layout must (a) never run its (infinite) generator on the server (no
// renderToStringAsync hang) and (b) render through the SAME `useId`-anchored
// `<Envelope>` <section> on the server and the client so hydration ADOPTS the
// server node (adoption, not re-creation). With the state model there is no
// separate Suspense fallback: SSR renders the view fn directly with the initial
// accumulator and `status === 'connecting'`, and the client hydrates the exact
// same branch onto the exact same node. The full two-overlapping-bars orphan
// (PR #63 / preactjs/preact#4442) only reproduces with the lazy-layout timing of
// a real route tree and is verified manually at /demo; these unit tests pin the
// SSR no-hang + single Envelope node + single-node hydration the orphan fix
// depends on.
describe('live loader.View: SSR no-hang + single-node hydration', () => {
  it('renders the connecting view on the server without invoking the loader', () => {
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
    // Exactly one Envelope section, carrying the connecting-state view. Its
    // `data-loader` serializes the initial accumulator (`[]`) the view rendered
    // with, not a separate "null" fallback marker.
    const sections = container.querySelectorAll('section[data-loader]');
    expect(sections.length).toBe(1);
    expect(sections[0].getAttribute('data-loader')).toBe('[]');
    // The view fn ran with status === 'connecting' (no first chunk yet).
    expect(container.textContent).toContain('connecting');

    render(null, container);
  });

  it('hydrates the SSR fallback onto the same DOM node (adoption, not re-creation)', async () => {
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

    // Hydrate that exact markup in the browser. fetch stays pending so the
    // component stays in the connecting state (we assert adoption before any
    // chunk arrives to fold into the accumulator and re-render the Envelope).
    env.current = 'browser';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const host = document.createElement('div');
    host.innerHTML = ssrHtml;
    document.body.appendChild(host);
    const ssrNode = host.querySelector('section');
    expect(ssrNode).not.toBeNull();

    await act(async () => {
      hydrate(<App />, host);
    });

    // Adoption: still exactly one section, and it is the SAME DOM node the server
    // emitted (a re-created node, or a second node, is the orphan failure mode).
    // The live loader's fn is never invoked on the client either (RPC, not fn).
    expect(host.querySelectorAll('section').length).toBe(1);
    expect(host.querySelector('section')).toBe(ssrNode);
    expect(invoked).toBe(0);

    host.remove();
  });
});
