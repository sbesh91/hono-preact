// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { ToastRoot, ToastTitle } from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';
import { installReducedMotion } from './presence-helpers.js';

let restore: (() => void) | undefined;
afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  restore?.();
  restore = undefined;
  vi.useRealTimers();
  cleanup();
});

function App() {
  return (
    <Toaster>
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
        </ToastRoot>
      )}
    </Toaster>
  );
}

describe('toast auto-dismiss timer', () => {
  it('dismisses then removes after the duration elapses', () => {
    vi.useFakeTimers();
    restore = installReducedMotion(true);
    render(<App />);
    act(() => {
      toast('Auto', { duration: 1000 });
    });
    expect(toastStore.toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('pauses while the region is hovered and resumes with remaining time', () => {
    vi.useFakeTimers();
    restore = installReducedMotion(true);
    const { getByRole } = render(<App />);
    act(() => {
      toast('Auto', { duration: 1000 });
    });
    const region = getByRole('region');
    act(() => vi.advanceTimersByTime(600));
    act(() => fireEvent.pointerEnter(region));
    act(() => vi.advanceTimersByTime(5000)); // paused: no expiry
    expect(toastStore.toasts).toHaveLength(1);
    act(() => fireEvent.pointerLeave(region));
    act(() => vi.advanceTimersByTime(400)); // 1000 - 600 remaining
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('never expires when duration is Infinity', () => {
    vi.useFakeTimers();
    restore = installReducedMotion(true);
    render(<App />);
    act(() => {
      toast.loading('Working', { duration: Infinity });
    });
    act(() => vi.advanceTimersByTime(100000));
    expect(toastStore.toasts).toHaveLength(1);
  });
});
