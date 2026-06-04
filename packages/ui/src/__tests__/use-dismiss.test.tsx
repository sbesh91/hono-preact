// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { useDismiss } from '../use-dismiss.js';

afterEach(cleanup);

function Harness({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: (r: 'escape' | 'outside-press') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss({ enabled: open, refs: [ref], onDismiss });
  return open ? <div ref={ref}>panel</div> : null;
}

describe('useDismiss', () => {
  it('calls onDismiss on Escape while open', () => {
    const onDismiss = vi.fn();
    render(<Harness open onDismiss={onDismiss} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).toHaveBeenCalledWith('escape');
  });

  it('unregisters when it closes', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Harness open onDismiss={onDismiss} />);
    rerender(<Harness open={false} onDismiss={onDismiss} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
