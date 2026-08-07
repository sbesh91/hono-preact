// @vitest-environment happy-dom
// The overlay re-provides one loader channel with the projected arm. It guarded
// the identity of that arm only for the nothing-pending case; with something
// pending, `reduce` builds a fresh value every render, so every render of the
// overlay published a new arm and woke every `useData()` consumer below for a
// projection that had not changed.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { OptimisticOverlay } from '../internal/optimistic-overlay.js';
import { LoaderDataContext } from '../internal/contexts.js';
import { signal } from '@preact/signals';
import { useContext } from 'preact/hooks';

afterEach(cleanup);

describe('OptimisticOverlay re-provision identity', () => {
  it('does not wake consumers when a pending projection is unchanged', () => {
    let consumerRenders = 0;
    function Consumer() {
      consumerRenders++;
      const v = useContext(LoaderDataContext)?.value;
      return <span>{JSON.stringify(v)}</span>;
    }

    const source = signal({ status: 'success' as const, data: [1, 2] });

    function Tree({ tick }: { tick: number }) {
      return (
        <LoaderDataContext.Provider value={source as never}>
          <div data-tick={tick}>
            <OptimisticOverlay
              loader={{} as never}
              reducer={(base: number[], a: number) => [...(base ?? []), a]}
              pending={[9]}
            >
              <Consumer />
            </OptimisticOverlay>
          </div>
        </LoaderDataContext.Provider>
      );
    }

    const { rerender } = render(<Tree tick={0} />);
    const before = consumerRenders;

    rerender(<Tree tick={1} />);
    rerender(<Tree tick={2} />);

    // The overlay re-rendered twice; the projection is identical each time.
    expect(consumerRenders).toBe(before);
  });
});
