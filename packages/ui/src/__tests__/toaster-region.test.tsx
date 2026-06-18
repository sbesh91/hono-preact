// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/preact';
import { Toaster } from '../toast/toaster.js';
import { toast } from '../toast/toast.js';
import { toastStore } from '../toast/toast-store.js';

afterEach(() => {
  for (const t of [...toastStore.toasts]) toastStore.remove(t.id);
  cleanup();
});

function Region() {
  return (
    <Toaster position="top-center" label="Alerts">
      {(t) => <div data-testid={`toast-${t.id}`}>{t.title}</div>}
    </Toaster>
  );
}

describe('<Toaster> region', () => {
  it('renders an empty labeled region with both live regions pre-mounted', () => {
    const { getByRole } = render(<Region />);
    const region = getByRole('region', { name: 'Alerts' });
    expect(region).not.toBeNull();
    expect(region.getAttribute('data-position')).toBe('top-center');
    expect(getByRole('status')).not.toBeNull();
    expect(getByRole('alert')).not.toBeNull();
  });

  it('renders a toast via the render prop and announces it politely', () => {
    const { getByTestId, getByRole } = render(<Region />);
    let id: string | number = '';
    act(() => {
      id = toast('Hello');
    });
    expect(getByTestId(`toast-${id}`).textContent).toBe('Hello');
    expect(getByRole('status').textContent).toBe('Hello');
  });

  it('announces an error toast assertively', () => {
    const { getByRole } = render(<Region />);
    act(() => {
      toast.error('Boom');
    });
    expect(getByRole('alert').textContent).toBe('Boom');
  });
});
