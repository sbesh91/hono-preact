// @vitest-environment happy-dom
// SSR-to-hydrate parity for <For>: the client re-creates every per-row cell
// fresh (nothing is serialised), so hydration must adopt the server DOM
// rather than remount it, and the list must stay reactive afterwards.
import { describe, it, expect, afterEach } from 'vitest';
import { hydrate } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { act } from '@testing-library/preact';
import { signal } from '@preact/signals';
import { For } from '../for.js';

let container: HTMLElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

describe('<For> hydration', () => {
  it('adopts server-rendered rows without remounting, then stays reactive', async () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    const ui = (
      <ul>
        <For each={each} by={(t) => t.id}>
          {(t) => <li data-testid={`h-${t.value.id}`}>{t.value.label}</li>}
        </For>
      </ul>
    );
    container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(ui);
    const serverNode = container.querySelector('[data-testid="h-1"]');
    expect(serverNode?.textContent).toBe('one');

    await act(async () => {
      hydrate(ui, container as HTMLElement);
    });
    // Hydration adopted the server DOM: same node, not a remount.
    expect(container.querySelector('[data-testid="h-1"]')).toBe(serverNode);

    // And the hydrated list is live: a data change patches the same node,
    // and a membership change appends without disturbing survivors.
    await act(async () => {
      each.value = [
        { id: '1', label: 'uno' },
        { id: '2', label: 'two' },
        { id: '3', label: 'three' },
      ];
    });
    expect(container.querySelector('[data-testid="h-1"]')).toBe(serverNode);
    expect(serverNode?.textContent).toBe('uno');
    expect(container.querySelector('[data-testid="h-3"]')?.textContent).toBe(
      'three'
    );
  });
});
