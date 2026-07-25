// @vitest-environment happy-dom
// A NON-STREAMING loader hosted with `accumulate`. `LoaderRef<T, false>` declares
// `accumulate` on `.Boundary`, so this is a supported host, and it must run in
// FOLD mode on both sides. It is the case `resolveLoaderMode` protects by testing
// `accumulate` BEFORE `isStreaming`: resolving it to `single` instead would bake
// the value into `data-loader` on the server while the client rendered the
// streaming union, i.e. a hydration mismatch rather than a visible failure.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import type { RouteHook } from 'preact-iso';
import { LocationProvider } from 'preact-iso';
import { prerender } from 'preact-iso/prerender';
import { defineLoader } from '../define-loader.js';
import { useLoaderRunner } from '../internal/use-loader-runner.js';
import { resolveLoaderMode } from '../internal/loader-mode.js';
import { env } from '../is-browser.js';

const LOC = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;
const originalEnv = env.current;

const accumulate = {
  initial: [] as unknown,
  reduce: (acc: unknown, chunk: unknown) =>
    (acc as number[]).concat(chunk as number),
};

afterEach(() => {
  env.current = originalEnv;
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('non-streaming loader + accumulate: SSR', () => {
  it('bakes NO value into the envelope', async () => {
    const ref = defineLoader<number>(async () => 41);
    const App = () => (
      <LocationProvider>
        <ref.Boundary accumulate={accumulate}>
          <p>child</p>
        </ref.Boundary>
      </LocationProvider>
    );

    env.current = 'server';
    const { html } = await prerender(<App />);

    // `data-loader="null"` is the whole point: an accumulating consumer never
    // adopts a baked value (it re-subscribes on mount), so the server must not
    // write one. Under `single` mode this envelope would carry the value.
    expect(html).toContain('data-loader="null"');
    expect(html).not.toContain('data-loader="41"');
  });
});

describe('non-streaming loader + accumulate: client', () => {
  it('projects the StreamState and folds the resolved value through reduce', async () => {
    const ref = defineLoader<number>(async () => 41);
    type Captured = ReturnType<typeof useLoaderRunner<number>>;
    let captured: Captured;

    // Drive the runner directly with the mode `.Boundary` resolves, so the
    // assertion is about the projected union itself rather than about what a
    // particular consumer hook narrows it back down to.
    function Probe() {
      captured = useLoaderRunner<number>(
        ref,
        LOC,
        'acc-probe',
        resolveLoaderMode(accumulate, false)
      );
      return null;
    }

    render(<Probe />);

    // First render: the streaming lifecycle's cold arm, NOT the single-value
    // `loading` arm that `single` mode would have produced here.
    if (captured!.view.kind !== 'render') throw new Error('expected render');
    expect(captured!.view.state.status).toBe('connecting');

    // Once the loader settles, the value has been folded through `reduce`: the
    // view carries `[41]`, not the raw `41` a single-value host would surface.
    await waitFor(() => {
      if (captured!.view.kind !== 'render') throw new Error('expected render');
      expect(captured!.view.state.status).toBe('open');
    });
    if (captured!.view.kind !== 'render') throw new Error('expected render');
    expect(captured!.view.state.data).toEqual([41]);
  });
});
