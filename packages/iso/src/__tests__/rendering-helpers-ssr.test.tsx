// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { signal } from '@preact/signals';
import { For } from '../for.js';
import { Show } from '../show.js';

describe('rendering helpers SSR', () => {
  it('<For> renders its rows through renderToString', () => {
    const each = signal<readonly string[]>(['a', 'b']);
    const html = renderToString(
      <ul>
        <For each={each}>{(id) => <li>{id.value}</li>}</For>
      </ul>
    );
    expect(html).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('<For> renders nothing for an empty array', () => {
    const each = signal<readonly string[]>([]);
    const html = renderToString(
      <ul>
        <For each={each}>{(id) => <li>{id.value}</li>}</For>
      </ul>
    );
    expect(html).toBe('<ul></ul>');
  });

  it('<For> renders keyed object rows through renderToString', () => {
    const each = signal<readonly { id: string; label: string }[]>([
      { id: '1', label: 'one' },
      { id: '2', label: 'two' },
    ]);
    const html = renderToString(
      <ul>
        <For each={each} by={(t) => t.id}>
          {(t) => <li>{t.value.label}</li>}
        </For>
      </ul>
    );
    expect(html).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('<Show> renders the branch on the server', () => {
    const on = signal(true);
    const off = signal(false);
    expect(
      renderToString(
        <Show when={on} fallback={<i>no</i>}>
          {<b>yes</b>}
        </Show>
      )
    ).toBe('<b>yes</b>');
    expect(
      renderToString(
        <Show when={off} fallback={<i>no</i>}>
          {<b>yes</b>}
        </Show>
      )
    ).toBe('<i>no</i>');
  });
});
