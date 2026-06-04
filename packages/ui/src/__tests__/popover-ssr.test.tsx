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

  it('omits aria-controls while closed (popup is mount-on-open) but keeps a trigger id', () => {
    const html = renderToString(
      <Popover.Root>
        <Popover.Trigger>Open</Popover.Trigger>
      </Popover.Root>
    );
    // No dangling reference to a popup that is not in the server markup.
    expect(html).not.toContain('aria-controls');
    expect(html).toContain('aria-expanded="false"');
    // The trigger still carries a stable id for label wiring.
    expect(html).toMatch(/<button[^>]*\sid="[^"]+"/);
  });
});
