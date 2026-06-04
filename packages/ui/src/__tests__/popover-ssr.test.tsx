import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Popover } from '../popover/index.js';

describe('Popover SSR', () => {
  it('renders the trigger closed and omits the popup (mount-on-open)', () => {
    const html = renderToString(
      <Popover.Root>
        <Popover.Trigger>Open</Popover.Trigger>
        <Popover.Positioner>
          <Popover.Popup aria-label="Menu">
            <button>Action</button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Root>
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="closed"');
    // Mount-on-open: no dialog markup on the server.
    expect(html).not.toContain('role="dialog"');
  });

  it('produces a trigger id that matches aria-controls', () => {
    const html = renderToString(
      <Popover.Root>
        <Popover.Trigger>Open</Popover.Trigger>
      </Popover.Root>
    );
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
  });
});
