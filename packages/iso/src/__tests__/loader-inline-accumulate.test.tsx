// @vitest-environment happy-dom
// `useStableLoaderMode` pins the mode object so the runner's mode-keyed
// `useMemo`/`useCallback`s are built once. It memoizes on `[kind, initial,
// reduce]`, and a host authored the natural way
//
//     <loader.Boundary accumulate={{ initial: [], reduce: (a, c) => [...a, c] }} />
//
// hands it a fresh `initial` and `reduce` on every render, so the memo misses
// every time and the mode identity churns. The existing guard test hoists its
// `accumulate` to module scope, which is what let this go unnoticed.
//
// The consequence that matters is `foldGuard`: it is `useMemo(..., [mode])` and
// captures a fingerprint of `initial` at construction, so rebuilding it mid
// stream re-baselines it against a NEW empty `initial` that is no longer the
// accumulator being folded. `check` then early-returns forever and a reducer
// that corrupts `initial` runs undetected from that point on.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/preact';
import { defineLoader } from '../define-loader.js';
import { useLoaderRunner } from '../internal/use-loader-runner.js';
import { resolveLoaderMode } from '../internal/loader-mode.js';

afterEach(cleanup);

const LOC = { path: '/', params: {}, search: '' } as never;

describe('a fold host whose `accumulate` is authored inline', () => {
  it('still rejects a reducer that mutates `initial`, past the first chunk', async () => {
    // Streams several chunks, so the guard has to survive the re-renders the
    // chunks themselves cause.
    const ref = defineLoader(async function* () {
      yield 1;
      yield 2;
      yield 3;
    });

    type Captured = ReturnType<typeof useLoaderRunner<number>>;
    let captured: Captured;
    function Probe() {
      // Fresh `initial` and `reduce` every render, as JSX props are.
      captured = useLoaderRunner<number>(
        ref as never,
        LOC,
        'inline-acc-mutating',
        resolveLoaderMode(
          {
            initial: [] as unknown,
            reduce: (acc: unknown, chunk: unknown) => {
              (acc as number[]).push(chunk as number);
              return acc;
            },
          },
          true
        )
      );
      return null;
    }

    render(<Probe />);

    await waitFor(() => {
      if (captured!.view.kind !== 'render') throw new Error('expected render');
      expect(captured!.view.state.status).toBe('error');
    });
    if (captured!.view.kind !== 'render') throw new Error('expected render');
    const state = captured!.view.state;
    if (state.status !== 'error') throw new Error('expected error');
    expect(state.error.message).toMatch(/must not mutate its accumulator/);
  });
});

describe('a fold host whose inline `reduce` closes over changing props', () => {
  it('folds with the CURRENT reducer, not the one from the first render', async () => {
    // The mode object is pinned for the host's lifetime, so `reduce` has to be
    // reached through a ref rather than captured. Pinning the whole mode
    // (including `reduce`) would leave this folding with `mult` as of mount.
    let push!: (n: number) => void;
    const ref = defineLoader(async function* () {
      yield await new Promise<number>((r) => {
        push = r;
      });
    });

    type Captured = ReturnType<typeof useLoaderRunner<number>>;
    let captured: Captured;
    function Probe({ mult }: { mult: number }) {
      captured = useLoaderRunner<number>(
        ref as never,
        LOC,
        'inline-acc-latest',
        resolveLoaderMode(
          {
            initial: [] as unknown,
            reduce: (acc: unknown, chunk: unknown) => [
              ...(acc as number[]),
              (chunk as number) * mult,
            ],
          },
          true
        )
      );
      return null;
    }

    const { rerender } = render(<Probe mult={1} />);
    rerender(<Probe mult={10} />);
    await waitFor(() => expect(typeof push).toBe('function'));
    push(3);

    await waitFor(() => {
      if (captured!.view.kind !== 'render') throw new Error('expected render');
      const s = captured!.view.state;
      if (s.status !== 'open' && s.status !== 'closed') throw new Error('wait');
      expect(s.data).toEqual([30]);
    });
  });
});
