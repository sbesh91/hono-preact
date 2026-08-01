// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/preact';
import { useFormStatus } from '../use-form-status.js';
import { beginSubmit, endSubmit } from '../internal/form-submit-store.js';

function Reader({ stub }: { stub?: { __module: string; __action: string } }) {
  const status = useFormStatus(stub as never);
  return <span>{status.value.pending ? 'pending' : 'idle'}</span>;
}

describe('useFormStatus', () => {
  it('returns a ReadonlySignal that is idle when no submits in flight', () => {
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

  it('granularity: a binding that reads `.value.pending` updates without the host re-rendering', () => {
    const stub = { __module: 'pages/foo.server', __action: 'submit' };
    const renders = { host: 0, binding: 0 };

    function Binding() {
      renders.binding++;
      const status = useFormStatus(stub as never);
      return (
        <span data-testid="binding">
          {status.value.pending ? 'pending' : 'idle'}
        </span>
      );
    }
    function Host() {
      renders.host++;
      return <Binding />;
    }

    render(<Host />);
    expect(screen.getByTestId('binding').textContent).toBe('idle');
    const hostBefore = renders.host;

    act(() => beginSubmit(stub.__module, stub.__action));

    expect(screen.getByTestId('binding').textContent).toBe('pending');
    expect(renders.host).toBe(hostBefore);

    act(() => endSubmit(stub.__module, stub.__action));
  });
});

// T1, the pending half. Same root cause as the `useActionResult` leak: a stub
// whose module the Vite plugin never processed carries no `__module`/`__action`,
// and keying off the derived ref alone made it indistinguishable from "no stub",
// whose branch is `counts.size > 0` -- is ANY form submitting.
describe('T1: a stub with no injected identity is never pending', () => {
  it('stays idle while a DIFFERENT action is in flight', () => {
    const unrewritten = {} as { __module: string; __action: string };
    const { container } = render(<Reader stub={unrewritten} />);
    act(() => beginSubmit('pages/other.server', 'submit'));
    // Under the defect this read 'pending': an unrelated form's submission
    // disabled this one's button and showed its spinner.
    expect(container.textContent).toBe('idle');
    act(() => endSubmit('pages/other.server', 'submit'));
  });

  it('CONTROL: no stub at all still reports any in-flight submit', () => {
    // The global branch is a designed feature, so the fix must not remove it.
    const { container } = render(<Reader />);
    act(() => beginSubmit('pages/other.server', 'submit'));
    expect(container.textContent).toBe('pending');
    act(() => endSubmit('pages/other.server', 'submit'));
  });

  it('CONTROL: a keyed stub still reports its OWN submit', () => {
    const { container } = render(
      <Reader stub={{ __module: 'pages/foo.server', __action: 'submit' }} />
    );
    act(() => beginSubmit('pages/foo.server', 'submit'));
    expect(container.textContent).toBe('pending');
    act(() => endSubmit('pages/foo.server', 'submit'));
    expect(container.textContent).toBe('idle');
  });
});
