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

  it('replaces serverActions named import with a Proxy stub using module name from filename', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "movies"');
    expect(result?.code).toContain('__action: String(action)');
  });

  it('handles serverActions alongside default import in the same statement', () => {
    const code = `import serverLoader, { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverLoader = async () => ({});');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "movies"');
  });

  it('handles serverActions alongside serverGuards in the same statement', () => {
    const code = `import { serverGuards, serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverGuards = [];');
    expect(result?.code).toContain('const serverActions = new Proxy(');
  });

  it('derives module name from nested path correctly', () => {
    const code = `import { serverActions } from '../../pages/profile.server.ts';`;
    const result = transform(code, '/src/components/nav.tsx');
    expect(result?.code).toContain('__module: "profile"');
  });

  it('leaves serverActions import untouched in SSR builds', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx', { ssr: true });
    expect(result).toBeUndefined();
  });

  it('replaces actionGuards named import with an empty array stub', () => {
    const code = `import { actionGuards } from './movies.server.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result?.code).toContain('const actionGuards = [];');
  });

  it('handles actionGuards alongside serverActions in the same statement', () => {
    const code = `import { actionGuards, serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const actionGuards = [];');
    expect(result?.code).toContain('const serverActions = new Proxy(');
  });
});
