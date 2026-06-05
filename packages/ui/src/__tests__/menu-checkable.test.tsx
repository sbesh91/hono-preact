// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  MenuRoot,
  MenuTrigger,
  MenuPositioner,
  MenuPopup,
  MenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioItem,
} from '../menu/menu.js';

afterEach(cleanup);

describe('Menu checkable items', () => {
  it('CheckboxItem exposes aria-checked and fires onCheckedChange', async () => {
    const onCheckedChange = vi.fn();
    const { getByText } = render(
      <MenuRoot defaultOpen>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
              Bold
            </MenuCheckboxItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    await act(async () => {});
    const item = getByText('Bold');
    expect(item.getAttribute('role')).toBe('menuitemcheckbox');
    expect(item.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(item);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('RadioGroup tracks the selected value via RadioItem', async () => {
    const onValueChange = vi.fn();
    const { getByText } = render(
      <MenuRoot defaultOpen>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPositioner>
          <MenuPopup>
            <MenuRadioGroup value="sm" onValueChange={onValueChange}>
              <MenuRadioItem value="sm">Small</MenuRadioItem>
              <MenuRadioItem value="lg">Large</MenuRadioItem>
            </MenuRadioGroup>
          </MenuPopup>
        </MenuPositioner>
      </MenuRoot>
    );
    await act(async () => {});
    expect(getByText('Small').getAttribute('aria-checked')).toBe('true');
    expect(getByText('Large').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(getByText('Large'));
    expect(onValueChange).toHaveBeenCalledWith('lg');
  });
});
