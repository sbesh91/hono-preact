// @vitest-environment happy-dom
// SPIKE (throwaway): the REAL spike, in the proof-through-implementation sense.
// Everything earlier proved the dependency was safe. This proves the DESIGN in
// §5(B) works: a pluggable reactive cell inside the actual loader runner, a
// derived view signal published through the actual <Loader> host, and a real
// server-driven loader update reaching the DOM.
//
// The claim under test: a value update from a real loader patches a bound text
// node WITHOUT re-rendering the component that owns the loader.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/preact';
import { LocationProvider } from 'preact-iso';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { RouteLocationsProvider } from '../route-locations.js';
import { registerReactiveImpl } from '../reactive-cell.js';
// Importing the opt-in module is what installs signal-backed reactivity.
import {
  useDataSignal,
  useFieldSignal,
  installSignalReactivity,
} from '../../signals-spike.js';

/** Emit each SSE chunk in its own microtask, as a real network would. */
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
  vi.unstubAllGlobals();
});

describe('E2E: signal-backed loader through the real runner', () => {
  it('a real loader update patches the DOM with no component re-render', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          dripSseResponse([
            'data: {"title":"one"}\n\n',
            'data: {"title":"two"}\n\n',
            'data: {"title":"three"}\n\n',
          ])
        )
    );

    const ref = defineLoader<{ title: string }>(
      async () => ({ title: 'cold' }),
      { __moduleKey: 'signals-e2e' }
    );

    const renders = vi.fn();

    function Row() {
      renders();
      // The row binds ONE field. Bare signal in JSX, never `.value`.
      const title = useFieldSignal<{ title: string }, string>(
        (d) => d.title,
        'pending'
      );
      return <p data-testid="row">{title}</p>;
    }

    render(
      <LocationProvider>
        <RouteLocationsProvider>
          <Loader loader={ref}>
            <Row />
          </Loader>
        </RouteLocationsProvider>
      </LocationProvider>
    );

    // First chunk: loading -> success is a TAG change, so the host re-renders
    // once. That is intended; it changes which branch loader.tsx routes to.
    await waitFor(() =>
      expect(screen.getByTestId('row').textContent).toBe('one')
    );
    const rendersAfterFirstChunk = renders.mock.calls.length;

    // Chunks 2 and 3 are success -> success: value-only, same tag.
    await waitFor(() =>
      expect(screen.getByTestId('row').textContent).toBe('three')
    );

    // The payoff: two further server-driven updates reached the DOM and the
    // component function did not run again for either of them.
    expect(renders.mock.calls.length).toBe(rendersAfterFirstChunk);
  });

  it('useDataSignal exposes the full LoaderState without subscribing the component', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          dripSseResponse([
            'data: {"title":"a"}\n\n',
            'data: {"title":"b"}\n\n',
          ])
        )
    );

    const ref = defineLoader<{ title: string }>(
      async () => ({ title: 'cold' }),
      { __moduleKey: 'signals-e2e-2' }
    );

    const renders = vi.fn();
    const seen: string[] = [];

    function Row() {
      renders();
      const state = useDataSignal<{ title: string }>();
      const label = useFieldSignal<{ title: string }, string>((d) => {
        // Records every value the derived signal computes, so we can prove the
        // updates really flowed rather than just landing a final value.
        seen.push(d.title);
        return d.title;
      }, 'pending');
      // Touch `state` so the accessor is exercised; do NOT read `.value`.
      expect(typeof state).toBe('object');
      return <p data-testid="row2">{label}</p>;
    }

    render(
      <LocationProvider>
        <RouteLocationsProvider>
          <Loader loader={ref}>
            <Row />
          </Loader>
        </RouteLocationsProvider>
      </LocationProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('row2').textContent).toBe('b')
    );
    expect(seen).toContain('a');
    expect(seen).toContain('b');
  });

  it('mutation guard: the same flow WITHOUT the signal impl re-renders per chunk', async () => {
    // Deregister so the runner falls back to its useState path. If this test
    // does NOT show extra renders, the first test proves nothing.
    registerReactiveImpl(null);
    try {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            dripSseResponse([
              'data: {"title":"one"}\n\n',
              'data: {"title":"two"}\n\n',
              'data: {"title":"three"}\n\n',
            ])
          )
      );

      const ref = defineLoader<{ title: string }>(
        async () => ({ title: 'cold' }),
        { __moduleKey: 'signals-e2e-control' }
      );

      const renders = vi.fn();

      function Row() {
        renders();
        const s = ref.useData();
        const title = s.status === 'loading' ? 'pending' : s.data.title;
        return <p data-testid="row3">{title}</p>;
      }

      render(
        <LocationProvider>
          <RouteLocationsProvider>
            <Loader loader={ref}>
              <Row />
            </Loader>
          </RouteLocationsProvider>
        </LocationProvider>
      );

      await waitFor(() =>
        expect(screen.getByTestId('row3').textContent).toBe('one')
      );
      const afterFirst = renders.mock.calls.length;
      await waitFor(() =>
        expect(screen.getByTestId('row3').textContent).toBe('three')
      );

      // The state path DOES re-render for the value-only chunks. This is the
      // baseline the signal path improves on.
      expect(renders.mock.calls.length).toBeGreaterThan(afterFirst);
    } finally {
      // MUST call the installer, not re-import: the module is cached and its
      // import-time side effect will not run again. An earlier version of this
      // test did the re-import, which silently left signals deregistered and
      // made the next test pass for the wrong reason.
      installSignalReactivity();
    }
  });
});

describe('E2E: does the additive-API promise hold?', () => {
  // §2 of the design doc promises `.View` / `.useData()` are "unchanged and
  // keep working". In signal mode the host deliberately skips re-rendering on
  // value-only updates, so this asks whether a useData() consumer living in the
  // same tree still sees those updates.
  it('a useData() consumer still updates while signals are installed', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          dripSseResponse([
            'data: {"title":"one"}\n\n',
            'data: {"title":"two"}\n\n',
            'data: {"title":"three"}\n\n',
          ])
        )
    );

    const ref = defineLoader<{ title: string }>(
      async () => ({ title: 'cold' }),
      { __moduleKey: 'signals-e2e-coexist' }
    );

    function Legacy() {
      const s = ref.useData();
      const title = s.status === 'loading' ? 'pending' : s.data.title;
      return <p data-testid="legacy">{title}</p>;
    }

    render(
      <LocationProvider>
        <RouteLocationsProvider>
          <Loader loader={ref}>
            <Legacy />
          </Loader>
        </RouteLocationsProvider>
      </LocationProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('legacy').textContent).toBe('one')
    );
    // If the host no longer re-renders on value-only updates, this consumer is
    // stuck on the first chunk.
    await waitFor(
      () => expect(screen.getByTestId('legacy').textContent).toBe('three'),
      { timeout: 1000 }
    );
  });
});
