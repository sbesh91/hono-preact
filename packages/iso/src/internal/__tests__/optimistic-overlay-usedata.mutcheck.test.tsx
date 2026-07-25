// @vitest-environment happy-dom
// P0-1 mutation check: does <OptimisticOverlay>'s projection still reach a
// descendant's `loader.useData()`? Asserts THROUGH `useData()` rendered in a
// real component under a real <OptimisticOverlay> under a real loader host,
// never by reading a context directly (that is what the existing suite does,
// and that is why it is blind).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/preact';
import { useContext } from 'preact/hooks';
import type { JSX } from 'preact';
import { defineLoader } from '../../define-loader.js';
import { Loader } from '../loader.js';
import { LoaderDataContext } from '../contexts.js';
import { OptimisticOverlay } from '../optimistic-overlay.js';
import type { RouteHook } from 'preact-iso';

const loc = {
  path: '/',
  pathParams: {},
  searchParams: {},
} as unknown as RouteHook;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Todo = { id: string; text: string };
type Action = { kind: 'add'; todo: Todo };

// Tolerates an absent base (the cold-load arm seeds the reduce from `undefined`).
const reducer = (base: Todo[] | undefined, action: Action): Todo[] => [
  ...(base ?? []),
  action.todo,
];

/** A real consumer: reads the loader through the PUBLIC `useData()` API. */
function Consumer(): JSX.Element {
  const state = todoLoaderRef.current!.useData();
  const v = state.value;
  const ids =
    v.status === 'loading'
      ? '(none)'
      : (v.data as Todo[] | undefined)?.map((t) => t.id).join(',') || '(empty)';
  return (
    <>
      <p data-testid="status">{v.status}</p>
      <p data-testid="ids">{ids}</p>
    </>
  );
}

// A tiny indirection so `Consumer` can be declared once and bound per test.
const todoLoaderRef: { current: ReturnType<typeof makeLoader> | null } = {
  current: null,
};
function makeLoader(fn: () => Promise<Todo[]>) {
  return defineLoader<Todo[]>(fn);
}

describe('P0-1 <OptimisticOverlay> projection reaches loader.useData()', () => {
  it('(a) settled success: useData() sees the optimistically projected data', async () => {
    const loader = makeLoader(async () => [{ id: 'a', text: 'first' }]);
    todoLoaderRef.current = loader;

    render(
      <Loader loader={loader} location={loc}>
        <OptimisticOverlay
          loader={loader}
          reducer={reducer}
          pending={[{ kind: 'add', todo: { id: 'b', text: 'second' } }]}
        >
          <Consumer />
        </OptimisticOverlay>
      </Loader>
    );

    // Wait for the real load to settle first.
    await waitFor(() =>
      expect(screen.getByTestId('status').textContent).toBe('success')
    );
    // The optimistic item MUST be visible to `useData()`.
    expect(screen.getByTestId('ids').textContent).toBe('a,b');
  });

  it('(b) cold loading + pending: useData() sees `revalidating` with the optimistic item', async () => {
    // Never settles: the host stays on the cold `loading` arm.
    const loader = makeLoader(() => new Promise<Todo[]>(() => {}));
    todoLoaderRef.current = loader;

    render(
      <Loader loader={loader} location={loc}>
        <OptimisticOverlay
          loader={loader}
          reducer={reducer}
          pending={[{ kind: 'add', todo: { id: 'b', text: 'second' } }]}
        >
          <Consumer />
        </OptimisticOverlay>
      </Loader>
    );

    await waitFor(() =>
      expect(screen.getByTestId('ids').textContent).toBe('b')
    );
    expect(screen.getByTestId('status').textContent).toBe('revalidating');
  });

  // Baseline-parity probe. At merge base 845a00ed, `useData()` WAS literally
  // `useContext(LoaderDataContext)` + an `isLoaderState` narrow + `return ctx`
  // (see `git show 845a00ed:packages/iso/src/define-loader.ts`). This probe
  // reproduces that body, so if it sees the projection then the pre-PR
  // behaviour is established by construction and the failures above are a
  // released-API PARITY BREAK, not a pre-existing gap. The one adaptation:
  // that context carried the union as a plain snapshot, so the equivalent read
  // today unwraps the channel's signal (`?.value`) before the same field read.
  it('(baseline parity) the merge-base useData() body DOES see the projection', async () => {
    const loader = makeLoader(async () => [{ id: 'a', text: 'first' }]);

    function BaselineConsumer(): JSX.Element {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const ctx = useContext(LoaderDataContext)?.value ?? null;
      const ids =
        ctx && 'data' in ctx && ctx.data
          ? (ctx.data as Todo[]).map((t) => t.id).join(',')
          : '(none)';
      return <p data-testid="baseline-ids">{ids}</p>;
    }

    render(
      <Loader loader={loader} location={loc}>
        <OptimisticOverlay
          loader={loader}
          reducer={reducer}
          pending={[{ kind: 'add', todo: { id: 'b', text: 'second' } }]}
        >
          <BaselineConsumer />
        </OptimisticOverlay>
      </Loader>
    );

    await waitFor(() =>
      expect(screen.getByTestId('baseline-ids').textContent).toBe('a,b')
    );
  });
});
