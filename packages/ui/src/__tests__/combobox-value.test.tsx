// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { useState } from 'preact/hooks';
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

  it('updates a selected chip label when the option text changes (same value)', async () => {
    function Harness() {
      const [label, setLabel] = useState('Apple');
      return (
        <div>
          <button
            data-testid="rename"
            type="button"
            onClick={() => setLabel('Apricot')}
          >
            rename
          </button>
          <ComboboxRoot multiple defaultOpen value={['apple']}>
            <ComboboxValue>
              {({ selectedItems }) =>
                selectedItems.map((it) => (
                  <span key={it.id} data-testid="chip">
                    {it.label}
                  </span>
                ))
              }
            </ComboboxValue>
            <ComboboxInput aria-label="Fruit" />
            <ComboboxPositioner>
              <ComboboxPopup aria-label="Fruits">
                <ComboboxOption value="apple">{label}</ComboboxOption>
              </ComboboxPopup>
            </ComboboxPositioner>
          </ComboboxRoot>
        </div>
      );
    }
    const utils = render(<Harness />);
    await act(async () => {});
    expect(document.querySelector('[data-testid="chip"]')!.textContent).toBe(
      'Apple'
    );
    await act(async () => {
      fireEvent.click(utils.getByTestId('rename'));
    });
    expect(document.querySelector('[data-testid="chip"]')!.textContent).toBe(
      'Apricot'
    );
  });
});
