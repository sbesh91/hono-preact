// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import {
  MenuRoot, MenuTrigger, MenuPositioner, MenuPopup, MenuItem,
  MenuSeparator, MenuGroup, MenuGroupLabel,
} from '../menu/menu.js';

afterEach(cleanup);

describe('Menu structure parts', () => {
  it('renders a separator and a labelled group', async () => {
    const { getByRole, getByText } = render(
      <MenuRoot defaultOpen>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>Section</MenuGroupLabel>
              <MenuItem>A</MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem>B</MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    await act(async () => {});
    expect(getByRole('separator')).toBeTruthy();
    const group = getByText('Section').closest('[role="group"]')!;
    const labelId = getByText('Section').id;
    expect(group.getAttribute('aria-labelledby')).toBe(labelId);
  });
});
