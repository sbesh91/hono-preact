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

function Harness() {
  return (
    <MenuRoot defaultOpen>
      <MenuTrigger>Open</MenuTrigger>
      <MenuPositioner>
        <MenuPopup>
          <MenuItem>Top</MenuItem>
          <SubmenuRoot>
            <SubmenuTrigger>More</SubmenuTrigger>
            <SubmenuPositioner>
              <SubmenuPopup>
                <MenuItem>Nested</MenuItem>
              </SubmenuPopup>
            </SubmenuPositioner>
          </SubmenuRoot>
        </MenuPopup>
      </MenuPositioner>
    </MenuRoot>
  );
}

describe('Submenu', () => {
  it('SubmenuTrigger is a menuitem with aria-haspopup=menu', async () => {
    const { getByText } = render(<Harness />);
    await act(async () => {});
    const trigger = getByText('More');
    expect(trigger.getAttribute('role')).toBe('menuitem');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowRight opens the submenu and focuses its first item', async () => {
    const { getByText, queryByText } = render(<Harness />);
    await act(async () => {});
    const trigger = getByText('More');
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    await act(async () => {});
    expect(queryByText('Nested')).toBeTruthy();
    expect(document.activeElement).toBe(getByText('Nested'));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('ArrowLeft closes the submenu and returns focus to the trigger', async () => {
    const { getByText, queryByText } = render(<Harness />);
    await act(async () => {});
    fireEvent.keyDown(getByText('More'), { key: 'ArrowRight' });
    await act(async () => {});
    fireEvent.keyDown(getByText('Nested'), { key: 'ArrowLeft' });
    await act(async () => {});
    expect(queryByText('Nested')).toBeNull();
    expect(document.activeElement).toBe(getByText('More'));
  });
});
