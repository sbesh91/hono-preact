import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin } from '../server-only.js';
import type { Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean; root?: string } = {}
): { code: string; map: unknown } | undefined {
  const plugin = serverOnlyPlugin() as Plugin & {
    transform: any;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root: options.root ?? '/Users/me/repo' });
  return plugin.transform.call(
    {} as any,
    code,
    id,
    options.ssr ? { ssr: options.ssr } : {}
  );
}

describe('serverOnlyPlugin: serverLoaders Proxy stub', () => {
  it('replaces a serverLoaders named import with a Proxy keyed by moduleKey', () => {
    const code = `import { serverLoaders } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(`__$createLoaderStub_hpiso`);
    expect(result?.code).toContain(`new Proxy`);
    expect(result?.code).toContain(`"src/pages/movies"`);
  });

  it('uses the local-name binding when serverLoaders is renamed', () => {
    const code = `import { serverLoaders as movieLoaders } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(`const movieLoaders`);
    expect(result?.code).toContain(`new Proxy`);
  });

  it('rejects an unknown named import from a *.server.* file with a helpful message', () => {
    const code = `import { somethingElse } from './movies.server.js';`;
    expect(() =>
      transform(code, '/Users/me/repo/src/pages/movies.tsx')
    ).toThrow(/not a recognized export/);
  });

  it('no longer accepts the legacy `loader` named import', () => {
    const code = `import { loader } from './movies.server.js';`;
    expect(() =>
      transform(code, '/Users/me/repo/src/pages/movies.tsx')
    ).toThrow(/not a recognized export/);
  });

  it('no longer accepts a default import from a *.server.* file', () => {
    const code = `import serverLoader from './movies.server.js';`;
    expect(() =>
      transform(code, '/Users/me/repo/src/pages/movies.tsx')
    ).toThrow(/not a recognized export/);
  });
});

describe('serverOnlyPlugin: params threading from .server.ts to client Proxy', () => {
  const fixtureDir = path.join(__dirname, 'fixtures', 'params-server');
  const fixtureRoot = path.join(fixtureDir, '..');

  it('emits params meta for loaders that declare params in the .server.ts fixture', () => {
    const code = `import { serverLoaders } from './movies.server.ts';`;
    const importerId = path.join(fixtureDir, 'page.tsx');
    const result = transform(code, importerId, { root: fixtureRoot });
    expect(result?.code).toContain(`__$serverLoadersMeta_serverLoaders`);
    expect(result?.code).toContain(`"summary"`);
    expect(result?.code).toContain(`"genre"`);
    expect(result?.code).toContain(`"cast"`);
    expect(result?.code).toContain(`"*"`);
  });

  it('passes params via the meta object into createLoaderStub', () => {
    const code = `import { serverLoaders } from './movies.server.ts';`;
    const importerId = path.join(fixtureDir, 'page.tsx');
    const result = transform(code, importerId, { root: fixtureRoot });
    // The Proxy get() reads meta[name] and forwards it as `params`
    expect(result?.code).toContain(`params: __meta`);
  });

  it('falls back gracefully when the .server.ts file does not exist', () => {
    const code = `import { serverLoaders } from './nonexistent.server.ts';`;
    const importerId = path.join(fixtureDir, 'page.tsx');
    const result = transform(code, importerId, { root: fixtureRoot });
    // Meta is an empty object; no crash
    expect(result?.code).toContain(`__$serverLoadersMeta_serverLoaders`);
    expect(result?.code).toContain(`{}`);
  });

  it('default loader with no params declaration has no entry in meta', () => {
    const code = `import { serverLoaders } from './movies.server.ts';`;
    const importerId = path.join(fixtureDir, 'page.tsx');
    const result = transform(code, importerId, { root: fixtureRoot });
    // "default" key should NOT appear in meta since it has no params
    const metaMatch = result?.code.match(
      /__\$serverLoadersMeta_serverLoaders\s*=\s*(\{[^}]*\})/
    );
    expect(metaMatch).not.toBeNull();
    expect(metaMatch![1]).not.toContain('"default"');
  });

  it('reads .server.ts from disk when source imports the TS-NodeNext .server.js path', () => {
    // TypeScript NodeNext convention: source code imports the `.js`-suffixed
    // form even though the file on disk is `.ts`. The plugin must fall back
    // to the .ts extension when reading the server file for params extraction,
    // or every loader silently loses its `params` declaration in the client
    // stub — which means client-side navigation never refetches when search
    // params change.
    const code = `import { serverLoaders } from './movies.server.js';`;
    const importerId = path.join(fixtureDir, 'page.tsx');
    const result = transform(code, importerId, { root: fixtureRoot });
    // Should still extract params from movies.server.ts even though the
    // import source uses `.server.js`.
    expect(result?.code).toContain(`__$serverLoadersMeta_serverLoaders`);
    expect(result?.code).toContain(`"summary"`);
    expect(result?.code).toContain(`"genre"`);
  });
});
