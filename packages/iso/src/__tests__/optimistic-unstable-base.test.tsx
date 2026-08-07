// @vitest-environment happy-dom
// `useOptimistic` tracks `base` as a signal so the projection re-derives when
// the real data changes while the queue is idle. It compared the incoming
// `base` by REFERENCE, so the shapes an author reaches for first -- an inline
// `?? []` fallback, an inline `.filter(...)`, a spread -- handed it a fresh
// reference holding identical contents on every render. Each one notified the
// projection, and a component that both builds `base` inline and reads the
// returned signal re-rendered itself in a loop.
//
// The contract these tests pin: `base` is compared by CONTENTS (shallow), so an
// equal-but-fresh reference is inert and a genuinely changed one still lands.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import type { ReadonlySignal } from '@preact/signals';
import { useOptimistic } from '../optimistic.js';

afterEach(cleanup);

const append = (cur: number[], p: number): number[] => [...cur, p];

describe('useOptimistic: an unstable `base` reference is inert', () => {
  it('does not notify a bound leaf when a fresh `base` holds the same items', () => {
    let leafRenders = 0;

    function Leaf({ view }: { view: ReadonlySignal<number[]> }) {
      leafRenders++;
      return <span>{view.value.join(',')}</span>;
    }

    // Rebuilds `base` every render, exactly as `data?.movies ?? []` does.
    function Host({ items }: { items: number[] }) {
      const [view] = useOptimistic(
        items.filter(() => true),
        append
      );
      return <Leaf view={view} />;
    }

    const { rerender } = render(<Host items={[1, 2]} />);
    const before = leafRenders;

    rerender(<Host items={[1, 2]} />);
    rerender(<Host items={[1, 2]} />);

    // Under the reference comparison each rerender wrote `baseState`, which
    // notified the projection and re-rendered the bound leaf for no change.
    expect(leafRenders).toBe(before);
  });

  it('CONTROL: a genuinely changed `base` still reaches the leaf', () => {
    let seen = '';

    function Leaf({ view }: { view: ReadonlySignal<number[]> }) {
      seen = view.value.join(',');
      return null;
    }

    function Host({ items }: { items: number[] }) {
      const [view] = useOptimistic(
        items.filter(() => true),
        append
      );
      return <Leaf view={view} />;
    }

    const { rerender } = render(<Host items={[1, 2]} />);
    expect(seen).toBe('1,2');

    rerender(<Host items={[1, 2, 3]} />);
    expect(seen).toBe('1,2,3');
  });

  it('CONTROL: dispatch still folds over the latest `base`', async () => {
    let seen = '';
    let dispatch!: (p: number) => unknown;

    function Host({ items }: { items: number[] }) {
      const [view, add] = useOptimistic(
        items.filter(() => true),
        append
      );
      dispatch = add;
      seen = view.value.join(',');
      return null;
    }

    const { rerender } = render(<Host items={[1]} />);
    rerender(<Host items={[1, 2]} />);

    await act(async () => {
      dispatch(9);
    });

    expect(seen).toBe('1,2,9');
  });

  it('does not loop when the component both builds `base` inline and reads the signal', async () => {
    // The documented footgun as its own component: the host reads `.value` (so
    // a `base` notification re-renders it) and rebuilds `base` on every render
    // (so that re-render notifies again). It takes a second render to enter the
    // cycle, because the first is what establishes the reference to differ
    // from; one external rerender is enough to start it.
    let renders = 0;

    function Host() {
      renders++;
      // A render cap rather than letting the suite hang: a loop surfaces as an
      // exceeded budget with a readable count, not a timeout.
      if (renders > 25) throw new Error(`render loop: ${renders} renders`);
      const [view] = useOptimistic<number[], number>([], append);
      return <span>{view.value.length}</span>;
    }

    const { rerender } = render(<Host />);
    await act(async () => {
      rerender(<Host />);
    });

    expect(renders).toBeLessThanOrEqual(2);
  });
});
