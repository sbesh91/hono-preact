import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import type { Plugin } from 'vite';

function transform(
  code: string,
  id: string,
  root = '/Users/me/repo'
): string | undefined {
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
    expect(out).toContain(
      '__moduleKey: "src/pages/movie", __loaderName: "summary"'
    );
    expect(out).toContain(
      '__moduleKey: "src/pages/movie", __loaderName: "cast"'
    );
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

  it('injects __moduleKey + __loaderName into serverRoute().loader(...) calls', () => {
    const code = `
      import { serverRoute } from '@hono-preact/iso';
      const route = serverRoute('/movies/:id');
      export const serverLoaders = {
        summary: route.loader(async () => ({})),
        cast: route.loader(async function* () { yield {}; }, { params: ['q'] }),
      };
    `;
    const out = transform(code, '/Users/me/repo/src/pages/movie.server.ts');
    // 1-arg .loader(): opts appended after the fn.
    expect(out).toContain(
      '__moduleKey: "src/pages/movie", __loaderName: "summary"'
    );
    // 2-arg .loader(fn, opts): merged into the existing opts object.
    expect(out).toContain(
      '__moduleKey: "src/pages/movie", __loaderName: "cast"'
    );
    expect(out).toContain("params: ['q']");
  });

  it('serverRoute().loader: route id literal survives the transform (runtime sets __routeId)', () => {
    // The plugin does NOT inject __routeId; defineLoader extracts the route string
    // from its route-form first argument and sets ref.__routeId from it, so no
    // plugin injection is needed. The transform must leave the
    // `serverRoute('/movies/:id')` string literal intact so the runtime value is
    // available when the module executes.
    const code = `
      import { serverRoute } from '@hono-preact/iso';
      const route = serverRoute('/movies/:id');
      export const serverLoaders = {
        default: route.loader(async () => ({})),
      };
    `;
    const out =
      transform(code, '/Users/me/repo/src/pages/movie.server.ts') ?? '';
    // The plugin must not remove or mangle the route string literal.
    expect(out).toContain("serverRoute('/movies/:id')");
    // __routeId is NOT injected by the plugin (set at runtime via serverRoute).
    expect(out).not.toContain('__routeId');
    // The plugin still injects __moduleKey and __loaderName as usual.
    expect(out).toContain('__moduleKey: "src/pages/movie"');
    expect(out).toContain('__loaderName: "default"');
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
