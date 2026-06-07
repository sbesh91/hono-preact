// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { SelectRoot, SelectTrigger, SelectValue } from '../select/select.js';

afterEach(cleanup);

describe('Select Trigger + Value', () => {
  it('is a combobox button that toggles open and wires aria', () => {
    const onOpenChange = vi.fn();
    const { getByRole } = render(
      <SelectRoot onOpenChange={onOpenChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick one" />
        </SelectTrigger>
      </SelectRoot>
    );
    const trigger = getByRole('combobox');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('Pick one');
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('opens on ArrowDown', () => {
    const onOpenChange = vi.fn();
    const { getByRole } = render(
      <SelectRoot onOpenChange={onOpenChange}>
        <SelectTrigger>
          <SelectValue placeholder="x" />
        </SelectTrigger>
      </SelectRoot>
    );
    fireEvent.keyDown(getByRole('combobox'), { key: 'ArrowDown' });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
