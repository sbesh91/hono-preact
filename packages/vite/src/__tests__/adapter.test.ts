import { describe, it, expect } from 'vitest';
import type {
  HonoPreactAdapter,
  HonoPreactAdapterContext,
} from '../adapter.js';

describe('HonoPreactAdapter interface', () => {
  it('a conforming object satisfies the interface and produces an entry tail', () => {
    const ctx: HonoPreactAdapterContext = {
      root: '/project',
      coreAppModuleId: '/project/node_modules/.vite/hono-preact/core-app.tsx',
      entryWrapperId:
        '/project/node_modules/.vite/hono-preact/server-entry.tsx',
    };
    const adapter: HonoPreactAdapter = {
      name: 'fake',
      vitePlugins: () => [],
      wrapEntry: (c) =>
        `export { default } from ${JSON.stringify(c.coreAppModuleId)};\n`,
    };
    expect(adapter.name).toBe('fake');
    expect(adapter.vitePlugins(ctx)).toEqual([]);
    expect(adapter.wrapEntry(ctx)).toContain('core-app.tsx');
  });
});
