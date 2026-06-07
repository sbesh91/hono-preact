// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxValue,
  ComboboxInput,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
} from '../combobox/combobox.js';

afterEach(cleanup);

describe('Combobox Value (multi)', () => {
  it('exposes selected items and a remove fn', async () => {
    const onValueChange = vi.fn();
    const { getByText } = render(
      <ComboboxRoot multiple defaultOpen onValueChange={onValueChange}>
        <ComboboxValue>
          {({ selectedItems, remove }) =>
            selectedItems.map((it) => (
              <button
                key={it.id}
                data-testid="chip"
                onClick={() => remove(it.value)}
              >
                {it.label}
              </button>
            ))
          }
        </ComboboxValue>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    fireEvent.click(getByText('Apple'));
    await act(async () => {});
    // after selection, the chip is rendered by ComboboxValue
    const chipButton = document.querySelector('[data-testid="chip"]')!;
    expect(chipButton).not.toBeNull();
    // remove via the chip
    fireEvent.click(chipButton);
    await act(async () => {});
    expect(onValueChange).toHaveBeenLastCalledWith([]);
  });
});
