// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { ToastRoot, ToastTitle } from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';

afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  cleanup();
});

function App() {
  return (
    <Toaster>
      {(t) => (
        <ToastRoot toast={t}>
          <ToastTitle />
        </ToastRoot>
      )}
    </Toaster>
  );
}

describe('Toaster promise re-announcement', () => {
  it('re-announces politely when a promise resolves to a success message', async () => {
    const { getByRole } = render(<App />);

    let resolve!: (v: string) => void;
    const p = new Promise<string>((r) => (resolve = r));

    act(() => {
      toast.promise(p, {
        loading: 'Saving',
        success: 'Saved',
        error: 'Failed',
      });
    });

    // The loading message should be announced politely.
    expect(getByRole('status').textContent).toBe('Saving');

    // Resolve the promise and flush microtasks so the store update propagates.
    await act(async () => {
      resolve('done');
      await p;
      // One extra microtask tick for the .then() in toast.promise to run.
      await Promise.resolve();
    });

    // The success message must re-announce in the polite region (same id, new text).
    expect(getByRole('status').textContent).toBe('Saved');
  });

  it('re-announces assertively when a promise rejects to an error message', async () => {
    const { getByRole } = render(<App />);

    const p = Promise.reject(new Error('network'));

    act(() => {
      toast.promise(p, {
        loading: 'Loading',
        success: 'Done',
        error: 'Failed',
      });
    });

    // Flush the rejection and its .then() handler.
    await act(async () => {
      await p.catch(() => undefined);
      await Promise.resolve();
    });

    // Error toasts set important:true, so they announce assertively.
    expect(getByRole('alert').textContent).toBe('Failed');
  });
});
