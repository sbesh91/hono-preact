// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxInput,
  ComboboxAnchor,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
} from '../combobox/combobox.js';

afterEach(cleanup);

describe('Combobox openOnFocus', () => {
  it('opens the popup when the input gains focus (default)', async () => {
    const { getByRole } = render(
      <ComboboxRoot>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruit">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const input = getByRole('combobox') as HTMLInputElement;
    fireEvent.focus(input);
    await act(async () => {});
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not open on focus when openOnFocus={false}', async () => {
    const { getByRole } = render(
      <ComboboxRoot openOnFocus={false}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruit">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const input = getByRole('combobox') as HTMLInputElement;
    fireEvent.focus(input);
    await act(async () => {});
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Combobox Anchor', () => {
  it('is a dismiss-safe region: pressing inside it does not close the popup', async () => {
    const { getByRole, getByTestId, queryByRole } = render(
      <ComboboxRoot defaultOpen>
        <ComboboxAnchor data-testid="field">
          <ComboboxInput aria-label="Fruit" />
        </ComboboxAnchor>
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruit">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    expect(getByRole('listbox')).not.toBeNull();

    // A press on the field wrapper (the anchor, not an option) must not dismiss.
    getByTestId('field').dispatchEvent(
      new Event('pointerdown', { bubbles: true })
    );
    await act(async () => {});
    expect(queryByRole('listbox')).not.toBeNull();

    // A press truly outside the control dismisses.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await act(async () => {});
    expect(queryByRole('listbox')).toBeNull();
  });
});
