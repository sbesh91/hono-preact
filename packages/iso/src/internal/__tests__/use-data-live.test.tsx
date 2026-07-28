// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/preact';
import { useComputed } from '@preact/signals';
// A live loader test harness that lets the test push chunks. The exact harness
// mirrors the existing streaming loader tests (loader-streaming.test.tsx);
// reuse their chunk-driving helper for the underlying stream source.
import { makeLiveLoaderHarness } from './helpers/live-harness.js'; // create alongside, factoring the existing streaming test's driver

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
  // state never reset when the retained chunks reset on reload, so a resumed
  // stream's early chunks were silently skipped and folded onto the STALE
  // pre-reload total. A generation is now the chunks array's IDENTITY: the
  // first chunk after a resubscribe mints a new array, and `foldStream`
  // refolds from scratch when it sees one.
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
  // `{ status: 'error', data: initial }` -- a FABRICATED value the caller never
  // produced. Presence is now gated on "has this generation folded any chunk"
  // (`index > 0`).
  //
  // This drives the REAL host end to end. It could not, once: collect-mode used
  // to route a cold connect failure to `errorFallback`, which unmounted the
  // `useData()` consumer before it could render anything, so the test reached
  // for `createCollectSignals` / `setCollectError` directly instead. Both
  // reasons are gone -- collect-mode surfaces stream failures in-view like
  // fold-mode does, and the harness can fail a connect on demand -- so the
  // detour is no longer worth its explanation.
  it('a cold error (before any chunk) reports NO data, not the initial value', async () => {
    const h = makeLiveLoaderHarness<number>();
    function View() {
      const total = h.loader.useData(0, (acc, n) => acc + n);
      const hasData = 'data' in total.value;
      return (
        <p data-testid="v">
          {total.value.status}:{hasData ? String(total.value.data) : 'none'}
        </p>
      );
    }

    h.failNextConnect(new Error('connect refused'));
    render(
      <h.Host>
        <View />
      </h.Host>
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // `error:none`, never `error:0`: the caller's `initial` is not data.
    expect(screen.getByTestId('v').textContent).toBe('error:none');
  });
});
