// @vitest-environment happy-dom
// Regression suite for the three failures that got <For> cut from the signals
// release (#355), ported from spike/for-vnode-cache and required GREEN. The
// reworked <For> re-invokes rows with fresh closures on every list change and
// delivers item/index through per-row signal cells, so none of these can
// recur without failing here.
import { describe, it, expect, afterEach } from 'vitest';
import {
  render,
  screen,
  act,
  cleanup,
  fireEvent,
} from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { For } from '../for.js';

afterEach(cleanup);

describe('<For> staleness regression', () => {
  it('(a) a surviving key with changed content renders the NEW content', async () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
    ]);
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`o-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    expect(screen.getByTestId('o-1').textContent).toBe('one');
    await act(async () => {
      each.value = [{ id: '1', label: 'ONE-RENAMED' }];
    });
    expect(screen.getByTestId('o-1').textContent).toBe('ONE-RENAMED');
  });

  it('(b) index updates after an earlier item is removed', async () => {
    const each = signal<readonly string[]>(['a', 'b', 'c']);
    render(
      <For each={each}>
        {(id, i) => <li data-testid={`i-${id.value}`}>{String(i.value)}</li>}
      </For>
    );
    expect(screen.getByTestId('i-b').textContent).toBe('1');
    expect(screen.getByTestId('i-c').textContent).toBe('2');
    await act(async () => {
      each.value = ['b', 'c'];
    });
    expect(screen.getByTestId('i-b').textContent).toBe('0');
    expect(screen.getByTestId('i-c').textContent).toBe('1');
  });

  it('(c) `by` on index tracks a wholly replaced array', async () => {
    const each = signal<readonly string[]>(['x', 'y']);
    render(
      <For each={each} by={(_item, i) => i}>
        {(v, i) => <li data-testid={`c-${i.peek()}`}>{v.value}</li>}
      </For>
    );
    expect(screen.getByTestId('c-0').textContent).toBe('x');
    await act(async () => {
      each.value = ['p', 'q'];
    });
    expect(screen.getByTestId('c-0').textContent).toBe('p');
    expect(screen.getByTestId('c-1').textContent).toBe('q');
  });

  it('(d) a row closing over parent useState sees the current value', async () => {
    const each = signal<readonly string[]>(['a']);
    function Parent() {
      const [n, setN] = useState(0);
      return (
        <>
          <button data-testid="inc" onClick={() => setN((v) => v + 1)}>
            inc
          </button>
          <ul>
            <For each={each}>
              {(id) => (
                <li data-testid={`d-${id.peek()}`}>
                  {id.value}:{String(n)}
                </li>
              )}
            </For>
          </ul>
        </>
      );
    }
    render(<Parent />);
    expect(screen.getByTestId('d-a').textContent).toBe('a:0');
    await act(async () => {
      fireEvent.click(screen.getByTestId('inc'));
    });
    expect(screen.getByTestId('d-a').textContent).toBe('a:1');
  });

  it('(e) with `by`, freshly-deserialised objects reconcile in place', async () => {
    const parse = () => [
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ];
    const each = signal<readonly { id: string; label: string }[]>(parse());
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <li data-testid={`e-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    const firstNode = screen.getByTestId('e-1');
    await act(async () => {
      each.value = parse();
    });
    expect(screen.getByTestId('e-1')).toBe(firstNode);
  });

  it('(e2) with `by`, per-row local state survives a fresh-identity payload', async () => {
    function Counter({ label }: { label: string }) {
      const [n, setN] = useState(0);
      return (
        <li>
          <button
            data-testid={`btn-${label}`}
            onClick={() => setN((v) => v + 1)}
          >
            {label}
          </button>
          <span data-testid={`cnt-${label}`}>{String(n)}</span>
        </li>
      );
    }
    const parse = () => [{ id: '1', label: 'one' }];
    const each = signal<readonly { id: string; label: string }[]>(parse());
    render(
      <For each={each} by={(t) => t.id}>
        {(t) => <Counter label={t.value.label} />}
      </For>
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-one'));
    });
    expect(screen.getByTestId('cnt-one').textContent).toBe('1');
    await act(async () => {
      each.value = parse();
    });
    expect(screen.getByTestId('cnt-one').textContent).toBe('1');
  });

  it('(e-contract) without `by`, fresh identities remount (identity keying is the documented default)', async () => {
    const parse = () => [{ id: '1', label: 'one' }];
    const each = signal<readonly { id: string; label: string }[]>(parse());
    render(
      <For each={each}>
        {(t) => <li data-testid={`k-${t.value.id}`}>{t.value.label}</li>}
      </For>
    );
    const firstNode = screen.getByTestId('k-1');
    await act(async () => {
      each.value = parse();
    });
    expect(screen.getByTestId('k-1')).not.toBe(firstNode);
  });
});
