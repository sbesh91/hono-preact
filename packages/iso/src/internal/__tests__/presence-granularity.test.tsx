// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/preact';
import {
  registerPresenceReactiveImpl,
  getPresenceReactiveImpl,
} from '../reactive.js';
import { installPresenceSignals } from '../../signals.js';

afterEach(() => {
  cleanup();
  registerPresenceReactiveImpl(null);
  vi.restoreAllMocks();
});

describe('presence granularity (signal impl)', () => {
  it('a single member update re-renders only that row', async () => {
    installPresenceSignals();
    const store = getPresenceReactiveImpl()!.createRoster<number>();
    store.snapshot([
      { id: 'a', state: 1 },
      { id: 'b', state: 2 },
    ]);

    const renders: Record<string, number> = { a: 0, b: 0, list: 0 };

    function Row({ id }: { id: string }) {
      renders[id]++;
      const m = store.member(id);
      return <li data-testid={`row-${id}`}>{String(m.value?.state)}</li>;
    }
    function List() {
      renders.list++;
      return (
        <ul>
          {store.memberIds.value.map((id) => (
            <Row key={id} id={id} />
          ))}
        </ul>
      );
    }

    render(<List />);
    expect(screen.getByTestId('row-a').textContent).toBe('1');
    expect(screen.getByTestId('row-b').textContent).toBe('2');
    const listBefore = renders.list;
    const bBefore = renders.b;

    await act(async () => {
      store.upsert('a', 9); // update member a only
    });

    expect(screen.getByTestId('row-a').textContent).toBe('9');
    // The payoff: b's row and the list container did NOT re-render.
    expect(renders.b).toBe(bBefore);
    expect(renders.list).toBe(listBefore);
  });
});
