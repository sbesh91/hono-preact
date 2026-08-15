import { describe, it, expect } from 'vitest';
import { honoPreact } from '../hono-preact.js';
import type { HonoPreactAdapter } from '../adapter.js';

// Reuses the same minimal stub as hono-preact.test.ts's fakeAdapter(): it is
// not exported from that file, so it is recreated here rather than adding a
// third variant.
function fakeAdapter(): HonoPreactAdapter {
  return {
    name: 'fake',
    vitePlugins: () => [{ name: 'fake-adapter:plugin' }],
    wrapEntry: (c) =>
      `export { default } from ${JSON.stringify(c.coreAppModuleId)};\n`,
  };
}

describe('honoPreact({ assets })', () => {
  it('registers the client-assets plugin when assets are declared', () => {
    const plugins = honoPreact({
      adapter: fakeAdapter(),
      assets: { 'llms.txt': () => 'x' },
    });
    const names = plugins.map((p) => p && (p as { name?: string }).name);
    expect(names).toContain('hono-preact:client-assets');
  });

  it('registers no client-assets plugin when assets are omitted', () => {
    const plugins = honoPreact({ adapter: fakeAdapter() });
    const names = plugins.map((p) => p && (p as { name?: string }).name);
    expect(names).not.toContain('hono-preact:client-assets');
  });
});
