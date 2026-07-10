// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxClear,
  ComboboxEmpty,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
} from '../combobox/combobox.js';

afterEach(cleanup);

describe('Combobox Trigger/Clear/Empty', () => {
  it('Trigger toggles the popup and is not in the tab order', async () => {
    const { getByLabelText, getByRole, queryByRole } = render(
      <ComboboxRoot>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxTrigger aria-label="Open" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const trigger = getByLabelText('Open');
    expect(trigger.getAttribute('tabindex')).toBe('-1');
    fireEvent.click(trigger);
    await act(async () => {});
    expect(getByRole('listbox')).not.toBeNull();
    fireEvent.click(trigger);
    await act(async () => {});
    expect(queryByRole('listbox')).toBeNull();
  });

  it('Clear empties the value and input', async () => {
    const { getByLabelText, getByRole } = render(
      <ComboboxRoot defaultValue="apple" defaultInputValue="Apple">
        <ComboboxInput aria-label="Fruit" />
        <ComboboxClear aria-label="Clear" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    fireEvent.click(getByLabelText('Clear'));
    await act(async () => {});
    expect((getByRole('combobox') as HTMLInputElement).value).toBe('');
  });

  it('Empty renders only when there are no options and the popup is open', async () => {
    const { queryByText, rerender } = render(
      <ComboboxRoot defaultOpen>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxEmpty>Nothing found</ComboboxEmpty>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    await act(async () => {});
    expect(queryByText('Nothing found')).not.toBeNull();

    rerender(
      <ComboboxRoot defaultOpen>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxEmpty>Nothing found</ComboboxEmpty>
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    await act(async () => {});
    expect(queryByText('Nothing found')).toBeNull();
  });

  it('Clear in controlled single mode emits null through onValueChange', async () => {
    const onValueChange = vi.fn();
    const { getByLabelText } = render(
      <ComboboxRoot value="apple" onValueChange={onValueChange}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxClear aria-label="Clear" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    fireEvent.click(getByLabelText('Clear'));
    await act(async () => {});
    expect(onValueChange).toHaveBeenCalledWith(null);
  });

  it('Clear in multiple mode emits an empty array', async () => {
    const onValueChange = vi.fn();
    const { getByLabelText } = render(
      <ComboboxRoot multiple value={['apple']} onValueChange={onValueChange}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxClear aria-label="Clear" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    fireEvent.click(getByLabelText('Clear'));
    await act(async () => {});
    expect(onValueChange).toHaveBeenCalledWith([]);
  });
});
