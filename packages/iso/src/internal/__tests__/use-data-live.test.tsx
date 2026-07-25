// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/preact';
import { useComputed } from '@preact/signals';
// A live loader test harness that lets the test push chunks. The exact harness
// mirrors the existing streaming loader tests (loader-streaming.test.tsx);
// reuse their chunk-driving helper for the underlying stream source.
import { makeLiveLoaderHarness } from './helpers/live-harness.js'; // create alongside, factoring the existing streaming test's driver
import { LoaderStreamContext } from '../contexts.js';
import { createCollectSignals, setCollectError } from '../loader-signal.js';

afterEach(cleanup);

describe('live useData(initial, reduce)', () => {
  it('folds chunks into a StreamState<Acc> signal, granularly', async () => {
    const h = makeLiveLoaderHarness<number>();
    function View() {
      const total = h.loader.useData(0, (acc, n) => acc + n);
      // bind a projection so only this node updates per chunk
      const shown = useComputed(() =>
        total.value.status === 'connecting'
          ? 'connecting'
          : String(total.value.data)
      );
      return <p data-testid="t">{shown}</p>;
    }
    render(
      <h.Host>
        <View />
      </h.Host>
    );
    expect(screen.getByTestId('t').textContent).toBe('connecting');
    await act(async () => h.push(2));
    expect(screen.getByTestId('t').textContent).toBe('2');
    await act(async () => h.push(3));
    expect(screen.getByTestId('t').textContent).toBe('5');
  });

  it('two consumers under one host fold the same stream independently (one subscription)', async () => {
    const h = makeLiveLoaderHarness<number>();
    function Sum() {
      const s = h.loader.useData(0, (a, n) => a + n);
      return (
        <p data-testid="sum">
          {s.value.status === 'connecting' ? '-' : String(s.value.data)}
        </p>
      );
    }
    function Count() {
      const c = h.loader.useData(0, (a) => a + 1);
      return (
        <p data-testid="count">
          {c.value.status === 'connecting' ? '-' : String(c.value.data)}
        </p>
      );
    }
    render(
      <h.Host>
        <Sum />
        <Count />
      </h.Host>
    );
    await act(async () => {
      await h.push(10);
      await h.push(20);
    });
    expect(screen.getByTestId('sum').textContent).toBe('30');
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(h.subscriptionCount()).toBe(1); // one stream, two folds
  });

  it('a late-mounting consumer folds from the retained log (no missed chunks)', async () => {
    const h = makeLiveLoaderHarness<number>();
    const Late = () => {
      const s = h.loader.useData(0, (a, n) => a + n);
      return (
        <p data-testid="late">
          {s.value.status === 'connecting' ? '-' : String(s.value.data)}
        </p>
      );
    };
    const { rerender } = render(
      <h.Host>
        <span />
      </h.Host>
    );
    await act(async () => {
      await h.push(1);
      await h.push(2);
      await h.push(3);
    });
    rerender(
      <h.Host>
        <Late />
      </h.Host>
    );
    // Late mount must reflect the full fold (1+2+3), not just chunks after mount.
    expect(screen.getByTestId('late').textContent).toBe('6');
  });

  it('is consumable through the PUBLIC .Boundary collect-mode host', async () => {
    // The public host: an app writes `<liveLoader.Boundary>` and folds inside
    // via `useData(initial, reduce)`, no reaching into internals.
    const h = makeLiveLoaderHarness<number>();
    const Boundary = h.loader.Boundary;
    function View() {
      const total = h.loader.useData(0, (acc, n) => acc + n);
      return (
        <p data-testid="b">
          {total.value.status === 'connecting'
            ? 'connecting'
            : String(total.value.data)}
        </p>
      );
    }
    render(
      <Boundary>
        <View />
      </Boundary>
    );
    expect(screen.getByTestId('b').textContent).toBe('connecting');
    await act(async () => {
      await h.push(4);
    });
    expect(screen.getByTestId('b').textContent).toBe('4');
  });

  // Regression for the review finding: `foldStream`'s `index`/`acc` closure
  // state never reset when the retained log reset on reload, so a resumed
  // stream's early chunks were silently skipped and folded onto the STALE
  // pre-reload total. Fixed via the `epoch` counter (`resetCollectSignals`
  // bumps it; `foldStream` detects the bump and refolds from scratch).
  it('a reload resets the fold: the new stream folds from scratch, dropping no chunks', async () => {
    const h = makeLiveLoaderHarness<number>();
    function View() {
      const total = h.loader.useData(0, (acc, n) => acc + n);
      return (
        <p data-testid="v">
          {total.value.status === 'connecting' ? '-' : String(total.value.data)}
        </p>
      );
    }
    render(
      <h.Host>
        <View />
      </h.Host>
    );
    await act(async () => {
      await h.push(1);
      await h.push(2);
      await h.push(3);
    });
    expect(screen.getByTestId('v').textContent).toBe('6');

    await act(async () => {
      await h.reload();
    });

    await act(async () => {
      await h.push(10);
      await h.push(20);
    });
    // The new stream's total, NOT 6 + 10 + 20 = 36 (stale carry-over) and not
    // missing the new stream's first chunk (10) either.
    await waitFor(() => expect(screen.getByTestId('v').textContent).toBe('30'));
  });

  // Regression for the review finding: `foldStream` hardcoded `present: true`
  // regardless of whether any chunk had actually folded, so a stream that
  // errors before its first chunk (a cold connect failure) reported
  // `{ status: 'error', data: initial }` -- a FABRICATED value the caller
  // never produced. Fixed by gating presence on "has this epoch folded any
  // chunk" (`index > 0`).
  //
  // LIMITATION (reported per the task, not papered over): this cannot be
  // driven end-to-end through `<h.Host>` with a REAL cold connect failure.
  // Collect-mode's `phase` (the state `loader.tsx` uses to decide `coldError`
  // routing) never carries a chunk value -- chunks fold only into the
  // `collect` signals `useData()` reads, never into `phase` -- so a cold
  // connect error ALWAYS lands `phase` on the tagless `error` variant, and
  // `LoaderHost` ALWAYS treats that exactly like a single-value loader's cold
  // error: it renders `errorFallback` INSTEAD OF `children` (unmounting the
  // `useData()` consumer before it can render anything) or, with none,
  // rethrows to an outer boundary. Either way no live `useData()` consumer
  // under a real `<Loader collect>` / `.Boundary` host ever gets a chance to
  // render mid-cold-error (unlike `.View`'s accumulate mode, whose cold
  // errors deliberately stay in-view; collect-mode's boundary-style routing
  // for a COLD failure appears to be intentional, matching `.Boundary`'s
  // name and its non-`Live` counterpart, and is a separate concern from this
  // task). So this test drives `LoaderStreamContext`'s REAL production
  // primitives directly -- `createCollectSignals` / `setCollectError`, the
  // exact functions `use-loader-runner.tsx` calls -- which is where
  // `foldStream`'s presence bug actually lives and is fully observable,
  // without needing a live `<Loader>` host or a parallel fake mechanism.
  it('a cold error (before any chunk) reports NO data, not the initial value', async () => {
    const h = makeLiveLoaderHarness<number>();
    const signals = createCollectSignals();
    function View() {
      const total = h.loader.useData(0, (acc, n) => acc + n);
      const hasData = 'data' in total.value;
      return (
        <p data-testid="v">
          {total.value.status}:{hasData ? String(total.value.data) : 'none'}
        </p>
      );
    }
    render(
      <LoaderStreamContext.Provider value={signals}>
        <View />
      </LoaderStreamContext.Provider>
    );
    expect(screen.getByTestId('v').textContent).toBe('connecting:none');
    await act(async () => {
      setCollectError(signals, new Error('connect refused'));
    });
    expect(screen.getByTestId('v').textContent).toBe('error:none');
  });
});
