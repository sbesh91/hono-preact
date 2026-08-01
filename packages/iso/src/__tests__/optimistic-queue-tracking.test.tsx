// @vitest-environment happy-dom
// T6 (review round 3): `useOptimistic` read `queue.value` during render in the
// base-changed branch, subscribing the CALLING component to the queue. A caller
// that holds the returned signal and passes it to a leaf -- the pattern
// /docs/signals teaches as the point of the migration -- then re-rendered on the
// next dispatch anyway, which is the granularity it was trying to keep.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useOptimistic } from '../optimistic.js';

afterEach(cleanup);

describe('T6: holding the signal does not subscribe the host to the queue', () => {
  it('does not re-render the caller on dispatch after `base` changed', async () => {
    let hostRenders = 0;
    let dispatch!: (p: number) => unknown;

    function Host({ base }: { base: number[] }) {
      hostRenders++;
      // Holds the signal; never reads `.value`. A leaf would read it.
      const [, add] = useOptimistic(base, (cur: number[], p: number) => [
        ...cur,
        p,
      ]);
      dispatch = add;
      return null;
    }

    const { rerender } = render(<Host base={[1]} />);
    // The read only happens in the `base` changed branch, so drive that first.
    rerender(<Host base={[1, 2]} />);
    const before = hostRenders;

    await act(async () => {
      dispatch(3);
    });

    // Under the defect the render-time `queue.value` read subscribed Host, so
    // writing the queue re-rendered it.
    expect(hostRenders).toBe(before);
  });

  it('CONTROL: a component that READS the signal still updates', async () => {
    // Stops the test above from passing against a hook that stopped notifying
    // anyone at all.
    let seen: number[] = [];
    let dispatch!: (p: number) => unknown;
    function Leaf({ base }: { base: number[] }) {
      const [view, add] = useOptimistic(base, (cur: number[], p: number) => [
        ...cur,
        p,
      ]);
      dispatch = add;
      seen = view.value;
      return null;
    }
    render(<Leaf base={[1]} />);
    await act(async () => {
      dispatch(9);
    });
    expect(seen).toEqual([1, 9]);
  });
});
