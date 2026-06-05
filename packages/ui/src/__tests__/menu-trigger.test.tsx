// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { MenuRoot, MenuTrigger } from '../menu/menu.js';

afterEach(cleanup);

describe('Menu Trigger', () => {
  it('wires aria-haspopup=menu and toggles open on click', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(
      <MenuRoot onOpenChange={onOpenChange}>
        <MenuTrigger>Open</MenuTrigger>
      </MenuRoot>
    );
    const trigger = getByText('Open');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('opens on ArrowDown', () => {
    const onOpenChange = vi.fn();
    const { getByText } = render(
      <MenuRoot onOpenChange={onOpenChange}>
        <MenuTrigger>Open</MenuTrigger>
      </MenuRoot>
    );
    fireEvent.keyDown(getByText('Open'), { key: 'ArrowDown' });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
