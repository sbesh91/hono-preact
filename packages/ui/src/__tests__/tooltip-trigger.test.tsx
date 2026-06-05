// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { TooltipRoot, TooltipTrigger } from '../tooltip/tooltip.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Harness({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  return (
    <TooltipRoot delay={100} closeDelay={100} onOpenChange={onOpenChange}>
      <TooltipTrigger>Hover me</TooltipTrigger>
    </TooltipRoot>
  );
}

describe('Tooltip Trigger', () => {
  it('opens after the delay on pointer enter (mouse)', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.pointerEnter(getByText('Hover me'), { pointerType: 'mouse' });
    expect(onOpenChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('opens immediately on focus', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.focus(getByText('Hover me'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('does not open on a touch pointer', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.pointerEnter(getByText('Hover me'), { pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('cancels a pending open when the pointer leaves before the delay', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.pointerEnter(getByText('Hover me'), { pointerType: 'mouse' });
    fireEvent.pointerLeave(getByText('Hover me'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(1000);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes on blur', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness onOpenChange={onOpenChange} />);
    fireEvent.focus(getByText('Hover me'));
    onOpenChange.mockClear();
    fireEvent.blur(getByText('Hover me'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
