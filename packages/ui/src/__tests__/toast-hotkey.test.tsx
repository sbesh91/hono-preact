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

describe('toast region hotkey', () => {
  it('focuses the region on Alt+T', () => {
    const { getByRole } = render(
      <Toaster>
        {(t) => (
          <ToastRoot toast={t}>
            <ToastTitle />
          </ToastRoot>
        )}
      </Toaster>
    );
    act(() => {
      toast('Hi');
    });
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyT', altKey: true })
      );
    });
    expect(document.activeElement).toBe(getByRole('region'));
  });
});
