// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxInput,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
} from '../combobox/combobox.js';

afterEach(cleanup);

function Both() {
  return (
    <ComboboxRoot autocomplete="both">
      <ComboboxInput aria-label="Fruit" />
      <ComboboxPositioner>
        <ComboboxPopup aria-label="Fruits">
          <ComboboxOption value="apple">Apple</ComboboxOption>
          <ComboboxOption value="apricot">Apricot</ComboboxOption>
        </ComboboxPopup>
      </ComboboxPositioner>
    </ComboboxRoot>
  );
}

describe('Combobox inline completion (both)', () => {
  it('completes the input to the first option with the suffix selected', async () => {
    const { getByRole } = render(<Both />);
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'ap' } });
    await act(async () => {});
    expect(input.value).toBe('Apple');
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(5);
  });

  it('does not complete during IME composition', async () => {
    const { getByRole } = render(<Both />);
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: 'ap' } });
    await act(async () => {});
    expect(input.value).toBe('ap'); // no completion mid-composition
    fireEvent.compositionEnd(input, { data: 'ap' });
    await act(async () => {});
    expect(input.value).toBe('Apple'); // completes after composition ends
  });

  it('Tab accepts the inline completion by committing the active option', async () => {
    let committed: unknown;
    const { getByRole } = render(
      <ComboboxRoot autocomplete="both" onValueChange={(v) => (committed = v)}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
            <ComboboxOption value="apricot">Apricot</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'ap' } });
    await act(async () => {});
    fireEvent.keyDown(input, { key: 'Tab' });
    await act(async () => {});
    expect(committed).toBe('apple');
  });

  it('Backspace removes the selected suffix without re-completing', async () => {
    const { getByRole } = render(<Both />);
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'ap' } });
    await act(async () => {});
    // Simulate the browser deleting the selected suffix: value becomes the typed prefix.
    fireEvent.input(input, { target: { value: 'ap' } });
    // mark this as a deletion by reporting a shorter value next
    fireEvent.input(input, { target: { value: 'a' } });
    await act(async () => {});
    expect(input.value).toBe('a');
  });
});
