// @vitest-environment happy-dom
/**
 * P1-4 mutation check: `useFormStatus` / `useActionResult` granularity vs the
 * deleted `useStoreSnapshot` bridge.
 *
 * The HEAD implementation projects a FRESH OBJECT LITERAL inside a single
 * `useComputed`. signals-core dedupes by `!==`, so the computed's version bumps
 * on every underlying store write and every binding re-renders, including for
 * writes keyed to a completely different action.
 *
 * The baseline column below reconstructs the pre-PR `useStoreSnapshot` bridge
 * verbatim (`git show 845a00ed:packages/iso/src/internal/use-store-snapshot.ts`
 * + `use-force-update.ts`) and drives it off the SAME store writes, so the two
 * render counts are directly comparable.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { useEffect, useRef, useReducer } from 'preact/hooks';
import { useFormStatus } from '../use-form-status.js';
import {
  beginSubmit,
  endSubmit,
  pendingSignal,
  pickIsPending,
} from '../internal/form-submit-store.js';
import { useActionResult } from '../use-action-result.js';
import {
  setLastActionResult,
  clearLastActionResult,
} from '../internal/action-result-store.js';

// ---------------------------------------------------------------------------
// Baseline (pre-PR) bridge, copied verbatim from 845a00ed.
// ---------------------------------------------------------------------------
function useForceUpdate(): () => void {
  const [, force] = useReducer((n: number, _action: void) => n + 1, 0);
  return force;
}

function useStoreSnapshot<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T
): T {
  const value = getSnapshot();
  const valueRef = useRef(value);
  const getSnapshotRef = useRef(getSnapshot);
  valueRef.current = value;
  getSnapshotRef.current = getSnapshot;
  const forceUpdate = useForceUpdate();

  useEffect(() => {
    const check = () => {
      const next = getSnapshotRef.current();
      if (!Object.is(next, valueRef.current)) {
        valueRef.current = next;
        forceUpdate();
      }
    };
    check();
    return subscribe(check);
  }, [subscribe]);

  return value;
}

// Stable module-level `subscribe`, driven by the same store writes HEAD uses.
// The pre-PR store's `subscribe` notified every listener on every begin/end
// submit; `pendingSignal.subscribe` has exactly that notification profile.
const baselineSubscribe = (cb: () => void) =>
  pendingSignal.subscribe(() => cb());

function useFormStatusBaseline(stub?: { __module: string; __action: string }): {
  pending: boolean;
} {
  const pending = useStoreSnapshot(baselineSubscribe, () =>
    pickIsPending(pendingSignal.peek(), stub)
  );
  return { pending };
}

// ---------------------------------------------------------------------------

const stubA = { __module: 'pages/a.server', __action: 'submit' };
const stubB = { __module: 'pages/b.server', __action: 'submit' };
const stubC = { __module: 'pages/c.server', __action: 'submit' };

afterEach(() => {
  cleanup();
  clearLastActionResult(stubA.__module, stubA.__action);
  clearLastActionResult(stubB.__module, stubB.__action);
});

describe('P1-4 useFormStatus granularity', () => {
  it('does not re-render a stub-A reader on writes for OTHER action keys', () => {
    let renders = 0;
    function ReaderA() {
      renders++;
      const status = useFormStatus(stubA as never);
      return (
        <span data-testid="a">{status.value.pending ? 'pending' : 'idle'}</span>
      );
    }

    const { container } = render(<ReaderA />);
    expect(container.textContent).toBe('idle');
    const before = renders;

    // Writes for a DIFFERENT form key (B) ...
    act(() => beginSubmit(stubB.__module, stubB.__action));
    act(() => endSubmit(stubB.__module, stubB.__action));
    // ... and for a key belonging to NEITHER reader (C).
    act(() => beginSubmit(stubC.__module, stubC.__action));
    act(() => endSubmit(stubC.__module, stubC.__action));

    // A's user-visible output never changed.
    expect(container.textContent).toBe('idle');
    // A must not have re-rendered at all.
    expect(renders - before).toBe(0);
  });

  it('BASELINE COLUMN: the pre-PR useStoreSnapshot bridge absorbed those writes', () => {
    let renders = 0;
    function ReaderA() {
      renders++;
      const status = useFormStatusBaseline(stubA);
      return <span data-testid="a">{status.pending ? 'pending' : 'idle'}</span>;
    }

    const { container } = render(<ReaderA />);
    expect(container.textContent).toBe('idle');
    const before = renders;

    act(() => beginSubmit(stubB.__module, stubB.__action));
    act(() => endSubmit(stubB.__module, stubB.__action));
    act(() => beginSubmit(stubC.__module, stubC.__action));
    act(() => endSubmit(stubC.__module, stubC.__action));

    expect(container.textContent).toBe('idle');
    expect(renders - before).toBe(0);
  });
});

describe('P1-4 useActionResult granularity', () => {
  it('is clean while the reader holds a null result', () => {
    let renders = 0;
    function ReaderA() {
      renders++;
      const r = useActionResult(stubA as never);
      return <pre data-testid="a">{JSON.stringify(r.value)}</pre>;
    }
    const { container } = render(<ReaderA />);
    expect(container.textContent).toBe('null');
    const before = renders;

    act(() =>
      setLastActionResult(stubB.__module, stubB.__action, {
        kind: 'success',
        data: { n: 1 },
        submittedPayload: null,
      })
    );
    act(() =>
      setLastActionResult(stubB.__module, stubB.__action, {
        kind: 'success',
        data: { n: 2 },
        submittedPayload: null,
      })
    );

    expect(container.textContent).toBe('null');
    expect(renders - before).toBe(0);
  });

  it('does not re-render a stub-A reader holding a NON-null result on writes for other keys', () => {
    setLastActionResult(stubA.__module, stubA.__action, {
      kind: 'success',
      data: { mine: true },
      submittedPayload: null,
    });

    let renders = 0;
    function ReaderA() {
      renders++;
      const r = useActionResult(stubA as never);
      return <pre data-testid="a">{JSON.stringify(r.value)}</pre>;
    }
    const { container } = render(<ReaderA />);
    const initial = container.textContent;
    expect(JSON.parse(initial!)).toMatchObject({ kind: 'success' });
    const before = renders;

    act(() =>
      setLastActionResult(stubB.__module, stubB.__action, {
        kind: 'success',
        data: { n: 1 },
        submittedPayload: null,
      })
    );
    act(() =>
      setLastActionResult(stubB.__module, stubB.__action, {
        kind: 'success',
        data: { n: 2 },
        submittedPayload: null,
      })
    );

    // A's rendered output is byte-identical...
    expect(container.textContent).toBe(initial);
    // ...so A must not have re-rendered.
    expect(renders - before).toBe(0);
  });
});
