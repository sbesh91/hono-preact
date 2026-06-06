// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';
import {
  SubmenuRoot,
  SubmenuTrigger,
  SubmenuPositioner,
  SubmenuPopup,
} from '../menu/submenu.js';

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
    <MenuRoot defaultOpen>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPositioner>
        <MenuPopup>
          <MenuItem>Top</MenuItem>
          <SubmenuRoot openDelay={100} closeDelay={300}>
            <SubmenuTrigger>Share</SubmenuTrigger>
            <SubmenuPositioner>
              <SubmenuPopup>
                <MenuItem>Copy link</MenuItem>
              </SubmenuPopup>
            </SubmenuPositioner>
          </SubmenuRoot>
        </MenuPopup>
      </MenuPositioner>
    </MenuRoot>
  );
}

// Open the submenu via hover, stub the trigger + submenu positioner rects, and
// engage the safe-area session by moving the pointer over the trigger.
function openSubmenuAndStub() {
  const utils = render(<Example />);
  fireEvent.pointerEnter(utils.getByText('Share'), { pointerType: 'mouse' });
  act(() => vi.advanceTimersByTime(100)); // submenu opens after openDelay
  // The submenu popup is the one labelled "Share"; its parent is the positioner.
  const submenuPopup = utils.getByText('Copy link').closest('[role="menu"]');
  if (!submenuPopup) throw new Error('submenu popup not found');
  const positioner = submenuPopup.parentElement;
  if (!positioner) throw new Error('submenu positioner not found');
  // Trigger on the left, submenu to its right.
  utils.getByText('Share').getBoundingClientRect = () => rect(0, 100, 100, 30);
  positioner.getBoundingClientRect = () => rect(200, 100, 120, 90);
  // Pointer seen over the trigger -> session engaged.
  fireEvent.pointerMove(document, {
    clientX: 50,
    clientY: 115,
    pointerType: 'mouse',
  });
  return utils;
}

const move = (clientX: number, clientY: number) =>
  fireEvent.pointerMove(document, { clientX, clientY, pointerType: 'mouse' });

describe('Submenu safe area', () => {
  it('stays open while the pointer is over the submenu', () => {
    const { queryByText } = openSubmenuAndStub();
    move(250, 140); // over the submenu popup
    act(() => vi.advanceTimersByTime(300));
    expect(queryByText('Copy link')).not.toBeNull();
  });

  it('closes after the grace period once the pointer leaves the submenu region', () => {
    const { queryByText } = openSubmenuAndStub();
    move(250, 140); // reach the submenu
    move(500, 400); // move far away, outside trigger + submenu + corridor
    expect(queryByText('Copy link')).not.toBeNull(); // grace not yet elapsed
    act(() => vi.advanceTimersByTime(300));
    expect(queryByText('Copy link')).toBeNull();
  });
});
