// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
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
  cleanup();
});

function App() {
  return (
    <Toaster position="bottom-right">
      {(t) => (
        <ToastRoot toast={t} data-testid={`root-${t.id}`}>
          <ToastTitle />
        </ToastRoot>
      )}
    </Toaster>
  );
}

// happy-dom does not implement setPointerCapture; stub it so the handlers run.
function stubCapture(el: Element) {
  // eslint-disable-next-line no-param-reassign
  (el as unknown as { setPointerCapture: () => void }).setPointerCapture = () =>
    undefined;
  (
    el as unknown as { releasePointerCapture: () => void }
  ).releasePointerCapture = () => undefined;
}

describe('toast swipe-to-dismiss', () => {
  it('dismisses when dragged past the threshold (right position -> swipe right)', () => {
    restore = installReducedMotion(true);
    const { getByTestId } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast('Swipe me');
    });
    const root = getByTestId(`root-${id}`);
    stubCapture(root);
    act(() =>
      fireEvent.pointerDown(root, { clientX: 0, clientY: 0, pointerId: 1 })
    );
    act(() =>
      fireEvent.pointerMove(root, { clientX: 120, clientY: 0, pointerId: 1 })
    );
    expect(root.getAttribute('data-swiping')).toBe('true');
    act(() =>
      fireEvent.pointerUp(root, { clientX: 120, clientY: 0, pointerId: 1 })
    );
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('snaps back when released below the threshold', () => {
    restore = installReducedMotion(true);
    const { getByTestId } = render(<App />);
    let id: string | number = '';
    act(() => {
      id = toast('Stay');
    });
    const root = getByTestId(`root-${id}`);
    stubCapture(root);
    act(() =>
      fireEvent.pointerDown(root, { clientX: 0, clientY: 0, pointerId: 1 })
    );
    act(() =>
      fireEvent.pointerMove(root, { clientX: 10, clientY: 0, pointerId: 1 })
    );
    act(() =>
      fireEvent.pointerUp(root, { clientX: 10, clientY: 0, pointerId: 1 })
    );
    expect(toastStore.toasts).toHaveLength(1);
    expect(root.getAttribute('data-swiping')).toBe('false');
    expect(root.style.getPropertyValue('--toast-swipe-amount')).toBe('0px');
  });
});
