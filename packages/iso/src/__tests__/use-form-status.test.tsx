// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/preact';
import { useFormStatus } from '../use-form-status.js';
import { beginSubmit, endSubmit } from '../internal/form-submit-store.js';

function Reader({ stub }: { stub?: { __module: string; __action: string } }) {
  const { pending } = useFormStatus(stub as never);
  return <span>{pending ? 'pending' : 'idle'}</span>;
}

describe('useFormStatus', () => {
  it('returns idle when no submits in flight', () => {
    const { container } = render(<Reader />);
    expect(container.textContent).toBe('idle');
  });

  it('reflects an in-flight submit globally (no stub)', () => {
    const { container } = render(<Reader />);
    act(() => beginSubmit('pages/foo.server', 'submit'));
    expect(container.textContent).toBe('pending');
    act(() => endSubmit('pages/foo.server', 'submit'));
    expect(container.textContent).toBe('idle');
  });

  it('filters by stub identity when stub passed', () => {
    const stub = { __module: 'pages/foo.server', __action: 'submit' };
    const { container } = render(<Reader stub={stub} />);
    act(() => beginSubmit('pages/other.server', 'submit'));
    expect(container.textContent).toBe('idle');
    act(() => beginSubmit(stub.__module, stub.__action));
    expect(container.textContent).toBe('pending');
    act(() => endSubmit(stub.__module, stub.__action));
  });
});
