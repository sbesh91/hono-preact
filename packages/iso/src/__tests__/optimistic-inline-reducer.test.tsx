// @vitest-environment happy-dom
// `useOptimistic` holds `reducer` in a signal so a reducer closing over changing
// props does not stay pinned to the mount render's copy. That signal was written
// unconditionally every render, and an inline arrow is a fresh identity every
// render, so the write always notified.
//
// The question these pin: does that notification reach a component that reads
// the projection, and does it sustain itself while an optimistic entry is
// pending (when the recomputed value is also a fresh array)?
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import { useOptimistic } from '../optimistic.js';

afterEach(cleanup);

describe('useOptimistic with an inline reducer', () => {
  it('does not loop while an optimistic entry is pending', async () => {
    let renders = 0;
    let dispatch!: (p: number) => unknown;

    function Host() {
      renders++;
      if (renders > 40) throw new Error(`render loop: ${renders} renders`);
      // Inline arrow: a new reducer identity on every single render.
      const [view, add] = useOptimistic<number[], number>([1, 2], (cur, p) => [
        ...cur,
        p,
      ]);
      dispatch = add;
      return <span>{view.value.join(',')}</span>;
    }

    render(<Host />);
    const afterMount = renders;

    // Queue non-empty from here on, so the projection recomputes to a FRESH
    // array each time it is invalidated.
    await act(async () => {
      dispatch(3);
    });
    const afterDispatch = renders;

    // Give any self-sustaining cycle several turns to show itself.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(renders).toBe(afterDispatch);
    expect(renders - afterMount).toBeLessThanOrEqual(2);
  });

  it('CONTROL: the pending entry is actually projected', async () => {
    let seen = '';
    let dispatch!: (p: number) => unknown;
    function Host() {
      const [view, add] = useOptimistic<number[], number>([1, 2], (cur, p) => [
        ...cur,
        p,
      ]);
      dispatch = add;
      seen = view.value.join(',');
      return null;
    }
    render(<Host />);
    await act(async () => {
      dispatch(3);
    });
    expect(seen).toBe('1,2,3');
  });

  it('a reducer closing over changing props still folds with the latest one', async () => {
    let seen = '';
    let dispatch!: (p: number) => unknown;
    function Host({ mult }: { mult: number }) {
      const [view, add] = useOptimistic<number[], number>([], (cur, p) => [
        ...cur,
        p * mult,
      ]);
      dispatch = add;
      seen = view.value.join(',');
      return null;
    }
    const { rerender } = render(<Host mult={1} />);
    rerender(<Host mult={10} />);
    await act(async () => {
      dispatch(3);
    });
    // The whole reason `reducer` is held in a signal rather than captured.
    expect(seen).toBe('30');
  });
});

describe('useOptimistic: an inline reducer and a bound leaf', () => {
  it('does not re-render the leaf when nothing about the projection changed', async () => {
    let leafRenders = 0;
    let dispatch!: (p: number) => unknown;

    function Leaf({ view }: { view: { value: number[] } }) {
      leafRenders++;
      return <span>{view.value.join(',')}</span>;
    }
    function Host({ tick }: { tick: number }) {
      const [view, add] = useOptimistic<number[], number>([1, 2], (cur, p) => [
        ...cur,
        p,
      ]);
      dispatch = add;
      return (
        <div data-tick={tick}>
          <Leaf view={view} />
        </div>
      );
    }

    const { rerender } = render(<Host tick={0} />);
    await act(async () => {
      dispatch(3);
    });
    const before = leafRenders;

    // Host re-renders for its own reasons. The projection is unchanged, so the
    // leaf bound to it has nothing to do.
    await act(async () => {
      rerender(<Host tick={1} />);
    });

    expect(leafRenders).toBe(before);
  });
});
