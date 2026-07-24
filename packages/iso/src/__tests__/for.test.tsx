// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { For } from '../for.js';

afterEach(cleanup);

// A row that records every time it renders, so we can prove survivors do not
// re-render on a membership change.
function makeRow(renders: Map<string, number>) {
  return function Row({ id }: { id: string }) {
    renders.set(id, (renders.get(id) ?? 0) + 1);
    return <li data-testid={`row-${id}`}>{id}</li>;
  };
}

describe('<For>', () => {
  it('renders each item once, keyed by identity', () => {
    const each = signal<readonly string[]>(['a', 'b', 'c']);
    const renders = new Map<string, number>();
    const Row = makeRow(renders);
    render(<For each={each}>{(id) => <Row id={id} />}</For>);
    expect(screen.getByTestId('row-a')).toBeTruthy();
    expect(screen.getByTestId('row-c')).toBeTruthy();
    expect([...renders.values()]).toEqual([1, 1, 1]);
  });

  it('a join/leave does NOT re-invoke surviving rows', async () => {
    const each = signal<readonly string[]>(['a', 'b']);
    const renders = new Map<string, number>();
    const Row = makeRow(renders);
    render(<For each={each}>{(id) => <Row id={id} />}</For>);
    expect(renders.get('a')).toBe(1);
    expect(renders.get('b')).toBe(1);

    // Join 'c' and leave nobody: 'a' and 'b' must NOT re-render.
    await act(async () => {
      each.value = ['a', 'b', 'c'];
    });
    expect(renders.get('a')).toBe(1); // survivor not re-invoked
    expect(renders.get('b')).toBe(1);
    expect(renders.get('c')).toBe(1);

    // Leave 'a': 'b' and 'c' must NOT re-render, 'a' is unmounted.
    await act(async () => {
      each.value = ['b', 'c'];
    });
    expect(screen.queryByTestId('row-a')).toBeNull();
    expect(renders.get('b')).toBe(1);
    expect(renders.get('c')).toBe(1);
  });

  it('keys arrays of objects via `by`', async () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`o-${t.id}`}>{t.label}</li>}
      </For>
    );
    expect(screen.getByTestId('o-1').textContent).toBe('one');
    // Reorder by the same keys keeps identity (no throw, both still present).
    await act(async () => {
      each.value = [
        { id: '2', label: 'two' },
        { id: '1', label: 'one' },
      ];
    });
    expect(screen.getByTestId('o-2').textContent).toBe('two');
  });

  it('throws on a duplicate key', () => {
    const each = signal<readonly string[]>(['a', 'a']);
    expect(() =>
      render(<For each={each}>{(id) => <li>{id}</li>}</For>)
    ).toThrow(/duplicate key/i);
  });

  it('updates a row when the child reads a signal INLINE (per-row boundary)', async () => {
    // The row runs inside its own component boundary, so an inline `.value`
    // read subscribes the row and stays live. (This fails if <For> caches the
    // eagerly-called child vnode instead of a per-row Item component.)
    const count = signal(5);
    const each = signal<readonly string[]>(['a']);
    render(
      <For each={each}>
        {(id) => <li data-testid={`r-${id}`}>{count.value}</li>}
      </For>
    );
    expect(screen.getByTestId('r-a').textContent).toBe('5');
    await act(async () => {
      count.value = 6;
    });
    expect(screen.getByTestId('r-a').textContent).toBe('6');
  });
});
