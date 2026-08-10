// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useAction, type ActionRef, type MutateResult } from '../action.js';
import { Form } from '../form.js';
import { isAbortedArm, denyArm } from './mutate-arm-helpers.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeActionStub(): ActionRef<{ x: number }, { ok: boolean }, never> {
  return { __module: 'm', __action: 'a' } as unknown as ActionRef<
    { x: number },
    { ok: boolean },
    never
  >;
}

/**
 * Minimal ActionRef stub for <Form>. The Form component reads __module and
 * __action from the action prop; it does not call useAction internally.
 * TPayload is widened to unknown to satisfy FormActionInput's contravariant
 * payload constraint.
 */
function makeFormStub(): ActionRef<unknown, unknown, never> {
  return { __module: 'm', __action: 'a' } as unknown as ActionRef<
    unknown,
    unknown,
    never
  >;
}

describe('action cancellation', () => {
  it('aborts the in-flight fetch on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

    function Comp() {
      const { mutate } = useAction(makeActionStub());
      useEffect(() => {
        void mutate({ x: 1 });
      }, []);
      return null;
    }

    render(h(Comp, {}));
    await Promise.resolve();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
    cleanup();
    expect(capturedSignal?.aborted).toBe(true);
    fetchSpy.mockRestore();
  });

  it('does not auto-abort a prior in-flight mutation on a new mutate', async () => {
    const signals: AbortSignal[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise(() => {
          if (init?.signal) signals.push(init.signal);
        })
    );
    let mutateFn: ((p: { x: number }) => unknown) | undefined;
    function Comp() {
      const { mutate } = useAction(makeActionStub());
      mutateFn = mutate;
      return null;
    }
    render(h(Comp, {}));
    void mutateFn!({ x: 1 });
    void mutateFn!({ x: 2 });
    await Promise.resolve();
    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(false);
    cleanup();
    fetchSpy.mockRestore();
  });

  it('clears pending when caller signal aborts while component stays mounted, and resolves the aborted arm without setting error state', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

    const onError = vi.fn();
    const pendingRef = { current: false };
    const errorRef: { current: Error | null } = { current: null };
    const callerCtrl = new AbortController();
    let mutateFn:
      | ((
          p: { x: number },
          opts?: { signal?: AbortSignal }
        ) => Promise<MutateResult<{ ok: boolean }>>)
      | undefined;

    function Comp() {
      const { mutate, pending, error } = useAction(makeActionStub(), {
        onError,
      });
      pendingRef.current = pending;
      errorRef.current = error;
      mutateFn = mutate;
      return null;
    }

    render(h(Comp, {}));
    await Promise.resolve();

    // Start mutate with caller's signal; component stays mounted.
    const mutatePromise = mutateFn!({ x: 1 }, { signal: callerCtrl.signal });
    await Promise.resolve();
    expect(pendingRef.current).toBe(true);

    // Abort while still mounted.
    callerCtrl.abort();
    let outcome!: MutateResult<{ ok: boolean }>;
    await act(async () => {
      outcome = await mutatePromise;
    });

    // Caller-signal abort while mounted: pending must be cleared, onError
    // must be called so that optimistic wrappers can revert their state, the
    // returned arm must be `aborted` (not `error`), and the hook's `error`
    // state must stay unset since a cancellation is not a rendered failure.
    expect(pendingRef.current).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(isAbortedArm(outcome)).toBe(true);
    expect(errorRef.current).toBeNull();
    fetchSpy.mockRestore();
  });

  it('reports a deny that already landed as `deny`, not `aborted`, when the caller then aborts', async () => {
    // The mock fetch ignores the abort signal (a real fetch given to an
    // already-committed server response behaves the same way: the response
    // is already on the wire) and resolves with a deny envelope. The deny
    // sink sets the mutate's local `denied` and throws; by the time the
    // outer catch runs, the caller has also aborted, so this exercises the
    // precedence: a deny that was already decided must win over the abort.
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const callerCtrl = new AbortController();
    let mutateFn:
      | ((
          p: { x: number },
          opts?: { signal?: AbortSignal }
        ) => Promise<MutateResult<{ ok: boolean }>>)
      | undefined;

    function Comp() {
      const { mutate } = useAction(makeActionStub());
      mutateFn = mutate;
      return null;
    }

    render(h(Comp, {}));
    await Promise.resolve();

    const mutatePromise = mutateFn!({ x: 1 }, { signal: callerCtrl.signal });
    await Promise.resolve();

    // Abort the caller signal, then let the already-in-flight response
    // resolve to a deny. The deny sink runs after the abort, mirroring a
    // deny that was decided server-side before the client gave up waiting.
    callerCtrl.abort();
    resolveFetch(
      new Response(
        JSON.stringify({ __outcome: 'deny', message: 'Forbidden' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    );

    let outcome!: MutateResult<{ ok: boolean }>;
    await act(async () => {
      outcome = await mutatePromise;
    });

    expect(denyArm(outcome).message).toBe('Forbidden');
    fetchSpy.mockRestore();
  });

  it('reverts an optimistic entry when a caller signal aborts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );

    // Simulate a useOptimisticAction-style onMutate + onError pair that
    // takes a snapshot and reverts it on error.
    let snapshotValue = 'original';
    const onMutate = vi.fn(() => {
      const snap = snapshotValue;
      snapshotValue = 'optimistic';
      return snap;
    });
    const onError = vi.fn((_err: Error, snap: string) => {
      snapshotValue = snap;
    });

    const callerCtrl = new AbortController();
    let mutateFn:
      | ((
          p: { x: number },
          opts?: { signal?: AbortSignal }
        ) => Promise<unknown>)
      | undefined;

    function Comp() {
      const { mutate } = useAction(makeActionStub(), { onMutate, onError });
      mutateFn = mutate;
      return null;
    }

    render(h(Comp, {}));
    await Promise.resolve();

    const mutatePromise = mutateFn!({ x: 1 }, { signal: callerCtrl.signal });
    await Promise.resolve();

    // onMutate fires immediately; the value has been optimistically updated.
    expect(snapshotValue).toBe('optimistic');

    callerCtrl.abort();
    await act(async () => {
      await mutatePromise;
    });

    // onError must have been called with the snapshot so the caller reverted.
    expect(onError).toHaveBeenCalled();
    expect(snapshotValue).toBe('original');

    fetchSpy.mockRestore();
  });

  it('removes the caller-signal abort listener after the mutation resolves', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ __outcome: 'success', data: { ok: true } }),
          { status: 200 }
        )
      );

    const addSpy = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    const removeSpy = vi.spyOn(AbortSignal.prototype, 'removeEventListener');

    const callerCtrl = new AbortController();
    let mutateFn:
      | ((
          p: { x: number },
          opts?: { signal?: AbortSignal }
        ) => Promise<unknown>)
      | undefined;

    function Comp() {
      const { mutate } = useAction(makeActionStub());
      mutateFn = mutate;
      return null;
    }

    render(h(Comp, {}));
    await Promise.resolve();

    // Call mutate 3 times on the SAME reused signal, letting each resolve.
    await act(async () => {
      await mutateFn!({ x: 1 }, { signal: callerCtrl.signal });
    });
    await act(async () => {
      await mutateFn!({ x: 2 }, { signal: callerCtrl.signal });
    });
    await act(async () => {
      await mutateFn!({ x: 3 }, { signal: callerCtrl.signal });
    });

    // Each resolved mutation must have added and then removed its listener.
    const abortListenerAdds = addSpy.mock.calls.filter(
      ([event]) => event === 'abort'
    );
    const abortListenerRemoves = removeSpy.mock.calls.filter(
      ([event]) => event === 'abort'
    );
    expect(abortListenerAdds.length).toBe(3);
    expect(abortListenerRemoves.length).toBe(3);

    fetchSpy.mockRestore();
  });
});

describe('Form cancellation', () => {
  it('aborts the in-flight submit on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init?.signal ?? undefined;
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const { container } = render(
      h(Form, {
        action: makeFormStub(),
        children: h('button', { type: 'submit' }, 'Go'),
      })
    );
    // fireEvent.submit fires the submit event so handleSubmit runs in the
    // test environment (consistent with the existing form.test.tsx pattern).
    fireEvent.submit(container.querySelector('form')!);
    await Promise.resolve();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    cleanup();
    expect(capturedSignal?.aborted).toBe(true);
    fetchSpy.mockRestore();
  });
});
