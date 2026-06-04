// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPositioner,
  PopoverPopup,
} from '../popover/popover.js';

afterEach(cleanup);

function Example() {
  return (
    <PopoverRoot>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverPositioner>
        <PopoverPopup aria-label="Menu">
          <button>Action</button>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverRoot>
  );
}

describe('Popover Positioner + Popup', () => {
  it('does not render the popup while closed', () => {
    const { queryByRole } = render(<Example />);
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders the popup with role=dialog and data-state=open when open', () => {
    const { getByText, getByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    const popup = getByRole('dialog');
    expect(popup.getAttribute('data-state')).toBe('open');
    expect(popup.getAttribute('aria-label')).toBe('Menu');
    expect(popup.getAttribute('id')).toBeTruthy();
  });

  it('moves focus into the popup on open', () => {
    const { getByText } = render(<Example />);
    fireEvent.click(getByText('Open'));
    expect(document.activeElement?.textContent).toBe('Action');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { getByText, queryByRole } = render(<Example />);
    const trigger = getByText('Open');
    trigger.focus(); // so useFocusReturn captures the trigger as the opener
    fireEvent.click(trigger);
    // Raw dispatch is not act-wrapped; flush the resulting setOpen re-render.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on an outside press', () => {
    const { getByText, queryByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true })
      );
    });
    expect(queryByRole('dialog')).toBeNull();
  });
});
