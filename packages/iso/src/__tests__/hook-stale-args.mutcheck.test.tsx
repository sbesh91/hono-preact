// @vitest-environment happy-dom
/**
 * P1-5 mutation check: `useActionResult` / `useFormStatus` return a STALE value
 * when the `stub` argument changes, because the whole hook body lives inside one
 * `useComputed` (`useMemo(..., [])` in the shipped adapter) whose closure is
 * refreshed but never re-invoked absent a tracked-signal write.
 *
 * The third block checks whether the same staleness reproduces for
 * `useOptimistic`'s `reducer`, which `optimistic.ts:70-75` also captures as a
 * plain closure (while mirroring `base` into a tracked signal 30 lines above).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { useFormStatus } from '../use-form-status.js';
import { beginSubmit, endSubmit } from '../internal/form-submit-store.js';
import { useActionResult } from '../use-action-result.js';
import {
  setLastActionResult,
  clearLastActionResult,
} from '../internal/action-result-store.js';
import { useOptimistic } from '../optimistic.js';

const createTodo = { __module: 'pages/todos.server', __action: 'create' };
const updateTodo = { __module: 'pages/todos.server', __action: 'update' };

afterEach(() => {
  cleanup();
  clearLastActionResult(createTodo.__module, createTodo.__action);
  clearLastActionResult(updateTodo.__module, updateTodo.__action);
});

describe('P1-5 useFormStatus stale stub', () => {
  it('reports idle for the NEW action after the stub prop is swapped', () => {
    function Reader({
      stub,
    }: {
      stub: { __module: string; __action: string };
    }) {
      const status = useFormStatus(stub as never);
      return <span>{status.value.pending ? 'pending' : 'idle'}</span>;
    }

    const { container, rerender } = render(<Reader stub={createTodo} />);
    expect(container.textContent).toBe('idle');

    // A submit is in flight for `create` only.
    act(() => beginSubmit(createTodo.__module, createTodo.__action));
    expect(container.textContent).toBe('pending');

    // Swap the action (`mode === 'create' ? createTodo : updateTodo`).
    // `update` has NO in-flight submit, so this reader must read idle.
    rerender(<Reader stub={updateTodo} />);
    expect(container.textContent).toBe('idle');

    act(() => endSubmit(createTodo.__module, createTodo.__action));
  });
});

describe('P1-5 useActionResult stale stub', () => {
  it("renders the NEW action's result after the stub prop is swapped", () => {
    setLastActionResult(createTodo.__module, createTodo.__action, {
      kind: 'success',
      data: { from: 'create' },
      submittedPayload: null,
    });
    setLastActionResult(updateTodo.__module, updateTodo.__action, {
      kind: 'success',
      data: { from: 'update' },
      submittedPayload: null,
    });

    function Reader({
      stub,
    }: {
      stub: { __module: string; __action: string };
    }) {
      const r = useActionResult(stub as never);
      return <pre>{JSON.stringify(r.value)}</pre>;
    }

    const { container, rerender } = render(<Reader stub={createTodo} />);
    expect(JSON.parse(container.textContent!)).toMatchObject({
      data: { from: 'create' },
    });

    rerender(<Reader stub={updateTodo} />);
    expect(JSON.parse(container.textContent!)).toMatchObject({
      data: { from: 'update' },
    });
  });
});

describe('P1-5 useOptimistic stale reducer', () => {
  it('folds the queue with the CURRENT reducer after the reducer prop changes', () => {
    function Reader({ mult }: { mult: number }) {
      const [value, dispatch] = useOptimistic<number, number>(
        0,
        (acc, p) => acc + p * mult
      );
      (Reader as unknown as { dispatch?: unknown }).dispatch = dispatch;
      return <span>{String(value.value)}</span>;
    }

    const { container, rerender } = render(<Reader mult={1} />);
    expect(container.textContent).toBe('0');

    act(() => {
      (Reader as unknown as { dispatch: (p: number) => unknown }).dispatch(5);
    });
    expect(container.textContent).toBe('5');

    // Same base (0, a stable primitive), same queue -- only the reducer changed.
    rerender(<Reader mult={10} />);
    expect(container.textContent).toBe('50');
  });
});
