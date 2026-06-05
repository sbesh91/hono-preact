import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Tooltip } from '../tooltip/index.js';

describe('Tooltip SSR', () => {
  it('renders the trigger closed and omits the tooltip (mount-on-open)', () => {
    const html = renderToString(
      <Tooltip.Root>
        <Tooltip.Trigger>Help</Tooltip.Trigger>
        <Tooltip.Positioner>
          <Tooltip.Popup>More</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Root>
    );
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain('role="tooltip"');
    // Closed: the trigger does not describe a not-yet-rendered tooltip.
    expect(html).not.toContain('aria-describedby');
  });
});
