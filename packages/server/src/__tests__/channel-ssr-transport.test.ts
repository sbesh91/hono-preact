import { describe, expect, it } from 'vitest';
import { assembleDocument } from '../document-shell.js';

describe('assembleDocument channel bootstrap', () => {
  it('emits the snapshot as a global before the body closes', () => {
    const html = assembleDocument({
      html: '<div>app</div>',
      head: {},
      channels: { a: { signedIn: true } },
    });
    expect(html).toContain('window.__HP_CHANNELS__');
    expect(html).toContain('{"a":{"signedIn":true}}');
  });

  it('emits nothing when no channel published', () => {
    const html = assembleDocument({ html: '<div>app</div>', head: {}, channels: null });
    expect(html).not.toContain('__HP_CHANNELS__');
  });

  it('emits nothing when the snapshot is an empty object', () => {
    const html = assembleDocument({ html: '<div>app</div>', head: {}, channels: {} });
    expect(html).not.toContain('__HP_CHANNELS__');
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
