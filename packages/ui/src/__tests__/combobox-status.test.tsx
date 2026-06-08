// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxInput,
  ComboboxStatus,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
} from '../combobox/combobox.js';

afterEach(cleanup);

describe('Combobox Status', () => {
  it('announces the result count when open', async () => {
    const { container } = render(
      <ComboboxRoot defaultOpen>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxStatus />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
            <ComboboxOption value="banana">Banana</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    await act(async () => {});
    const status = container.querySelector('[aria-live="polite"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toBe('2 results available');
  });

  it('supports a render-prop override', async () => {
    const { container } = render(
      <ComboboxRoot defaultOpen>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxStatus render={(_p, { count }) => <span>{count} hits</span>} />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="apple">Apple</ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    await act(async () => {});
    expect(container.textContent).toContain('1 hits');
  });
});
