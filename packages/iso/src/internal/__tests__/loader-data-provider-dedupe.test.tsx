// @vitest-environment happy-dom
// `LoaderDataProvider` owns the loader channel's signal IDENTITY, but wrote
// whatever it was handed, so the "an unchanged state is a no-op" half of its
// contract lived in every CALLER instead. That is a convention, not an
// invariant, and `OptimisticOverlay` had already broken it (#361).
//
// These pin the property at the boundary: hand it an equivalent-but-fresh arm
// and no consumer below is woken, whoever the caller is.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import { LoaderDataProvider } from '../loader-data-provider.js';
import { LoaderDataContext } from '../contexts.js';
import type { LoaderData } from '../contexts.js';

afterEach(cleanup);

describe('LoaderDataProvider publish dedupe', () => {
  // Counts NOTIFICATIONS on the provided signal, not component renders.
  // Preact re-renders a subtree when its parent renders regardless of any
  // signal, so a render count cannot isolate what this boundary controls; the
  // question is only ever "did the channel publish".
  function harness() {
    let cell: { subscribe: (f: (v: LoaderData) => void) => () => void } | null =
      null;
    function Capture() {
      const c = useContext(LoaderDataContext);
      if (c && !cell) cell = c;
      return null;
    }
    return {
      get cell() {
        return cell;
      },
      Capture,
    };
  }

  it('does not publish an equivalent-but-fresh arm', () => {
    const movies = [{ id: 1 }, { id: 2 }];
    const arm = (): LoaderData =>
      ({ status: 'success', data: [...movies] }) as unknown as LoaderData;
    const h = harness();

    function Tree({ tick }: { tick: number }) {
      return (
        <LoaderDataProvider state={arm()}>
          <div data-tick={tick}>
            <h.Capture />
          </div>
        </LoaderDataProvider>
      );
    }

    const { rerender } = render(<Tree tick={0} />);
    let notifications = 0;
    // `subscribe` fires once immediately with the current value; count after.
    const stop = h.cell!.subscribe(() => notifications++);
    notifications = 0;

    rerender(<Tree tick={1} />);
    rerender(<Tree tick={2} />);
    stop();

    expect(notifications).toBe(0);
  });

  it('CONTROL: a real data change publishes', () => {
    const h = harness();
    function Tree({ data }: { data: unknown }) {
      return (
        <LoaderDataProvider
          state={{ status: 'success', data } as unknown as LoaderData}
        >
          <h.Capture />
        </LoaderDataProvider>
      );
    }
    const { rerender } = render(<Tree data={[1]} />);
    let notifications = 0;
    const stop = h.cell!.subscribe(() => notifications++);
    notifications = 0;

    rerender(<Tree data={[1, 2]} />);
    stop();

    expect(notifications).toBe(1);
  });

  it('CONTROL: a status change with identical data publishes', () => {
    const h = harness();
    const data = [1];
    function Tree({ status }: { status: string }) {
      return (
        <LoaderDataProvider state={{ status, data } as unknown as LoaderData}>
          <h.Capture />
        </LoaderDataProvider>
      );
    }
    const { rerender } = render(<Tree status="success" />);
    let notifications = 0;
    const stop = h.cell!.subscribe(() => notifications++);
    notifications = 0;

    rerender(<Tree status="revalidating" />);
    stop();

    expect(notifications).toBe(1);
  });
});
