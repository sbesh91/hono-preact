// @vitest-environment happy-dom
/**
 * P1-3 mutation check: `useOptimistic().settle()` captures `queue.signal.value`
 * BEFORE `runWithTransition`, then writes `current.map(...)` from inside the
 * deferred mutator, clobbering anything enqueued in between. `revert` reads
 * FRESH inside the mutator and is immune.
 *
 * The existing suite (`optimistic-transition.test.ts:31-38`, `:57-64`) stubs
 * `document.startViewTransition` so the callback runs SYNCHRONOUSLY, which is
 * not a behaviour any browser has -- the spec runs the update callback in a
 * later "update the DOM" step. That synchronous stub is exactly why the
 * existing suite is green. The stub below genuinely DEFERS.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/preact';
import type { ReadonlySignal } from '@preact/signals';
import { useOptimistic, type OptimisticHandle } from '../optimistic.js';

declare global {
  interface Document {
    startViewTransition?: (cb: () => unknown) => {
      finished: Promise<void>;
      ready: Promise<void>;
      updateCallbackDone: Promise<void>;
    };
  }
}

// A DEFERRING startViewTransition: the update callback is parked and only runs
// when the test explicitly flushes, modelling the >=1-frame delay a real
// browser imposes. (Per spec, a transition skipped by a later one still runs
// its update callback, so parking both callbacks of two concurrent
// transitions is faithful.)
const parked: Array<() => unknown> = [];

function installDeferringSVT() {
  document.startViewTransition = ((cb: () => unknown) => {
    parked.push(cb);
    return {
      finished: Promise.resolve(),
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
    };
  }) as never;
}

async function flushTransitions() {
  const cbs = parked.splice(0);
  for (const cb of cbs) await cb();
}

let originalSVT: typeof document.startViewTransition | undefined;
beforeEach(() => {
  originalSVT = document.startViewTransition;
  parked.length = 0;
  installDeferringSVT();
});
afterEach(() => {
  if (originalSVT === undefined) {
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  } else {
    document.startViewTransition = originalSVT;
  }
});

// Stable base references (the hook documents `base` must be stable).
const BASE_1: string[] = ['server'];
const BASE_2: string[] = ['server', 'saved-x'];

type Harness = {
  value: ReadonlySignal<string[]>;
  dispatch: (p: string) => OptimisticHandle;
};
let h!: Harness;

function Probe({ base }: { base: string[] }) {
  const [value, dispatch] = useOptimistic<string[], string>(
    base,
    (acc, p) => [...acc, p],
    { transition: true }
  );
  h = { value, dispatch };
  return <span>{value.value.join('|')}</span>;
}

describe('P1-3 useOptimistic settle() pre-transition snapshot', () => {
  it('S1: a mutation enqueued between settle() and the deferred flush survives', async () => {
    const { container } = render(<Probe base={BASE_1} />);
    expect(container.textContent).toBe('server');

    let hx!: OptimisticHandle;
    act(() => {
      hx = h.dispatch('x');
    });
    expect(container.textContent).toBe('server|x');

    // settle() parks its mutator...
    act(() => hx.settle());
    // ...and a second optimistic mutation lands before the frame flushes.
    act(() => {
      h.dispatch('y');
    });
    expect(container.textContent).toBe('server|x|y');

    await act(async () => {
      await flushTransitions();
    });

    // 'y' is still pending: it must not be erased by x's settle.
    expect(container.textContent).toBe('server|x|y');
  });

  it('S2: two concurrent settles in the same frame both reach `ready` (loser is not stuck active forever)', async () => {
    const { container, rerender } = render(<Probe base={BASE_1} />);

    let hx!: OptimisticHandle;
    let hy!: OptimisticHandle;
    act(() => {
      hx = h.dispatch('x');
    });
    act(() => {
      hy = h.dispatch('y');
    });
    expect(container.textContent).toBe('server|x|y');

    // Both settle in the same frame, before either mutator has run.
    act(() => hx.settle());
    act(() => hy.settle());

    await act(async () => {
      await flushTransitions();
    });

    // Server data arrives carrying BOTH mutations; `base`-change eviction drops
    // `ready` entries, so nothing optimistic should be folded on top.
    rerender(<Probe base={BASE_2} />);
    await act(async () => {});

    expect(container.textContent).toBe('server|saved-x');
  });
});
