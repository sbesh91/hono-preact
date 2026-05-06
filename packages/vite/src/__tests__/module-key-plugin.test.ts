import { describe, it, expect } from 'vitest';
import { moduleKeyPlugin } from '../module-key-plugin.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string
) => { code: string; map: unknown } | undefined;

function makePlugin() {
  const plugin = moduleKeyPlugin() as Plugin & {
    configResolved?: (config: { root: string }) => void;
    transform: TransformFn;
  };
  plugin.configResolved?.({ root: '/Users/me/repo' });
  return plugin;
}

describe('moduleKeyPlugin', () => {
  it('returns undefined for non-server files', () => {
    const plugin = makePlugin();
    const result = plugin.transform.call(
      {} as any,
      `export const x = 1;`,
      '/Users/me/repo/src/util.ts'
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for files outside the configured root', () => {
    const plugin = makePlugin();
    const result = plugin.transform.call(
      {} as any,
      `export default async () => ({});`,
      '/elsewhere/movies.server.ts'
    );
    // viteRoot mismatch is a configuration error; plugin no-ops rather than
    // throws to avoid breaking dev for files outside the watched root.
    expect(result).toBeUndefined();
  });

  it('transforms .server.ts files inside the root (returns a code object)', () => {
    const plugin = makePlugin();
    const code = `export default async () => ({});`;
    const result = plugin.transform.call(
      {} as any,
      code,
      '/Users/me/repo/src/pages/movies.server.ts'
    );
    expect(result).toBeDefined();
    expect(result?.code).toBeTypeOf('string');
  });
});
