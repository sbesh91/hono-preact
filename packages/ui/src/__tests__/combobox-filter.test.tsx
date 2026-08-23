// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import {
  ComboboxRoot,
  ComboboxInput,
  ComboboxPositioner,
  ComboboxPopup,
  ComboboxOption,
  ComboboxEmpty,
  ComboboxValue,
  type ComboboxFilter,
} from '../combobox/combobox.js';

afterEach(cleanup);

function App({ filter }: { filter?: ComboboxFilter } = {}) {
  return (
    <ComboboxRoot defaultOpen filter={filter}>
      <ComboboxInput aria-label="Fruit" />
      <ComboboxPositioner>
        <ComboboxPopup aria-label="Fruits">
          <ComboboxOption value="apple">Apple</ComboboxOption>
          <ComboboxOption value="banana">Banana</ComboboxOption>
          <ComboboxOption value="cherry">Cherry</ComboboxOption>
          <ComboboxEmpty>No results</ComboboxEmpty>
        </ComboboxPopup>
      </ComboboxPositioner>
    </ComboboxRoot>
  );
}

function visibleOptions(): string[] {
  return Array.from(document.querySelectorAll('[role="option"]')).map(
    (el) => el.textContent ?? ''
  );
}

async function type(input: HTMLInputElement, text: string) {
  input.value = text;
  await act(async () => {
    fireEvent.input(input);
  });
}

describe('Combobox filter', () => {
  it('filters options by substring match on the typed query by default', async () => {
    const { getByRole } = render(<App />);
    const input = getByRole('combobox') as HTMLInputElement;
    expect(visibleOptions()).toEqual(['Apple', 'Banana', 'Cherry']);
    await type(input, 'an');
    expect(visibleOptions()).toEqual(['Banana']);
  });

  it('shows the empty part when nothing matches', async () => {
    const { getByRole, getByText } = render(<App />);
    const input = getByRole('combobox') as HTMLInputElement;
    await type(input, 'zzz');
    expect(visibleOptions()).toEqual([]);
    expect(getByText('No results')).toBeTruthy();
  });

  it('filter={null} disables filtering (server-side escape hatch)', async () => {
    const { getByRole } = render(<App filter={null} />);
    const input = getByRole('combobox') as HTMLInputElement;
    await type(input, 'an');
    expect(visibleOptions()).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('accepts a custom filter function', async () => {
    const startsWith = (label: string, query: string) =>
      label.toLowerCase().startsWith(query.toLowerCase());
    const { getByRole } = render(<App filter={startsWith} />);
    const input = getByRole('combobox') as HTMLInputElement;
    await type(input, 'a');
    expect(visibleOptions()).toEqual(['Apple']);
  });

  it('keeps create options visible regardless of the filter', async () => {
    const { getByRole } = render(
      <ComboboxRoot defaultOpen onCreate={() => {}}>
        <ComboboxInput aria-label="Tag" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Tags">
            <ComboboxOption value="apple">Apple</ComboboxOption>
            <ComboboxOption value="__new__" create>
              Create new
            </ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const input = getByRole('combobox') as HTMLInputElement;
    await type(input, 'zzz');
    expect(visibleOptions()).toEqual(['Create new']);
  });

  it('filters non-string children via itemToString', async () => {
    const { getByRole } = render(
      <ComboboxRoot defaultOpen itemToString={(v: string) => v}>
        <ComboboxInput aria-label="Fruit" />
        <ComboboxPositioner>
          <ComboboxPopup aria-label="Fruits">
            <ComboboxOption value="Apple">
              <em>Apple</em>
            </ComboboxOption>
            <ComboboxOption value="Banana">
              <em>Banana</em>
            </ComboboxOption>
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxRoot>
    );
    const input = getByRole('combobox') as HTMLInputElement;
    await type(input, 'ban');
    expect(visibleOptions()).toEqual(['Banana']);
  });

  it('multi: chips keep their labels when the selected option is filtered out', async () => {
    const { getByRole, getByText } = render(
      <ComboboxRoot multiple defaultOpen>
        <ComboboxValue
          render={(props, { selectedItems }) => (
            <span {...props}>
              {selectedItems.map((it) => (
                <span key={it.id} data-testid="chip">
                  {it.label}
                </span>
              ))}
            </span>
          )}
        />
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
    await type(input, 'ban');
    expect(visibleOptions()).toEqual(['Banana']);
    expect(document.querySelector('[data-testid="chip"]')!.textContent).toBe(
      'Apple'
    );
  });
});
