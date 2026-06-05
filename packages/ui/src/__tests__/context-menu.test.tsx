// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
} from '../context-menu/context-menu.js';
import { MenuPositioner, MenuPopup, MenuItem } from '../menu/menu.js';

afterEach(cleanup);

describe('ContextMenu', () => {
  it('opens on contextmenu, suppresses the native menu, renders a menu', async () => {
    const { getByText, queryByRole } = render(
      <ContextMenuRoot>
        <ContextMenuTrigger>
          <div>Right-click here</div>
        </ContextMenuTrigger>
        <MenuPositioner>
          <MenuPopup aria-label="Context">
            <MenuItem>Cut</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </ContextMenuRoot>
    );
    expect(queryByRole('menu')).toBeNull();
    const area = getByText('Right-click here');
    const evt = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 30,
    });
    fireEvent(area, evt);
    expect(evt.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(queryByRole('menu')).toBeTruthy();
  });
});
