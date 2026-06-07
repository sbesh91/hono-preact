// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxInput,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
} from '../combobox/combobox.js';

afterEach(cleanup);

function Single({ onInputChange }: { onInputChange?: (v: string) => void }) {
  return (
    <ComboboxRoot onInputChange={onInputChange}>
      <ComboboxInput aria-label="Fruit" />
      <ComboboxPositioner>
        <ComboboxPopup aria-label="Fruits">
          <ComboboxOption value="apple">Apple</ComboboxOption>
          <ComboboxOption value="banana">Banana</ComboboxOption>
        </ComboboxPopup>
      </ComboboxPositioner>
    </ComboboxRoot>
  );
}

describe('Combobox Input', () => {
  it('has combobox role wired to the listbox', () => {
    const { getByRole } = render(<Single />);
    const input = getByRole('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
  });

  it('typing opens the popup and reports the query', async () => {
    const onInputChange = vi.fn();
    const { getByRole } = render(<Single onInputChange={onInputChange} />);
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'ap' } });
    await act(async () => {});
    expect(onInputChange).toHaveBeenCalledWith('ap');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('ArrowDown opens and sets the active descendant; Enter commits it', async () => {
    const onValueChange = vi.fn();
    const { getByRole } = render(
      <ComboboxRoot onValueChange={onValueChange}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
            <ComboboxOption value="banana">Banana</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await act(async () => {});
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {});
    expect(onValueChange).toHaveBeenCalledWith('apple');
  });

  it('Escape closes; second Escape resets the input to the selected label', async () => {
    const { getByRole } = render(<Single />);
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'ap' } });
    await act(async () => {});
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => {});
    expect(input.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => {});
    expect(input.value).toBe(''); // nothing selected -> cleared
  });

  it('multiple: Backspace on empty input removes the last token', async () => {
    const onValueChange = vi.fn();
    const { getByRole, getByText } = render(
      <ComboboxRoot multiple defaultOpen onValueChange={onValueChange}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
            <ComboboxOption value="banana">Banana</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    fireEvent.click(getByText('Apple'));
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'Backspace' });
    await act(async () => {});
    // toggled apple off again
    expect(onValueChange).toHaveBeenLastCalledWith([]);
  });

  it('Enter with no active option does not preventDefault (lets the form submit)', async () => {
    const { getByRole } = render(
      <ComboboxRoot autocomplete="none" defaultOpen>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits" />
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    // popup open, autocomplete=none, no navigation -> activeId is null, so the
    // input must not consume Enter. fireEvent returns false when the event was
    // canceled (preventDefault called); true means native behavior proceeds.
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    const notCanceled = fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {});
    expect(notCanceled).toBe(true);
  });
});
