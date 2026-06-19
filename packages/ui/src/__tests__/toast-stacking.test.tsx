// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/preact';
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
    <Toaster expand={false}>
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
        </ToastRoot>
      )}
    </Toaster>
  );
}

describe('toast stacking attributes', () => {
  it('marks the newest toast as front and sets index vars', () => {
    const { getByTestId } = render(<App />);
    let a: string | number = '';
    let b: string | number = '';
    act(() => {
      a = toast('first');
    });
    act(() => {
      b = toast('second');
    });
    const front = getByTestId(`root-${b}`); // newest
    const back = getByTestId(`root-${a}`);
    expect(front.getAttribute('data-front')).toBe('');
    expect(front.style.getPropertyValue('--toasts-before')).toBe('0');
    expect(back.getAttribute('data-front')).toBeNull();
    expect(back.style.getPropertyValue('--toasts-before')).toBe('1');
    expect(back.style.getPropertyValue('--toast-index')).toBe('1');
  });

  it('toggles data-expanded on the toasts when the region is hovered', () => {
    const { getByTestId, getByRole } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast('only');
    });
    const root = getByTestId(`root-${id}`);
    expect(root.getAttribute('data-expanded')).toBe('false');
    act(() => fireEvent.pointerEnter(getByRole('region')));
    expect(root.getAttribute('data-expanded')).toBe('true');
  });
});
