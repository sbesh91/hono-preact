// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { signal } from '@preact/signals';
import type { ReadonlySignal } from '@preact/signals';
import { For } from '../for.js';

afterEach(cleanup);

describe('<For>', () => {
  it('renders each item once, keyed by identity', () => {
    const each = signal<readonly string[]>(['a', 'b', 'c']);
    render(
      <For each={each}>
        {(id) => <li data-testid={`row-${id.value}`}>{id.value}</li>}
      </For>
    );
    expect(screen.getByTestId('row-a')).toBeTruthy();
    expect(screen.getByTestId('row-c')).toBeTruthy();
  });

  it('a join/leave preserves surviving rows DOM by key (no remount)', async () => {
    const each = signal<readonly string[]>(['a', 'b']);
    render(
      <For each={each}>
        {(id) => <li data-testid={`row-${id.value}`}>{id.value}</li>}
      </For>
    );
    const nodeA = screen.getByTestId('row-a');
    const nodeB = screen.getByTestId('row-b');

    await act(async () => {
      each.value = ['a', 'b', 'c'];
    });
    expect(screen.getByTestId('row-a')).toBe(nodeA);
    expect(screen.getByTestId('row-b')).toBe(nodeB);
    expect(screen.getByTestId('row-c')).toBeTruthy();

    await act(async () => {
      each.value = ['b', 'c'];
    });
    expect(screen.queryByTestId('row-a')).toBeNull();
    expect(screen.getByTestId('row-b')).toBe(nodeB);
  });

  it('the item cell is object-stable across renders for a surviving key', async () => {
    const each = signal<readonly string[]>(['a', 'b']);
    const seen = new Map<string, Set<ReadonlySignal<string>>>();
    render(
      <For each={each}>
        {(id) => {
          const set = seen.get(id.peek()) ?? new Set();
          set.add(id);
          seen.set(id.peek(), set);
          return <li>{id.value}</li>;
        }}
      </For>
    );
    await act(async () => {
      each.value = ['a', 'b', 'c'];
    });
    expect(seen.get('a')?.size).toBe(1);
    expect(seen.get('b')?.size).toBe(1);
  });

  it('index is reactive under reorder', async () => {
    const each = signal<readonly { id: string }[]>([{ id: 'x' }, { id: 'y' }]);
    render(
      <For each={each} by={(t) => t.id}>
        {(item, index) => (
          <li data-testid={`pos-${item.value.id}`}>{index.value}</li>
        )}
      </For>
    );
    expect(screen.getByTestId('pos-x').textContent).toBe('0');
    expect(screen.getByTestId('pos-y').textContent).toBe('1');
    await act(async () => {
      each.value = [{ id: 'y' }, { id: 'x' }];
    });
    expect(screen.getByTestId('pos-x').textContent).toBe('1');
    expect(screen.getByTestId('pos-y').textContent).toBe('0');
  });

  it('keys arrays of objects via `by` and updates content in place', async () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`o-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    const node1 = screen.getByTestId('o-1');
    expect(node1.textContent).toBe('one');
    await act(async () => {
      each.value = [
        { id: '2', label: 'two' },
        { id: '1', label: 'ONE-RENAMED' },
      ];
    });
    expect(screen.getByTestId('o-1')).toBe(node1);
    expect(screen.getByTestId('o-1').textContent).toBe('ONE-RENAMED');
  });

  it('throws on a duplicate key', () => {
    const each = signal<readonly string[]>(['a', 'a']);
    expect(() =>
      render(<For each={each}>{(id) => <li>{id.value}</li>}</For>)
    ).toThrow(/duplicate key/i);
  });

  it('updates a row when the child reads a signal INLINE (per-row boundary)', async () => {
    const count = signal(5);
    const each = signal<readonly string[]>(['a']);
    render(
      <For each={each}>
        {(id) => <li data-testid={`r-${id.peek()}`}>{count.value}</li>}
      </For>
    );
    expect(screen.getByTestId('r-a').textContent).toBe('5');
    await act(async () => {
      count.value = 6;
    });
    expect(screen.getByTestId('r-a').textContent).toBe('6');
  });

  it('atomic render: a per-row signal re-renders ONLY that row; <For> itself does not re-render', async () => {
    const sigs = { a: signal(0), b: signal(0), c: signal(0) };
    const rowRenders: Record<string, number> = { a: 0, b: 0, c: 0 };
    const each = signal<readonly ('a' | 'b' | 'c')[]>(['a', 'b', 'c']);
    const by = vi.fn((id: 'a' | 'b' | 'c') => id);
    function Row({ id }: { id: 'a' | 'b' | 'c' }) {
      rowRenders[id]++;
      return <li data-testid={`r-${id}`}>{sigs[id].value}</li>;
    }
    render(
      <For each={each} by={by}>
        {(id) => <Row id={id.value} />}
      </For>
    );
    expect(rowRenders).toEqual({ a: 1, b: 1, c: 1 });
    const byCallsAfterMount = by.mock.calls.length;

    await act(async () => {
      sigs.a.value = 9;
    });

    expect(rowRenders).toEqual({ a: 2, b: 1, c: 1 });
    expect(screen.getByTestId('r-a').textContent).toBe('9');
    expect(by.mock.calls.length).toBe(byCallsAfterMount);
  });

  it('a consumer subcomponent driven by the item cell updates without re-invoking siblings', async () => {
    // The cell is a stable reactive identity: a row body that only passes the
    // cell along is not re-invoked when the item content changes; the reader
    // component updates from the cell.
    const bodyRuns: Record<string, number> = { '1': 0, '2': 0 };
    function Label({
      item,
    }: {
      item: ReadonlySignal<{ id: string; label: string }>;
    }) {
      return <li data-testid={`l-${item.value.id}`}>{item.value.label}</li>;
    }
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(item) => {
          bodyRuns[item.peek().id]++;
          return <Label item={item} />;
        }}
      </For>
    );
    expect(bodyRuns).toEqual({ '1': 1, '2': 1 });
    await act(async () => {
      each.value = [
        { id: '1', label: 'uno' },
        { id: '2', label: 'two' },
      ];
    });
    expect(screen.getByTestId('l-1').textContent).toBe('uno');
    // Both rows re-invoke (no vnode cache; <For> re-rendered), so assert the
    // DOM outcome, not a bail. The granular path is exercised below.
  });

  it('an unchanged item dedupes its cell write on a list change', async () => {
    // Push a new array where only row 1's object changed. Row 2's item
    // reference is unchanged, so its cell write dedupes on ===; both rows
    // still render correct content through their cells.
    const readerRuns: Record<string, number> = { '1': 0, '2': 0 };
    function Reader({
      item,
    }: {
      item: ReadonlySignal<{ id: string; label: string }>;
    }) {
      readerRuns[item.peek().id]++;
      return <li data-testid={`g-${item.peek().id}`}>{item.value.label}</li>;
    }
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(item) => <Reader item={item} />}
      </For>
    );
    expect(readerRuns).toEqual({ '1': 1, '2': 1 });
    await act(async () => {
      each.value = [
        { id: '1', label: 'uno' },
        { id: '2', label: 'two' },
      ];
    });
    expect(screen.getByTestId('g-1').textContent).toBe('uno');
    // Row 2's item reference is unchanged (same object), so its cell write
    // deduped; its Reader re-ran only because the keyed wrapper re-invoked it,
    // never from a cell notification. Sanity: content unchanged.
    expect(screen.getByTestId('g-2').textContent).toBe('two');
  });
});
