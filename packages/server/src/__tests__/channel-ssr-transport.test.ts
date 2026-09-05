import { describe, expect, it } from 'vitest';
import { assembleDocument } from '../document-shell.js';

describe('assembleDocument channel bootstrap', () => {
  it('emits the snapshot as a global', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head: {},
      channels: { a: { signedIn: true } },
    });
    expect(html).toContain('window.__HP_CHANNELS__');
    expect(html).toContain('{"a":{"signedIn":true}}');
  });

  it('emits nothing when no channel published', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head: {},
      channels: null,
    });
    expect(html).not.toContain('__HP_CHANNELS__');
  });

  it('emits nothing when the snapshot is an empty object', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head: {},
      channels: {},
    });
    expect(html).not.toContain('__HP_CHANNELS__');
  });

  // `<ClientScript />` renders an async module script, which is not deferred to
  // end of parse, so the bootstrap must precede it in source order wherever the
  // Layout puts it. Both placements are checked: end of body (the common one)
  // and inside the head (the one an async script can win a race against).
  it('emits the bootstrap before a client script at the end of the body', () => {
    const html = assembleDocument({
      html: '<html><head></head><body><div>app</div><script type="module" src="/entry.js" async></script></body></html>',
      head: {},
      channels: { a: { signedIn: true } },
    });
    expect(html.indexOf('__HP_CHANNELS__')).toBeLessThan(
      html.indexOf('/entry.js')
    );
  });

  it('emits the bootstrap before a client script in the head', () => {
    const html = assembleDocument({
      html: '<html><head><script type="module" src="/entry.js" async></script></head><body><div>app</div></body></html>',
      head: {},
      channels: { a: { signedIn: true } },
    });
    expect(html.indexOf('__HP_CHANNELS__')).toBeLessThan(
      html.indexOf('/entry.js')
    );
  });

  it('falls back to the end of a document with no head', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head: {},
      channels: { a: { signedIn: true } },
    });
    expect(html).toContain('__HP_CHANNELS__');
  });

  it('escapes a closing script tag in a published value', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head: {},
      channels: { a: '</script><script>alert(1)</script>' },
    });
    expect(html).not.toContain('</script><script>alert(1)');
  });
});
