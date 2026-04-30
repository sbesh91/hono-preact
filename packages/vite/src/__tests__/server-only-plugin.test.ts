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
  it('replaces a default *.server.* import with an RPC fetch stub', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('fetch(\'/__loaders\'');
    expect(result?.code).toContain('"movies"');
    expect(result?.code).toContain('location.path');
    expect(result?.code).toContain('location.pathParams');
    expect(result?.code).toContain('location.query');
    expect(result?.code).not.toContain('async () => ({})');
  });

  it('replaces serverGuards named import with an empty array stub', () => {
    const code = `import serverLoader, { serverGuards } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('fetch(\'/__loaders\'');
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
    const result = transform(code, '/src/pages/page.tsx');
    expect(result?.code).toContain('"movies"');
    expect(result?.code).toContain('"auth"');
    expect(result?.code).not.toContain('async () => ({})');
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
    expect(result?.code).toContain('fetch(\'/__loaders\'');
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

  it('stubs renamed actionGuards imports using the local alias name', () => {
    // The plugin detects via imported.name ('actionGuards') and stubs using the local alias
    const code = `import { actionGuards as guards } from './movies.server.js';`;
    const result = transform(code, 'movies.tsx');
    // The plugin detects the import via imported.name ('actionGuards') and stubs it
    // using the local alias name — so 'guards' becomes the stub variable.
    // This means renamed imports ARE transformed; the stub uses the alias.
    expect(result?.code).toContain('const guards = [];');
  });

  it('derives module name for default stub from the import source, not the consumer file', () => {
    const code = `import loader from './profile.server.ts';`;
    const result = transform(code, '/src/pages/some-other-page.tsx');
    expect(result?.code).toContain('"profile"');
    expect(result?.code).not.toContain('"some-other-page"');
  });
});

describe('loader and cache specifiers', () => {
  it('replaces a `loader` named import with a client-side LoaderRef stub', () => {
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toMatch(/const loader = \{[\s\S]*__id: Symbol\.for\(['"]@hono-preact\/loader:movies['"]\)[\s\S]*fn:\s*async/);
    expect(result?.code).toContain("fetch('/__loaders'");
    expect(result?.code).toContain('"movies"');
  });

  it('replaces a `cache` named import with a createCache call using the source-file name', () => {
    // The fixture file isn't available here; the plugin should fall back to module name.
    const code = `import { cache } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toContain("import { createCache as");
    // Expect the fallback name (module name) since no fixture exists for source-extraction.
    // The plugin uses a unique alias (e.g. __$createCache_movies) to avoid collisions,
    // so match `createCache[_a-zA-Z0-9$]*("movies")` to allow either bare or aliased call sites.
    expect(result?.code).toMatch(/createCache[_a-zA-Z0-9$]*\(['"]movies['"]\)/);
  });

  it('handles `loader` aliased to a different local name', () => {
    const code = `import { loader as moviesLoader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toMatch(/const moviesLoader = \{[\s\S]*Symbol\.for/);
    expect(result?.code).toContain('"movies"');
  });

  it('handles `cache` aliased to a different local name', () => {
    const code = `import { cache as moviesCache } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toContain('const moviesCache =');
    expect(result?.code).toMatch(/createCache[_a-zA-Z0-9$]*\(['"]movies['"]\)/);
  });

  it('handles mixed loader + cache + serverActions in one import statement', () => {
    const code = `import { loader, cache, serverActions } from './movies.server.js';`;
    const result = transform(code, '/src/pages/movies.tsx');
    expect(result?.code).toContain('const loader =');
    expect(result?.code).toContain('const cache =');
    expect(result?.code).toContain('const serverActions = new Proxy');
  });

  it('handles mixed default + loader in one import statement', () => {
    const code = `import serverLoader, { loader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result?.code).toContain('const serverLoader =');
    expect(result?.code).toContain('const loader =');
  });

  it('matches an import that has ONLY loader (no default, no actions, no guards)', () => {
    // This is the bug from the route-level-loaders migration: imports with only
    // `loader` were silently passed through.
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result).toBeDefined();
    expect(result?.code).not.toContain("import { loader }");
    expect(result?.code).toContain('const loader =');
  });

  it('matches an import that has ONLY cache (no default, no actions, no guards)', () => {
    const code = `import { cache } from './movies.server.js';`;
    const result = transform(code, '/src/iso.tsx');
    expect(result).toBeDefined();
    expect(result?.code).not.toContain("import { cache }");
    expect(result?.code).toContain('const cache =');
  });
});

describe('unknown specifiers from .server.* imports', () => {
  it('throws a clear error when an unknown named export is imported from .server.*', () => {
    const code = `import { unknownExport } from './movies.server.js';`;
    expect(() => transform(code, '/src/iso.tsx')).toThrow(
      /unknownExport.*not a recognized.*server/i
    );
  });
});

describe('side-effect and type-only imports', () => {
  it('strips a side-effect-only .server.* import', () => {
    const code = `import './x.server.js';\nconst foo = 1;`;
    const result = transform(code, '/p.tsx');
    expect(result?.code).not.toContain('.server');
    expect(result?.code).toContain('const foo = 1');
  });

  it('leaves `import type { Foo } from .server.*` untouched (or stripped — either is safe since types are erased)', () => {
    const code = `import type { Foo } from './x.server.js';\nconst foo = 1;`;
    // Should NOT throw. The exact transform output is flexible — assert no throw.
    expect(() => transform(code, '/p.tsx')).not.toThrow();
  });

  it('handles mixed `import { type Foo, default as loader } from .server.*`', () => {
    const code = `import { type Foo, default as loader } from './x.server.js';`;
    expect(() => transform(code, '/p.tsx')).not.toThrow();
    const result = transform(code, '/p.tsx');
    // The default import should still be stubbed.
    expect(result?.code).toContain("fetch('/__loaders'");
    // The type import should be skipped (no Foo declaration emitted).
    expect(result?.code).not.toContain('const Foo');
  });
});
