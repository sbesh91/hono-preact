// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPositioner,
  SelectPopup,
  SelectOption,
} from '../select/select.js';

afterEach(cleanup);

function open(utils: ReturnType<typeof render>) {
  fireEvent.click(utils.getByRole('combobox'));
}

describe('Select Option', () => {
  it('single: selecting sets value, marks aria-selected, closes, shows label', async () => {
    const onValueChange = vi.fn();
    const utils = render(
      <SelectRoot onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup aria-label="Fruits">
            <SelectOption value="apple">Apple</SelectOption>
            <SelectOption value="banana">Banana</SelectOption>
          </SelectPopup>
        </SelectPositioner>
      </SelectRoot>
    );
    await act(async () => {});
    open(utils);
    fireEvent.click(utils.getByText('Banana'));
    expect(onValueChange).toHaveBeenCalledWith('banana');
    expect(utils.getByRole('combobox').getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(utils.getByRole('combobox').textContent).toContain('Banana');
  });

  it('multi: toggling keeps it open and accumulates values', async () => {
    const onValueChange = vi.fn();
    const utils = render(
      <SelectRoot multiple onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup aria-label="Fruits">
            <SelectOption value="apple">Apple</SelectOption>
            <SelectOption value="banana">Banana</SelectOption>
          </SelectPopup>
        </SelectPositioner>
      </SelectRoot>
    );
    await act(async () => {});
    open(utils);
    fireEvent.click(utils.getByText('Apple'));
    fireEvent.click(utils.getByText('Banana'));
    expect(onValueChange).toHaveBeenLastCalledWith(['apple', 'banana']);
    expect(utils.getByRole('combobox').getAttribute('aria-expanded')).toBe(
      'true'
    );
    expect(utils.getByText('Apple').getAttribute('aria-selected')).toBe('true');
  });

  it('updates the trigger auto-label when an option text changes (same value)', async () => {
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
          <SelectRoot value="apple">
            <SelectTrigger>
              <SelectValue placeholder="Pick" />
            </SelectTrigger>
            <SelectPositioner>
              <SelectPopup aria-label="Fruits">
                <SelectOption value="apple">{label}</SelectOption>
                <SelectOption value="banana">Banana</SelectOption>
              </SelectPopup>
            </SelectPositioner>
          </SelectRoot>
        </div>
      );
    }
    const utils = render(<Harness />);
    await act(async () => {});
    expect(utils.getByRole('combobox').textContent).toContain('Apple');
    await act(async () => {
      fireEvent.click(utils.getByTestId('rename'));
    });
    expect(utils.getByRole('combobox').textContent).toContain('Apricot');
  });

  it('disabled option is not selectable and is aria-disabled', async () => {
    const onValueChange = vi.fn();
    const utils = render(
      <SelectRoot onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup aria-label="Fruits">
            <SelectOption value="apple" disabled>
              Apple
            </SelectOption>
          </SelectPopup>
        </SelectPositioner>
      </SelectRoot>
    );
    await act(async () => {});
    open(utils);
    expect(utils.getByText('Apple').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(utils.getByText('Apple'));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
