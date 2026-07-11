// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { ComboboxRoot, ComboboxInput } from '../combobox/combobox.js';

afterEach(cleanup);

function FruitCombobox(props: { onValueChange: (v: string | null) => void }) {
  return (
    <form>
      <ComboboxRoot
        name="fruit"
        value="cherry"
        defaultValue="banana"
        defaultInputValue=""
        onValueChange={props.onValueChange}
      >
        <ComboboxInput />
      </ComboboxRoot>
    </form>
  );
}

describe('Combobox form reset', () => {
  it('resets value to defaultValue on form reset', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <FruitCombobox onValueChange={onValueChange} />
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onValueChange).toHaveBeenCalledWith('banana');
  });

  it('resets the input text to its default on form reset', async () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <FruitCombobox onValueChange={onValueChange} />
    );
    const input = container.querySelector(
      'input[role="combobox"]'
    ) as HTMLInputElement;
    // Drive input through Preact's own event path so inputValue state and the
    // controlled `display` both update before we reset.
    fireEvent.input(input, { target: { value: 'che' } });
    await act(async () => {});
    expect(input.value).toBe('che');
    fireEvent.reset(container.querySelector('form')!);
    await act(async () => {});
    expect(input.value).toBe('');
  });

  it('reset with no defaultValue emits null in single mode', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <form>
        <ComboboxRoot name="fruit" value="cherry" onValueChange={onValueChange}>
          <ComboboxInput />
        </ComboboxRoot>
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onValueChange).toHaveBeenCalledWith(null);
  });
});
