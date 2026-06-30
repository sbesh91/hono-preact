// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, hydrate } from 'preact';
import { act } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { prerender } from 'preact-iso/prerender';
import { defineLoader } from '../define-loader.js';
import { RouteLocationsProvider } from '../internal/route-locations.js';
import { env } from '../is-browser.js';

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
  it('live SSR anchors data-loader="null" and does not serialize accumulate.initial', () => {
    // initial carries a BigInt: JSON.stringify would throw if the SSR path tried
    // to serialize it. A live loader must emit data-loader="null" on SSR because
    // the client connects via the live stream; there is no baked server value.
    async function* live() {
      yield { n: 1 };
    }
    const ref = defineLoader<{ n: number }>(live, {
      __moduleKey: 'test-ssr-bigint',
      live: true,
    });
    const View = ref.View<{ total: bigint }>(
      (s) => (s.status === 'connecting' ? <p>connecting</p> : <p>open</p>),
      { initial: { total: 0n }, reduce: (acc) => acc }
    );
    const App = () => (
      <LocationProvider>
        <RouteLocationsProvider moduleKey="test-ssr-bigint" location={LOC}>
          <View />
        </RouteLocationsProvider>
      </LocationProvider>
    );

    env.current = 'server';
    const container = document.createElement('div');
    // Must not throw even though BigInt cannot be JSON-serialized.
    render(<App />, container);

    const sections = container.querySelectorAll('section[data-loader]');
    expect(sections.length).toBe(1);
    expect(sections[0].getAttribute('data-loader')).toBe('null');
    expect(container.textContent).toContain('connecting');

    render(null, container);
  });

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
      (s) => (
        <p data-testid="bar">
          {(s.status === 'connecting' ? [] : s.data).join(',')}|{s.status}
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
    // Exactly one Envelope section, carrying the connecting-state view. A live
    // loader never bakes server data: the client reconnects on mount, so
    // data-loader="null" (the anchor is 'none', not 'data').
    const sections = container.querySelectorAll('section[data-loader]');
    expect(sections.length).toBe(1);
    expect(sections[0].getAttribute('data-loader')).toBe('null');
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
      (s) => (
        <p data-testid="bar">
          {(s.status === 'connecting' ? [] : s.data).join(',')}|{s.status}
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

// Guards that streaming (accumulating) consumption projects the SAME union shape
// on the server and the client, keyed on the CONSUMPTION FORM (accumulate), NOT
// the `live` flag. A finite (non-live) streaming loader must render the
// `connecting` StreamState on SSR and bake NO value (data-loader="null"): the
// accumulating client consumer never adopts a baked streaming value (on mount it
// re-subscribes via SSE), so its first render is also `connecting`. Baking a
// single-value `success` LoaderState here (the prior bug) would mismatch the
// StreamState the accumulating `.View` render fn reads, flashing/hydration-warning
// on the client.
describe('non-live streaming loader: SSR renders connecting (no bake)', () => {
  it('projects the connecting StreamState and bakes data-loader="null"', async () => {
    async function* finite() {
      yield { n: 1 };
      yield { n: 2 };
    }
    const ref = defineLoader<{ n: number }>(finite, {
      __moduleKey: 'test-ssr-nonlive-acc',
      live: false,
    });

    // The accumulating .View form is the only form for streaming/generator refs.
    const Finite = ref.View<number[]>(
      (s) => (
        <p data-testid="state">
          {s.status === 'open' || s.status === 'closed'
            ? s.data.join(',')
            : s.status}
        </p>
      ),
      {
        initial: [] as number[],
        reduce: (acc, c: { n: number }) => [...acc, c.n],
      }
    );
    const App = () => (
      <LocationProvider>
        <Finite />
      </LocationProvider>
    );

    env.current = 'server';
    const { html } = await prerender(<App />);

    // No baked streaming value: the anchor is 'none' (data-loader="null"), and
    // the rendered state is `connecting` (the StreamState the client also starts
    // from), so SSR and the client's first render agree.
    expect(html).toContain('data-loader="null"');
    expect(html).toContain('connecting');
    expect(html).not.toContain('data-loader="[1]"');
  });
});
