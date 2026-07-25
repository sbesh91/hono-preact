// @vitest-environment happy-dom
/**
 * P1-10 mutation check: hooks now return STABLE signal identities
 * (`useComputed`/`useSignal` are `useMemo(..., [])`), so a signal placed in a
 * `useEffect`/`useMemo` dep array pins the effect at mount. And because
 * `Signal.prototype` defines `valueOf`/`toString`/`toJSON`, a variable consumed
 * only via a template literal, `String()`, `JSON.stringify` or an `unknown`
 * sink keeps type-checking AND keeps rendering the right characters while its
 * dep entry is frozen -- so the migration is NOT compiler-guided for these
 * shapes, and the repo has no linter (prettier + tsc only) to backstop it.
 *
 * There is no framework-side fix: the stable identity IS the API. These tests
 * PIN the trap so it cannot regress silently, and pin the correct spelling
 * beside it.
 */
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';
import { useOptimistic } from '../optimistic.js';

const BASE = 0;

describe('P1-10 signal in a dep array', () => {
  it('TRAP: an effect keyed on the returned SIGNAL is pinned at mount', () => {
    const effectSaw: number[] = [];
    let dispatch!: (p: number) => unknown;

    function Probe() {
      const [value, add] = useOptimistic<number, number>(
        BASE,
        (acc, p) => acc + p
      );
      dispatch = add;
      // The shape a dev writes after a mechanical `.value` migration: the
      // hook's return is still the variable they had before, so it lands in
      // the dep array unchanged. Dep identity is stable => never re-runs.
      useEffect(() => {
        effectSaw.push(value.value);
      }, [value]);
      return <span>{String(value.value)}</span>;
    }

    const { container } = render(<Probe />);
    expect(container.textContent).toBe('0');

    act(() => {
      dispatch(5);
    });
    expect(container.textContent).toBe('5');
    act(() => {
      dispatch(3);
    });
    expect(container.textContent).toBe('8');

    // The rendered output tracked every change; the effect saw only the mount
    // value. Before the signals migration this hook returned a plain value and
    // `[value]` re-ran the effect on every change.
    expect(effectSaw).toEqual([0]);
  });

  it('CORRECT SPELLING: keying on `signal.value` re-runs the effect', () => {
    const effectSaw: number[] = [];
    let dispatch!: (p: number) => unknown;

    function Probe() {
      const [value, add] = useOptimistic<number, number>(
        BASE,
        (acc, p) => acc + p
      );
      dispatch = add;
      useEffect(() => {
        effectSaw.push(value.value);
      }, [value.value]);
      return <span>{String(value.value)}</span>;
    }

    render(<Probe />);
    act(() => {
      dispatch(5);
    });
    act(() => {
      dispatch(3);
    });
    expect(effectSaw).toEqual([0, 5, 8]);
  });

  it('TRAP: coercion sinks render correct output while the effect beside them is frozen', () => {
    const effectSaw: string[] = [];
    let dispatch!: (p: number) => unknown;

    function sink(_x: unknown): void {}

    function Probe() {
      const [value, add] = useOptimistic<number, number>(
        BASE,
        (acc, p) => acc + p
      );
      dispatch = add;
      // Every one of these compiles with NO `.value` and produces the right
      // characters: Signal.prototype.toString / toJSON / valueOf.
      sink(value);
      useEffect(() => {
        effectSaw.push(`${value}`);
      }, [value]);
      return (
        <span>{`tpl=${value} str=${String(value)} json=${JSON.stringify({ t: value })}`}</span>
      );
    }

    const { container } = render(<Probe />);
    expect(container.textContent).toBe('tpl=0 str=0 json={"t":0}');

    act(() => {
      dispatch(7);
    });

    // Rendered output is correct and byte-for-byte what the dev intended...
    expect(container.textContent).toBe('tpl=7 str=7 json={"t":7}');
    // ...while the effect beside it never saw the change.
    expect(effectSaw).toEqual(['0']);
  });
});
