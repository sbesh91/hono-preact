import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin } from '../server-only.js';
import type { Plugin } from 'vite';

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
  return plugin.transform.call({} as any, code, id, options.ssr ? { ssr: options.ssr } : {});
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
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /not a recognized export/
    );
  });

  it('no longer accepts the legacy `loader` named import', () => {
    const code = `import { loader } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /not a recognized export/
    );
  });

  it('no longer accepts a default import from a *.server.* file', () => {
    const code = `import serverLoader from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /not a recognized export/
    );
  });
});
