// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from '../menu/menu.js';

afterEach(cleanup);

function Harness() {
  return (
    <MenuRoot defaultOpen>
      <MenuTrigger>Open</MenuTrigger>
      <MenuPositioner>
        <MenuPopup>
          <MenuItem>Cut</MenuItem>
          <MenuItem>Copy</MenuItem>
          <MenuItem>Paste</MenuItem>
        </MenuPopup>
      </MenuPositioner>
    </MenuRoot>
  );
}

describe('Menu navigation', () => {
  it('renders role=menu with menuitems and focuses the first on open', async () => {
    const { getByRole, getByText } = render(<Harness />);
    const menu = getByRole('menu');
    expect(menu.getAttribute('aria-labelledby')).toBeTruthy();
    await act(async () => {});
    const cut = getByText('Cut');
    expect(document.activeElement).toBe(cut);
    expect(cut.getAttribute('tabindex')).toBe('0');
  });

  it('ArrowDown moves focus to the next item and wraps', async () => {
    const { getByRole, getByText } = render(<Harness />);
    await act(async () => {});
    const menu = getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByText('Copy'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByText('Cut'));
  });

  it('typeahead focuses the matching item', async () => {
    const { getByRole, getByText } = render(<Harness />);
    await act(async () => {});
    const menu = getByRole('menu');
    fireEvent.keyDown(menu, { key: 'p' });
    expect(document.activeElement).toBe(getByText('Paste'));
  });

  it('ArrowUp on a closed trigger opens the menu focused on the last item', async () => {
    const { getByText } = render(
      <MenuRoot>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuItem>Cut</MenuItem>
            <MenuItem>Copy</MenuItem>
            <MenuItem>Paste</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    fireEvent.keyDown(getByText('Open'), { key: 'ArrowUp' });
    await act(async () => {});
    expect(document.activeElement).toBe(getByText('Paste'));
  });
});
