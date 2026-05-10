import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { clientShimPlugin } from '../client-shim.js';

type ApplyFn = (
  _: unknown,
  env: { command: string; mode: string }
) => boolean | undefined;

type ShimPlugin = ReturnType<typeof clientShimPlugin> & {
  apply?: ApplyFn;
  configResolved: (config: { root: string; isProduction: boolean }) => void;
  resolveId: (id: string) => string | undefined;
  load: (id: string) => string | undefined;
  transform: (
    code: string,
    id: string
  ) => { code: string; map: null } | undefined;
};

function makePlugin(entry = './src/client.tsx', root = '/repo'): ShimPlugin {
  const plugin = clientShimPlugin(entry) as ShimPlugin;
  plugin.configResolved({ root, isProduction: true });
  return plugin;
}

describe('clientShimPlugin', () => {
  it('runs in dev (serve) and in client builds, but not in SSR builds', () => {
    const apply = (clientShimPlugin('./src/client.tsx') as ShimPlugin).apply!;
    expect(apply({}, { command: 'serve', mode: 'development' })).toBe(true);
    expect(apply({}, { command: 'build', mode: 'client' })).toBe(true);
    expect(apply({}, { command: 'build', mode: 'production' })).toBe(false);
  });

  it('resolves the virtual id to a private resolved id', () => {
    const plugin = makePlugin();
    const resolved = plugin.resolveId('virtual:hono-preact/client-shim');
    expect(resolved).toBeDefined();
    expect(resolved!.startsWith('\0')).toBe(true);
    expect(plugin.resolveId('not-the-virtual')).toBeUndefined();
  });

  it('loads the shim source when isProduction is true with NODE_ENV=production', () => {
    const plugin = makePlugin();
    const resolved = plugin.resolveId('virtual:hono-preact/client-shim')!;
    const source = plugin.load(resolved);
    expect(source).toContain('globalThis.process ??=');
    expect(source).toContain('"production"');
  });

  it('loads the shim source with NODE_ENV=development when not production', () => {
    const plugin = clientShimPlugin('./src/client.tsx') as ShimPlugin;
    plugin.configResolved({ root: '/repo', isProduction: false });
    const resolved = plugin.resolveId('virtual:hono-preact/client-shim')!;
    const source = plugin.load(resolved);
    expect(source).toContain('"development"');
  });

  it('prepends the virtual import to the configured client entry', () => {
    const plugin = makePlugin('./src/client.tsx', '/repo');
    const entryAbs = path.resolve('/repo', './src/client.tsx');
    const result = plugin.transform('hydrate(<App />, app);', entryAbs);
    expect(result).toBeDefined();
    expect(result!.code.startsWith("import 'virtual:hono-preact/client-shim';\n")).toBe(true);
    expect(result!.code).toContain('hydrate(<App />, app);');
  });

  it('strips a query string off the id when matching the entry', () => {
    const plugin = makePlugin('./src/client.tsx', '/repo');
    const entryAbs = path.resolve('/repo', './src/client.tsx');
    const result = plugin.transform('// entry', `${entryAbs}?v=abc`);
    expect(result).toBeDefined();
    expect(result!.code.startsWith("import 'virtual:hono-preact/client-shim';\n")).toBe(true);
  });

  it('does not transform unrelated modules', () => {
    const plugin = makePlugin('./src/client.tsx', '/repo');
    const result = plugin.transform('// other', '/repo/src/iso.tsx');
    expect(result).toBeUndefined();
  });
});
