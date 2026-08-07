// @vitest-environment happy-dom
// Collect-mode retains its chunks across a resubscribe on purpose: a failed
// reconnect must not take the user's fold with it. But `subscribeCollect` runs
// for a NAVIGATION too, and there retaining is wrong: `/stock/AAPL` ->
// `/stock/MSFT` kept serving AAPL's chunks, labelled `reconnecting`, until
// MSFT's first chunk landed, which for a quiet stream is indefinitely.
//
// Fold-mode never had this, because `subscribeFold` reseeds `session.acc =
// mode.initial` on every subscribe. The two streaming modes disagreed, which is
// the recurring shape of defects in this data layer: one branch carries a reset
// the other does not.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { defineLoader } from '../define-loader.js';
import { useLoaderRunner } from '../internal/use-loader-runner.js';
import { resolveLoaderMode } from '../internal/loader-mode.js';
import type { RouteHook } from 'preact-iso';

afterEach(cleanup);

const COLLECT = resolveLoaderMode(undefined, true);
const locFor = (path: string) =>
  ({ path, pathParams: {}, searchParams: {} }) as unknown as RouteHook;

describe('a collect host that navigates to a new target', () => {
  it('drops the previous location’s retained chunks', async () => {
    // Never ends, and yields only for the first location, so a retained chunk
    // from AAPL would sit on screen forever under the defect.
    const ref = defineLoader<string>(async function* (ctx) {
      const path = (ctx as unknown as { location?: { path?: string } }).location
        ?.path;
      if (path === '/stock/AAPL') yield 'AAPL-1';
      await new Promise(() => {});
    });

    type Captured = ReturnType<typeof useLoaderRunner<string>>;
    let captured: Captured;
    function Probe({ path }: { path: string }) {
      captured = useLoaderRunner<string>(
        ref as never,
        locFor(path),
        'collect-nav',
        COLLECT
      );
      return null;
    }

    const { rerender } = render(<Probe path="/stock/AAPL" />);

    await waitFor(() => {
      expect(captured!.collect!.run.value.length).toBe(1);
    });
    expect(captured!.collect!.run.value.chunks[0]).toBe('AAPL-1');

    rerender(<Probe path="/stock/MSFT" />);

    // The new target has produced nothing, so a consumer must see an empty,
    // cold run rather than AAPL's chunk dressed as a reconnect.
    expect(captured!.collect!.run.value.length).toBe(0);
    expect(captured!.collect!.run.value.chunks).toHaveLength(0);
    expect(captured!.collect!.run.value.status).toBe('connecting');
  });
});
