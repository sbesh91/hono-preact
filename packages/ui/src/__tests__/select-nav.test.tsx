// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPositioner,
  SelectPopup,
  SelectOption,
} from '../select/select.js';

afterEach(cleanup);

function Harness(props: { multiple?: boolean }) {
  return (
    <SelectRoot multiple={props.multiple}>
      <SelectTrigger>
        <SelectValue placeholder="Pick" />
      </SelectTrigger>
      <SelectPositioner>
        <SelectPopup aria-label="Fruits">
          <SelectOption value="apple">Apple</SelectOption>
          <SelectOption value="banana">Banana</SelectOption>
          <SelectOption value="cherry">Cherry</SelectOption>
        </SelectPopup>
      </SelectPositioner>
    </SelectRoot>
  );
}

describe('Select navigation', () => {
  it('listbox is present in the DOM but not accessible until open', () => {
    const { queryByRole } = render(<Harness />);
    // Closed: rendered inside a hidden Positioner, so not in the a11y tree.
    expect(queryByRole('listbox')).toBeNull();
    // But present in the DOM (so options can register their labels).
    const listbox = queryByRole('listbox', { hidden: true });
    expect(listbox).not.toBeNull();
    expect(listbox!.closest('[hidden]')).not.toBeNull();
  });

  it('ArrowDown opens and moves the active descendant on the trigger', async () => {
    const { getByRole } = render(<Harness />);
    const trigger = getByRole('combobox');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await act(async () => {});
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(trigger);
    const active = trigger.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
  });
});
