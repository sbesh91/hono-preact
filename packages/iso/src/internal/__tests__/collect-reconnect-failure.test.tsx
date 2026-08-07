// @vitest-environment happy-dom
//
// What happens to a collect-mode stream when a RECONNECT fails after the stream
// has been healthy for a while.
//
// Two failures look alike and must not be treated alike:
//
//   cold    - the very first connect fails, nothing has ever been shown. There
//             is no data to keep, so routing to `errorFallback` is right.
//   warm    - chunks have been arriving, then a reconnect fails. The retained
//             chunks are still in memory and still on screen. Unmounting the
//             subtree throws away data the user is looking at.
//
// The distinction is structural, not temporal: "has this subscription ever
// delivered a chunk?" In fold mode the answer lives in the phase (chunks fold
// into it), so `setError` already gets this right. In collect mode chunks never
// touch the phase -- they append to the collect signals -- so a phase-only
// presence test reports "no value" no matter how long the stream ran.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { makeLiveLoaderHarness } from './helpers/live-harness.js';

afterEach(cleanup);

describe('collect-mode reconnect failure', () => {
  it('keeps the retained chunks on screen when a reconnect fails', async () => {
    const h = makeLiveLoaderHarness<number>();
    function Total() {
      const s = h.loader.useData(0, (acc, n) => acc + n);
      return (
        <p data-testid="total">
          {s.value.status === 'connecting' ? '-' : String(s.value.data)}
        </p>
      );
    }

    render(
      <h.Host errorFallback={<p data-testid="fallback">gone</p>}>
        <Total />
      </h.Host>
    );

    // A healthy stream: the user has been watching this for a while.
    await act(async () => {
      await h.push(2);
      await h.push(3);
    });
    expect(screen.getByTestId('total').textContent).toBe('5');

    // The connection drops and the reconnect fails.
    h.failNextConnect(new Error('reconnect refused'));
    await act(async () => {
      await h.reload();
    });

    // The subtree must survive. Unmounting it here discards a fold the user is
    // looking at, over a failure that changed nothing about the data.
    expect(screen.queryByTestId('fallback')).toBeNull();
    expect(screen.queryByTestId('total')).not.toBeNull();
  });

  it('surfaces a COLD connect failure IN-VIEW, not to the fallback', async () => {
    // The other half of the contract. A streaming loader's consumer already has
    // an error arm (`StreamState`'s `status === 'error'` with no data), which is
    // where the accumulating `.View` form puts a cold connect failure and what
    // `live-loaders.mdx` documents: "errorFallback does not catch a stream
    // connect failure." Collect-mode used to route it to the boundary instead,
    // which unmounted the subtree and made that error arm unreachable.
    const h = makeLiveLoaderHarness<number>();
    function Total() {
      const s = h.loader.useData(0, (acc, n) => acc + n);
      return <p data-testid="status">{s.value.status}</p>;
    }

    h.failNextConnect(new Error('never connected'));
    render(
      <h.Host errorFallback={<p data-testid="fallback">gone</p>}>
        <Total />
      </h.Host>
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByTestId('fallback')).toBeNull();
    expect(screen.getByTestId('status').textContent).toBe('error');
  });
});
