// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
} from '../combobox/combobox.js';

afterEach(cleanup);

describe('Combobox Option', () => {
  it('renders role=option with aria-selected reflecting selection', async () => {
    const { getByText } = render(
      <ComboboxRoot defaultOpen defaultValue="apple">
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
            <ComboboxOption value="banana">Banana</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    await act(async () => {});
    expect(getByText('Apple').getAttribute('aria-selected')).toBe('true');
    expect(getByText('Banana').getAttribute('aria-selected')).toBe('false');
  });

  it('clicking a normal option commits it (single closes)', async () => {
    const onValueChange = vi.fn();
    const { getByText, queryByRole } = render(
      <ComboboxRoot defaultOpen onValueChange={onValueChange}>
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="banana">Banana</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    fireEvent.click(getByText('Banana'));
    await act(async () => {});
    expect(onValueChange).toHaveBeenCalledWith('banana');
    expect(queryByRole('listbox')).toBeNull(); // closed
  });

  it('clicking a create option routes to onCreate, not onValueChange', async () => {
    const onValueChange = vi.fn();
    const onCreate = vi.fn();
    const { getByText } = render(
      <ComboboxRoot
        defaultOpen
        defaultInputValue="kiwi"
        onValueChange={onValueChange}
        onCreate={onCreate}
      >
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="kiwi" create>
              Create "kiwi"
            </ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    fireEvent.click(getByText('Create "kiwi"'));
    await act(async () => {});
    expect(onCreate).toHaveBeenCalledWith('kiwi');
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
