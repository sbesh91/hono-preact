import { describe, it, expect } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Dialog } from '../dialog/index.js';

describe('Dialog SSR', () => {
  it('renders a closed dialog (no open attribute) without touching the DOM', () => {
    const html = renderToString(
      <Dialog.Root>
        <Dialog.Trigger>Open</Dialog.Trigger>
        <Dialog.Popup>
          <Dialog.Title>Title</Dialog.Title>
          <Dialog.Description>Body</Dialog.Description>
        </Dialog.Popup>
      </Dialog.Root>
    );
    expect(html).toContain('<dialog');
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('produces stable, matching ids for label wiring', () => {
    const html = renderToString(
      <Dialog.Root>
        <Dialog.Popup>
          <Dialog.Title>Title</Dialog.Title>
        </Dialog.Popup>
      </Dialog.Root>
    );
    const labelledby = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledby).toBeTruthy();
    // The Title's id must equal what the Popup points at.
    expect(html).toContain(`id="${labelledby}"`);
  });

  it('defaultOpen renders closed on the server (top layer is client-only)', () => {
    const html = renderToString(
      <Dialog.Root defaultOpen>
        <Dialog.Popup aria-label="x">
          <p>Body</p>
        </Dialog.Popup>
      </Dialog.Root>
    );
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    expect(html).toContain('data-state="open"');
  });
});
