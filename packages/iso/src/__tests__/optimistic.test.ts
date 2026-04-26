// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/preact';
import { useOptimistic } from '../optimistic.js';

afterEach(() => {
  cleanup();
});

describe('useOptimistic', () => {
  it('returns base value when no entries are queued', () => {
    const { result } = renderHook(() =>
      useOptimistic([1, 2, 3], (current: number[], p: number) => [...current, p])
    );
    expect(result.current[0]).toEqual([1, 2, 3]);
  });

  it('addOptimistic appends an entry; reducer applies it to value', () => {
    const { result } = renderHook(() =>
      useOptimistic([1, 2], (current: number[], p: number) => [...current, p])
    );
    act(() => {
      result.current[1](3);
    });
    expect(result.current[0]).toEqual([1, 2, 3]);
  });

  it('handle.revert() removes the entry immediately', () => {
    const { result } = renderHook(() =>
      useOptimistic([1, 2], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](99);
    });
    expect(result.current[0]).toEqual([1, 2, 99]);
    act(() => {
      handle.revert();
    });
    expect(result.current[0]).toEqual([1, 2]);
  });

  it('handle.settle() keeps entry visible until base ref changes', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number[] }) =>
        useOptimistic(base, (current: number[], p: number) => [...current, p]),
      { initialProps: { base: [1, 2] } }
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](99);
    });
    expect(result.current[0]).toEqual([1, 2, 99]);

    // settle does not remove immediately
    act(() => {
      handle.settle();
    });
    expect(result.current[0]).toEqual([1, 2, 99]);

    // new base reference evicts the ready entry
    rerender({ base: [1, 2, 99] });
    expect(result.current[0]).toEqual([1, 2, 99]);
    // and the queue is empty — confirm by adding another entry that the reducer applies on the new base
    act(() => {
      result.current[1](100);
    });
    expect(result.current[0]).toEqual([1, 2, 99, 100]);
  });

  it('settling one of two leaves active entries intact through base change', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number[] }) =>
        useOptimistic(base, (current: number[], p: number) => [...current, p]),
      { initialProps: { base: [1] } }
    );
    let handleA!: { settle: () => void; revert: () => void };
    let handleB!: { settle: () => void; revert: () => void };
    act(() => {
      handleA = result.current[1](2);
    });
    act(() => {
      handleB = result.current[1](3);
    });
    expect(result.current[0]).toEqual([1, 2, 3]);

    // A settles (server confirmed); B still active
    act(() => {
      handleA.settle();
    });

    // base updates to reflect A's confirmed state — A:ready evicted; B:active remains
    rerender({ base: [1, 2] });
    expect(result.current[0]).toEqual([1, 2, 3]);

    // B then completes
    act(() => {
      handleB.settle();
    });
    rerender({ base: [1, 2, 3] });
    expect(result.current[0]).toEqual([1, 2, 3]);

    // Confirm queue is fully drained
    act(() => {
      result.current[1](4);
    });
    expect(result.current[0]).toEqual([1, 2, 3, 4]);
  });

  it('base ref change with no ready entries leaves queue intact', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number[] }) =>
        useOptimistic(base, (current: number[], p: number) => [...current, p]),
      { initialProps: { base: [1] } }
    );
    act(() => {
      result.current[1](99); // active entry, not settled
    });
    rerender({ base: [1, 2] });
    expect(result.current[0]).toEqual([1, 2, 99]);
  });

  it('multiple entries reduce in insertion order', () => {
    const { result } = renderHook(() =>
      useOptimistic('', (current: string, p: string) => current + p)
    );
    act(() => {
      result.current[1]('a');
    });
    act(() => {
      result.current[1]('b');
    });
    act(() => {
      result.current[1]('c');
    });
    expect(result.current[0]).toBe('abc');
  });

  it('revert is idempotent', () => {
    const { result } = renderHook(() =>
      useOptimistic([0], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](1);
    });
    act(() => {
      handle.revert();
    });
    act(() => {
      handle.revert();
    });
    expect(result.current[0]).toEqual([0]);
  });

  it('settle then revert removes the entry', () => {
    const { result } = renderHook(() =>
      useOptimistic([0], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](1);
    });
    act(() => {
      handle.settle();
    });
    act(() => {
      handle.revert();
    });
    expect(result.current[0]).toEqual([0]);
  });

  it('revert then settle is a no-op for the second call', () => {
    const { result } = renderHook(() =>
      useOptimistic([0], (current: number[], p: number) => [...current, p])
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](1);
    });
    act(() => {
      handle.revert();
    });
    act(() => {
      handle.settle();
    });
    expect(result.current[0]).toEqual([0]);
  });

  it('works with primitive base via Object.is equality', () => {
    const { result, rerender } = renderHook(
      ({ base }: { base: number }) =>
        useOptimistic(base, (current: number, p: number) => current + p),
      { initialProps: { base: 10 } }
    );
    let handle!: { settle: () => void; revert: () => void };
    act(() => {
      handle = result.current[1](5);
    });
    expect(result.current[0]).toBe(15);
    act(() => {
      handle.settle();
    });
    rerender({ base: 15 }); // new "base" reference (primitive, but Object.is(10, 15) is false)
    expect(result.current[0]).toBe(15);
  });
});
