// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import {
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from '../toast/toast-parts.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';
import { installReducedMotion } from './presence-helpers.js';

// Reduced motion makes usePresence finalize the exit synchronously, so removal
// is deterministic without faking animations.
let restore: (() => void) | undefined;
afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  restore?.();
  restore = undefined;
  cleanup();
});

function App() {
  return (
    <Toaster>
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
          <ToastDescription />
          <ToastAction />
          <ToastClose>x</ToastClose>
        </ToastRoot>
      )}
    </Toaster>
  );
}

describe('Toast parts', () => {
  it('renders title/description and reflects type via data-type', () => {
    const { getByTestId } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast.success('Saved', { description: 'All good' });
    });
    const root = getByTestId(`root-${id}`);
    expect(root.getAttribute('data-type')).toBe('success');
    expect(root.getAttribute('data-state')).toBe('open');
    expect(root.textContent).toContain('Saved');
    expect(root.textContent).toContain('All good');
  });

  it('Close dismisses; with reduced motion the toast is then removed', () => {
    restore = installReducedMotion(true);
    const { getByText } = render(<App />);
    act(() => {
      toast('Bye');
    });
    act(() => fireEvent.click(getByText('x')));
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('Action runs its onClick and dismisses', () => {
    restore = installReducedMotion(true);
    let clicked = 0;
    const { getByText } = render(<App />);
    act(() => {
      toast('With action', {
        action: { label: 'Undo', onClick: () => (clicked += 1) },
      });
    });
    act(() => fireEvent.click(getByText('Undo')));
    expect(clicked).toBe(1);
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('renders a custom toast body via record.jsx', () => {
    const { getByTestId } = render(<App />);
    act(() => {
      toast.custom((id) => <span data-testid="custom">custom {id}</span>);
    });
    expect(getByTestId('custom').textContent).toContain('custom');
  });
});
