// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { useAction, type ActionRef } from '../action.js';
import { Form } from '../form.js';

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
  return { __module: 'm', __action: 'a' } as unknown as ActionRef<unknown, unknown, never>;
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

  it('clears pending when caller signal aborts while component stays mounted', async () => {
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
    const callerCtrl = new AbortController();
    let mutateFn:
      | ((
          p: { x: number },
          opts?: { signal?: AbortSignal }
        ) => Promise<unknown>)
      | undefined;

    function Comp() {
      const { mutate, pending } = useAction(makeActionStub(), { onError });
      pendingRef.current = pending;
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
    await act(async () => {
      await mutatePromise;
    });

    // Quiet-cancel must clear pending and must not invoke onError.
    expect(pendingRef.current).toBe(false);
    expect(onError).not.toHaveBeenCalled();
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
