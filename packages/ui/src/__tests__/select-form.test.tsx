// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPositioner,
  SelectPopup,
  SelectOption,
} from '../select/select.js';

afterEach(cleanup);

describe('Select form field', () => {
  it('single: renders one hidden input with the serialized value', () => {
    const { container } = render(
      <SelectRoot name="fruit" defaultValue="banana">
        <SelectTrigger>
          <SelectValue placeholder="x" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup aria-label="f">
            <SelectOption value="banana">Banana</SelectOption>
          </SelectPopup>
        </SelectPositioner>
      </SelectRoot>
    );
    const inputs = container.querySelectorAll(
      'input[type="hidden"][name="fruit"]'
    );
    expect(inputs.length).toBe(1);
    expect((inputs[0] as HTMLInputElement).value).toBe('banana');
  });

  it('multi: renders one hidden input per selected value, repeated name', () => {
    const { container } = render(
      <SelectRoot name="fruit" multiple defaultValue={['apple', 'cherry']}>
        <SelectTrigger>
          <SelectValue placeholder="x" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup aria-label="f">
            <SelectOption value="apple">Apple</SelectOption>
            <SelectOption value="cherry">Cherry</SelectOption>
          </SelectPopup>
        </SelectPositioner>
      </SelectRoot>
    );
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        'input[type="hidden"][name="fruit"]'
      )
    );
    expect(inputs.map((i) => i.value).sort()).toEqual(['apple', 'cherry']);
  });

  it('renders no hidden field when name is absent', () => {
    const { container } = render(
      <SelectRoot defaultValue="banana">
        <SelectTrigger>
          <SelectValue placeholder="x" />
        </SelectTrigger>
        <SelectPositioner>
          <SelectPopup aria-label="f">
            <SelectOption value="banana">Banana</SelectOption>
          </SelectPopup>
        </SelectPositioner>
      </SelectRoot>
    );
    expect(container.querySelectorAll('input[type="hidden"]').length).toBe(0);
  });

  it('resets to defaultValue when the enclosing form is reset', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <form>
        <SelectRoot
          name="fruit"
          value="cherry"
          defaultValue="banana"
          onValueChange={onValueChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="x" />
          </SelectTrigger>
          <SelectPositioner>
            <SelectPopup aria-label="f">
              <SelectOption value="banana">Banana</SelectOption>
              <SelectOption value="cherry">Cherry</SelectOption>
            </SelectPopup>
          </SelectPositioner>
        </SelectRoot>
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onValueChange).toHaveBeenCalledWith('banana');
  });

  it('does not reset when the form reset is defaultPrevented', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <form onReset={(e) => e.preventDefault()}>
        <SelectRoot
          name="fruit"
          value="cherry"
          defaultValue="banana"
          onValueChange={onValueChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="x" />
          </SelectTrigger>
          <SelectPositioner>
            <SelectPopup aria-label="f">
              <SelectOption value="banana">Banana</SelectOption>
              <SelectOption value="cherry">Cherry</SelectOption>
            </SelectPopup>
          </SelectPositioner>
        </SelectRoot>
      </form>
    );
    fireEvent.reset(container.querySelector('form')!);
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
