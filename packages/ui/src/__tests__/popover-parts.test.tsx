// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPositioner,
  PopoverPopup,
  PopoverArrow,
  PopoverTitle,
  PopoverDescription,
  PopoverClose,
} from '../popover/popover.js';

afterEach(cleanup);

function Example() {
  return (
    <PopoverRoot>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverPositioner>
        <PopoverPopup>
          <PopoverArrow data-testid="arrow" />
          <PopoverTitle>Settings</PopoverTitle>
          <PopoverDescription>Tune your preferences.</PopoverDescription>
          <PopoverClose>Done</PopoverClose>
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverRoot>
  );
}

describe('Popover parts', () => {
  it('wires aria-labelledby and aria-describedby to Title/Description', () => {
    const { getByText, getByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    const popup = getByRole('dialog');
    const labelledby = popup.getAttribute('aria-labelledby');
    const describedby = popup.getAttribute('aria-describedby');
    expect(getByText('Settings').getAttribute('id')).toBe(labelledby);
    expect(getByText('Tune your preferences.').getAttribute('id')).toBe(
      describedby
    );
  });

  it('Close dismisses the popover', () => {
    const { getByText, queryByRole } = render(<Example />);
    fireEvent.click(getByText('Open'));
    fireEvent.click(getByText('Done'));
    expect(queryByRole('dialog')).toBeNull();
  });

  it('renders an arrow element carrying data-side', () => {
    const { getByText, getByTestId } = render(<Example />);
    fireEvent.click(getByText('Open'));
    expect(getByTestId('arrow').getAttribute('data-side')).toBeTruthy();
  });
});
