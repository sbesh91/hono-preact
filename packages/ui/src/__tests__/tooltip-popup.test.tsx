// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPositioner,
  TooltipPopup,
} from '../tooltip/tooltip.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function Example() {
  return (
    <TooltipRoot delay={100} closeDelay={100}>
      <TooltipTrigger>Help</TooltipTrigger>
      <TooltipPositioner>
        <TooltipPopup>More info</TooltipPopup>
      </TooltipPositioner>
    </TooltipRoot>
  );
}

describe('Tooltip Positioner + Popup', () => {
  it('renders role=tooltip with the id the trigger describes', () => {
    const { getByText, getByRole } = render(<Example />);
    fireEvent.focus(getByText('Help'));
    const tip = getByRole('tooltip');
    expect(tip.getAttribute('id')).toBe(
      getByText('Help').getAttribute('aria-describedby')
    );
  });

  it('stays open when the pointer moves onto the popup (hoverable)', () => {
    const { getByText, getByRole, queryByRole } = render(<Example />);
    fireEvent.focus(getByText('Help')); // open
    fireEvent.pointerLeave(getByText('Help'), { pointerType: 'mouse' });
    // Moving onto the popup keeps it open (hoverable); no leave-close timer runs.
    fireEvent.pointerEnter(getByRole('tooltip'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(100);
    expect(queryByRole('tooltip')).not.toBeNull();
  });

  it('closes on Escape', () => {
    const { getByText, queryByRole } = render(<Example />);
    fireEvent.focus(getByText('Help'));
    // Raw dispatch is not act-wrapped; flush the resulting setOpen re-render.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(queryByRole('tooltip')).toBeNull();
  });
});
