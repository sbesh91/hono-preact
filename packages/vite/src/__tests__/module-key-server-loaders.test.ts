import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import type { Plugin } from 'vite';

function transform(code: string, id: string, root = '/Users/me/repo'): string | undefined {
  const plugin = moduleKeyPlugin() as Plugin & {
    transform: any;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root });
  const r = plugin.transform.call({} as any, code, id);
  return typeof r === 'object' ? r.code : r;
}

describe('moduleKeyPlugin: serverLoaders walking', () => {
  it('injects __moduleKey + __loaderName into each defineLoader call inside serverLoaders', () => {
    const code = `
      import { defineLoader } from '@hono-preact/iso';
      export const serverLoaders = {
        summary: defineLoader(async () => ({})),
        cast: defineLoader(async function* () { yield {}; }),
      };
    `;
    const out = transform(code, '/Users/me/repo/src/pages/movie.server.ts');
    expect(out).toContain('__moduleKey: "src/pages/movie", __loaderName: "summary"');
    expect(out).toContain('__moduleKey: "src/pages/movie", __loaderName: "cast"');
  });

  it('still injects __moduleKey for top-level export const loader = defineLoader(...)', () => {
    // Backwards behavior is preserved during the transition; once migration
    // is complete, top-level `loader` exports won't exist anymore.
    const code = `
      import { defineLoader } from '@hono-preact/iso';
      export const loader = defineLoader(async () => ({}));
    `;
    const out = transform(code, '/Users/me/repo/src/pages/foo.server.ts');
    expect(out).toContain('__moduleKey: "src/pages/foo"');
  });

  it('does not inject opts when defineLoader already has a second arg', () => {
    const code = `
      import { defineLoader } from '@hono-preact/iso';
      export const serverLoaders = {
        x: defineLoader(async () => ({}), { params: ['q'] }),
      };
    `;
    const out = transform(code, '/Users/me/repo/src/pages/foo.server.ts') ?? '';
    // The plugin should NOT add a third arg or break the existing call.
    // Two acceptable behaviors: (a) skip rewriting (b) merge into the
    // existing opts. We choose (b): merge by inserting __moduleKey/__loaderName
    // into the existing object literal.
    expect(out).toContain('__moduleKey: "src/pages/foo"');
    expect(out).toContain('__loaderName: "x"');
    expect(out).toContain("params: ['q']");
  });
});
