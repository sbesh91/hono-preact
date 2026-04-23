import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin } from '../index.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean }
) => { code: string; map: unknown } | undefined;

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean } = {}
): { code: string; map: unknown } | undefined {
  const plugin = serverOnlyPlugin() as Plugin & { transform: TransformFn };
  return plugin.transform.call({} as any, code, id, options);
}

describe('serverOnlyPlugin', () => {
  it('replaces a default *.server.* import with an async no-op stub', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result?.code).toBe('const serverLoader = async () => ({});');
  });

  it('replaces serverGuards named import with an empty array stub', () => {
    const code = `import serverLoader, { serverGuards } from './movies.server.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result?.code).toContain('const serverLoader = async () => ({});');
    expect(result?.code).toContain('const serverGuards = [];');
  });

  it('leaves non-server imports untouched (returns undefined)', () => {
    const code = `import { something } from './utils.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result).toBeUndefined();
  });

  it('returns undefined when ssr option is true', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, 'movies.tsx', { ssr: true });
    expect(result).toBeUndefined();
  });

  it('does not transform *.server.* files themselves', () => {
    const code = `export default async function serverLoader() { return {}; }`;
    const result = transform(code, 'movies.server.ts');
    expect(result).toBeUndefined();
  });

  it('returns undefined when the code contains no .server reference', () => {
    const code = `import { helper } from './utils.js';`;
    const result = transform(code, 'page.tsx');
    expect(result).toBeUndefined();
  });

  it('stubs all .server imports when a file has more than one', () => {
    const code = [
      `import serverLoader from './movies.server.js';`,
      `import authLoader from './auth.server.js';`,
    ].join('\n');
    const result = transform(code, 'page.tsx');
    expect(result?.code).toContain('const serverLoader = async () => ({});');
    expect(result?.code).toContain('const authLoader = async () => ({});');
  });
});
