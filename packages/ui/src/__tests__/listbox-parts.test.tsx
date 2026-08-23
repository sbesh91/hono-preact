// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/preact';
import { useMemo, useState } from 'preact/hooks';
import {
  ListboxRoot,
  ListboxInput,
  ListboxList,
  ListboxOption,
  ListboxStatus,
  ListboxEmpty,
} from '../listbox/listbox.js';

afterEach(cleanup);

const ITEMS = ['Alpha', 'Bravo', 'Charlie'];

function Palette({
  onCommit,
  enabled = true,
}: {
  onCommit?: (v: string) => void;
  enabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => ITEMS.filter((i) => i.toLowerCase().includes(query.toLowerCase())),
    [query]
  );
  return (
    <ListboxRoot onCommit={onCommit} enabled={enabled}>
      <ListboxInput
        aria-label="Search"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      <ListboxStatus />
      <ListboxList aria-label="Results">
        {results.map((r) => (
          <ListboxOption key={r} value={r}>
            {r}
          </ListboxOption>
        ))}
        {results.length === 0 && <ListboxEmpty>No results</ListboxEmpty>}
      </ListboxList>
    </ListboxRoot>
  );
}

function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[role="option"]'));
}

describe('Listbox parts', () => {
  it('wires the APG combobox/listbox contract', async () => {
    const { getByRole } = render(<Palette />);
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    const list = getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(options()).toHaveLength(3);
  });

  it('auto-highlights the first option and tracks it in aria-activedescendant', async () => {
    const { getByRole } = render(<Palette />);
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    const first = options()[0];
    expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.hasAttribute('data-highlighted')).toBe(true);
    expect(first.getAttribute('aria-selected')).toBe('true');
    // The highlight-follows aria-selected default must not leak into the
    // styling contract: data-selected marks explicit selection only.
    expect(first.hasAttribute('data-selected')).toBe(false);
  });

  it('ArrowDown/ArrowUp move the highlight with focus staying on the input', async () => {
    const { getByRole } = render(<Palette />);
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await act(async () => {});
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    await act(async () => {});
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  it('Enter commits the highlighted option', async () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<Palette onCommit={onCommit} />);
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await act(async () => {});
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Bravo');
  });

  it('Enter without any options does not commit and stays native', async () => {
    const onCommit = vi.fn();
    const { getByRole } = render(<Palette onCommit={onCommit} />);
    const input = getByRole('combobox') as HTMLInputElement;
    input.value = 'zzz';
    await act(async () => {
      fireEvent.input(input);
    });
    const notCanceled = fireEvent.keyDown(input, { key: 'Enter' });
    expect(notCanceled).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('click and pointerenter commit and highlight', async () => {
    const onCommit = vi.fn();
    render(<Palette onCommit={onCommit} />);
    await act(async () => {});
    const charlie = options()[2];
    fireEvent.pointerEnter(charlie);
    await act(async () => {});
    expect(charlie.hasAttribute('data-highlighted')).toBe(true);
    fireEvent.click(charlie);
    expect(onCommit).toHaveBeenCalledWith('Charlie');
  });

  it('re-highlights the first result when the option set narrows', async () => {
    const { getByRole } = render(<Palette />);
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await act(async () => {});
    input.value = 'ch';
    await act(async () => {
      fireEvent.input(input);
    });
    const remaining = options();
    expect(remaining.map((o) => o.textContent)).toEqual(['Charlie']);
    expect(input.getAttribute('aria-activedescendant')).toBe(remaining[0].id);
  });

  it('announces the result count and shows Empty when nothing matches', async () => {
    const { getByRole, getByText } = render(<Palette />);
    await act(async () => {});
    const status = document.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('3 results available');
    const input = getByRole('combobox') as HTMLInputElement;
    input.value = 'zzz';
    await act(async () => {
      fireEvent.input(input);
    });
    expect(status.textContent).toBe('No results');
    expect(
      getByText('No results', { selector: '[role="presentation"]' })
    ).toBeTruthy();
    expect(getByRole('listbox').hasAttribute('data-empty')).toBe(true);
  });

  it('disabled options are skipped by navigation and do not commit', async () => {
    const onCommit = vi.fn();
    const { getByRole } = render(
      <ListboxRoot onCommit={onCommit}>
        <ListboxInput aria-label="Search" />
        <ListboxList aria-label="Results">
          <ListboxOption value="a">A</ListboxOption>
          <ListboxOption value="b" disabled>
            B
          </ListboxOption>
          <ListboxOption value="c">C</ListboxOption>
        </ListboxList>
      </ListboxRoot>
    );
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    await act(async () => {});
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[2].id);
    fireEvent.click(options()[1]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('enabled=false suppresses activedescendant, announcements, and Empty', async () => {
    const { getByRole } = render(<Palette enabled={false} />);
    await act(async () => {});
    const input = getByRole('combobox') as HTMLInputElement;
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(document.querySelector('[role="status"]')!.textContent).toBe('');
  });

  it('an explicit selected prop overrides the highlight-follows default', async () => {
    render(
      <ListboxRoot>
        <ListboxInput aria-label="Search" />
        <ListboxList aria-label="Results">
          <ListboxOption value="a" selected={false}>
            A
          </ListboxOption>
          <ListboxOption value="b" selected>
            B
          </ListboxOption>
        </ListboxList>
      </ListboxRoot>
    );
    await act(async () => {});
    const [a, b] = options();
    // A is auto-highlighted but explicitly unselected.
    expect(a.hasAttribute('data-highlighted')).toBe(true);
    expect(a.getAttribute('aria-selected')).toBe('false');
    expect(b.getAttribute('aria-selected')).toBe('true');
    expect(b.hasAttribute('data-selected')).toBe(true);
  });
});
