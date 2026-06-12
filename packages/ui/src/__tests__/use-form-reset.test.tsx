// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useFormReset } from '../use-form-reset.js';

afterEach(cleanup);

function Field({ onReset }: { onReset: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useFormReset(ref, onReset);
  return <input ref={ref} name="x" />;
}

describe('useFormReset', () => {
  it('calls onReset when the enclosing form is reset', () => {
    const onReset = vi.fn();
    const { container } = render(
      <form>
        <Field onReset={onReset} />
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('does not call onReset when the reset is defaultPrevented', () => {
    const onReset = vi.fn();
    const { container } = render(
      <form onReset={(e) => e.preventDefault()}>
        <Field onReset={onReset} />
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onReset).not.toHaveBeenCalled();
  });

  it('does nothing when there is no enclosing form', () => {
    const onReset = vi.fn();
    expect(() => render(<Field onReset={onReset} />)).not.toThrow();
    expect(onReset).not.toHaveBeenCalled();
  });
});
