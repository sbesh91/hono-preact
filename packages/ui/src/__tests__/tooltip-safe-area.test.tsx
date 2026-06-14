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

function rect(
  left: number,
  top: number,
  width: number,
  height: number
): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

function Example() {
  return (
    <TooltipRoot openDelay={100} closeDelay={300}>
      <TooltipTrigger>Help</TooltipTrigger>
      <TooltipPositioner>
        <TooltipPopup>More info</TooltipPopup>
      </TooltipPositioner>
    </TooltipRoot>
  );
}

// Open via hover, stub the trigger + positioner rects, and engage the session.
function openAndStub() {
  const utils = render(<Example />);
  fireEvent.pointerEnter(utils.getByText('Help'), { pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(100)); // open after delay
  const popup = utils.getByRole('tooltip');
  const positioner = popup.parentElement;
  if (!positioner) throw new Error('positioner not found');
  utils.getByText('Help').getBoundingClientRect = () => rect(0, 0, 100, 50);
  positioner.getBoundingClientRect = () => rect(200, 0, 100, 150);
  // Pointer seen over the trigger -> session engaged.
  fireEvent.pointerMove(document, {
    clientX: 50,
    clientY: 25,
    pointerType: 'mouse',
  });
  return utils;
}

const move = (clientX: number, clientY: number) =>
  fireEvent.pointerMove(document, { clientX, clientY, pointerType: 'mouse' });

describe('Tooltip safe area', () => {
  it('stays open while the pointer travels the corridor toward the popup', () => {
    const { queryByRole } = openAndStub();
    move(150, 25); // inside the corridor
    expect(queryByRole('tooltip')).not.toBeNull();
  });

  it('stays open while the pointer dwells inside the corridor', () => {
    const { queryByRole } = openAndStub();
    move(150, 25); // park inside the corridor
    act(() => vi.advanceTimersByTime(300));
    expect(queryByRole('tooltip')).not.toBeNull();
  });

  it('closes after the grace period once the pointer leaves the corridor', () => {
    const { queryByRole } = openAndStub();
    move(150, 130); // gap, below the corridor -> arms grace
    expect(queryByRole('tooltip')).not.toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('keeps it open after the pointer reaches the popup', () => {
    const { queryByRole } = openAndStub();
    move(150, 130); // leave the corridor -> arms grace
    move(250, 75); // reach the popup -> clears grace
    act(() => vi.advanceTimersByTime(300));
    expect(queryByRole('tooltip')).not.toBeNull();
  });
});
