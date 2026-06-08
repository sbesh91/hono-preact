// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxPositioner,
  ComboboxPopup,
} from '../combobox/combobox.js';

afterEach(cleanup);

describe('Combobox Popup', () => {
  it('renders a listbox with the wiring id, hidden while closed', () => {
    const { queryByRole } = render(
      <ComboboxRoot>
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits" />
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    // Closed -> inside a hidden Positioner, not in the a11y tree.
    expect(queryByRole('listbox')).toBeNull();
    const listbox = queryByRole('listbox', { hidden: true });
    expect(listbox).not.toBeNull();
    expect(listbox!.getAttribute('aria-multiselectable')).toBeNull();
  });

  it('marks aria-multiselectable in multiple mode and open via defaultOpen', () => {
    const { getByRole } = render(
      <ComboboxRoot multiple defaultOpen>
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits" />
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const listbox = getByRole('listbox');
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    expect(listbox.getAttribute('data-empty')).toBe('');
  });
});
