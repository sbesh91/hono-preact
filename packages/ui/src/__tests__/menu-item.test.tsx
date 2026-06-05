// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';

afterEach(cleanup);

function Harness({
  onSelect,
  onOpenChange,
  keepOpen,
}: {
  onSelect?: (e: Event) => void;
  onOpenChange?: (o: boolean) => void;
  keepOpen?: boolean;
}) {
  return (
    <MenuRoot defaultOpen onOpenChange={onOpenChange}>
      <MenuTrigger>Open</MenuTrigger>
      <MenuPositioner>
        <MenuPopup>
          <MenuItem
            onSelect={(e) => {
              onSelect?.(e);
              if (keepOpen) e.preventDefault();
            }}
          >
            Cut
          </MenuItem>
          <MenuItem disabled>Disabled</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuRoot>
  );
}

describe('Menu Item', () => {
  it('fires onSelect and closes the menu on click', async () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const { getByText } = render(
      <Harness onSelect={onSelect} onOpenChange={onOpenChange} />
    );
    await act(async () => {});
    fireEvent.click(getByText('Cut'));
    expect(onSelect).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('preventDefault in onSelect keeps the menu open', async () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(<Harness keepOpen onOpenChange={onOpenChange} />);
    await act(async () => {});
    onOpenChange.mockClear();
    fireEvent.click(getByText('Cut'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('marks disabled items aria-disabled and skips them in navigation', async () => {
    const { getByText, getByRole } = render(<Harness />);
    await act(async () => {});
    const disabled = getByText('Disabled');
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByText('Cut'));
  });
});
