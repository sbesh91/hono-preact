// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useFocusReturn } from '../use-focus-return.js';

afterEach(cleanup);

function Harness({ open }: { open: boolean }) {
  const popupRef = useRef<HTMLDivElement>(null);
  useFocusReturn({ open, popupRef });
  return (
    <div>
      <button data-testid="trigger">trigger</button>
      {open ? (
        <div ref={popupRef}>
          <button data-testid="inside">inside</button>
        </div>
      ) : null}
    </div>
  );
}

describe('useFocusReturn', () => {
  it('moves focus to the first focusable in the popup on open', () => {
    const { getByTestId, rerender } = render(<Harness open={false} />);
    getByTestId('trigger').focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(getByTestId('inside'));
  });

  it('returns focus to the previously focused element on close', () => {
    const { getByTestId, rerender } = render(<Harness open={false} />);
    const trigger = getByTestId('trigger');
    trigger.focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(getByTestId('inside'));
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });
});
