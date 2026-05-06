import { describe, it, expect } from 'vitest';
import { serverOnlyPlugin, VITE_ROOT_ACCESSOR } from '../index.js';
import type { Plugin } from 'vite';

type TransformFn = (
  code: string,
  id: string,
  options?: { ssr?: boolean }
) => { code: string; map: unknown } | undefined;

function transform(
  code: string,
  id: string,
  options: { ssr?: boolean; root?: string } = {}
): { code: string; map: unknown } | undefined {
  const plugin = serverOnlyPlugin() as Plugin & {
    transform: TransformFn;
    configResolved?: (c: { root: string }) => void;
  };
  plugin.configResolved?.({ root: options.root ?? '/Users/me/repo' });
  const { ssr } = options;
  return plugin.transform.call({} as any, code, id, ssr ? { ssr } : {});
}

describe('serverOnlyPlugin', () => {
  it('replaces a default *.server.* import with an RPC fetch stub keyed by module path', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(`fetch('/__loaders'`);
    expect(result?.code).toContain('"src/pages/movies"');
    expect(result?.code).toContain('location.path');
    expect(result?.code).toContain('location.pathParams');
    expect(result?.code).toContain('location.searchParams');
    expect(result?.code).not.toContain('async () => ({})');
  });

  it('replaces serverGuards named import with an empty array stub', () => {
    const code = `import serverLoader, { serverGuards } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
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

  it('stubs all .server imports when a file has more than one (each with its own path key)', () => {
    const code = [
      `import serverLoader from './movies.server.js';`,
      `import authLoader from './auth.server.js';`,
    ].join('\n');
    const result = transform(code, '/Users/me/repo/src/pages/page.tsx');
    expect(result?.code).toContain('"src/pages/movies"');
    expect(result?.code).toContain('"src/pages/auth"');
    expect(result?.code).not.toContain('async () => ({})');
  });

  it('replaces serverActions named import with a Proxy stub using module path key', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "src/pages/movies"');
    expect(result?.code).toContain('__action: String(action)');
  });

  it('handles serverActions alongside default import in the same statement', () => {
    const code = `import serverLoader, { serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('fetch(\'/__loaders\'');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "src/pages/movies"');
  });

  it('handles serverActions alongside serverGuards in the same statement', () => {
    const code = `import { serverGuards, serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverGuards = [];');
    expect(result?.code).toContain('const serverActions = new Proxy(');
  });

  it('derives module key from nested path correctly', () => {
    const code = `import { serverActions } from '../../pages/profile.server.ts';`;
    const result = transform(code, '/Users/me/repo/src/components/nav.tsx');
    expect(result?.code).toContain('__module: "pages/profile"');
  });

  it('leaves serverActions import untouched in SSR builds', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx', { ssr: true });
    expect(result).toBeUndefined();
  });

  it('replaces actionGuards named import with an empty array stub', () => {
    const code = `import { actionGuards } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const actionGuards = [];');
  });

  it('handles actionGuards alongside serverActions in the same statement', () => {
    const code = `import { actionGuards, serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const actionGuards = [];');
    expect(result?.code).toContain('const serverActions = new Proxy(');
  });

  it('stubs renamed actionGuards imports using the local alias name', () => {
    // The plugin detects via imported.name ('actionGuards') and stubs using the local alias
    const code = `import { actionGuards as guards } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    // The plugin detects the import via imported.name ('actionGuards') and stubs it
    // using the local alias name — so 'guards' becomes the stub variable.
    // This means renamed imports ARE transformed; the stub uses the alias.
    expect(result?.code).toContain('const guards = [];');
  });

  it('derives module key for default stub from the import source, not the consumer file', () => {
    const code = `import loader from './profile.server.ts';`;
    const result = transform(code, '/Users/me/repo/src/pages/some-other-page.tsx');
    expect(result?.code).toContain('"src/pages/profile"');
    expect(result?.code).not.toContain('"src/pages/some-other-page"');
  });
});

describe('loader and cache specifiers', () => {
  it('replaces a `loader` named import with a client-side LoaderRef stub', () => {
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result?.code).toMatch(/const loader = \{[\s\S]*__id: Symbol\.for\(['"]@hono-preact\/loader:src\/movies['"]\)[\s\S]*fn:\s*async/);
    expect(result?.code).toContain("fetch('/__loaders'");
    expect(result?.code).toContain('"src/movies"');
  });

  it('replaces a `cache` named import with a createCache call using the source-file name', () => {
    // The fixture file isn't available here; the plugin should fall back to module key.
    const code = `import { cache } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result?.code).toContain('createCache as');
    // Expect the fallback name (module key derived from server file path) since no fixture exists.
    // The plugin uses a unique alias (e.g. __$createCache_...) to avoid collisions,
    // so match `createCache[_a-zA-Z0-9$]*("src/movies")` to allow either bare or aliased call sites.
    expect(result?.code).toMatch(/createCache[_a-zA-Z0-9$]*\(['"]src\/movies['"]\)/);
  });

  it('handles `loader` aliased to a different local name', () => {
    const code = `import { loader as moviesLoader } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result?.code).toMatch(/const moviesLoader = \{[\s\S]*Symbol\.for/);
    expect(result?.code).toContain('"src/movies"');
  });

  it('handles `cache` aliased to a different local name', () => {
    const code = `import { cache as moviesCache } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result?.code).toContain('const moviesCache =');
    expect(result?.code).toMatch(/createCache[_a-zA-Z0-9$]*\(['"]src\/movies['"]\)/);
  });

  it('handles mixed loader + cache + serverActions in one import statement', () => {
    const code = `import { loader, cache, serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const loader =');
    expect(result?.code).toContain('const cache =');
    expect(result?.code).toContain('const serverActions = new Proxy');
  });

  it('handles mixed default + loader in one import statement', () => {
    const code = `import serverLoader, { loader } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result?.code).toContain('const serverLoader =');
    expect(result?.code).toContain('const loader =');
  });

  it('matches an import that has ONLY loader (no default, no actions, no guards)', () => {
    // This is the bug from the route-level-loaders migration: imports with only
    // `loader` were silently passed through.
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result).toBeDefined();
    expect(result?.code).not.toContain("import { loader }");
    expect(result?.code).toContain('const loader =');
  });

  it('matches an import that has ONLY cache (no default, no actions, no guards)', () => {
    const code = `import { cache } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result).toBeDefined();
    expect(result?.code).not.toContain("import { cache }");
    expect(result?.code).toContain('const cache =');
  });

  it('emits cache stubs that go through cacheRegistry.acquire for identity', () => {
    const code = `import { cache } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result?.code).toContain('.acquire(');
    expect(result?.code).toContain('cacheRegistry');
  });

  it('emits the path key in named `loader` stubs as Symbol.for(@hono-preact/loader:<key>)', () => {
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain(
      `Symbol.for('@hono-preact/loader:src/pages/movies')`
    );
  });
});

describe('unknown specifiers from .server.* imports', () => {
  it('throws a clear error when an unknown named export is imported from .server.*', () => {
    const code = `import { unknownExport } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/iso.tsx')).toThrow(
      /unknownExport.*not a recognized.*server/i
    );
  });
});

describe('side-effect and type-only imports', () => {
  it('strips a side-effect-only .server.* import', () => {
    const code = `import './x.server.js';\nconst foo = 1;`;
    const result = transform(code, '/Users/me/repo/p.tsx');
    expect(result?.code).not.toContain('.server');
    expect(result?.code).toContain('const foo = 1');
  });

  it('leaves `import type { Foo } from .server.*` untouched (or stripped — either is safe since types are erased)', () => {
    const code = `import type { Foo } from './x.server.js';\nconst foo = 1;`;
    // Should NOT throw. The exact transform output is flexible — assert no throw.
    expect(() => transform(code, '/Users/me/repo/p.tsx')).not.toThrow();
  });

  it('handles mixed `import { type Foo, default as loader } from .server.*`', () => {
    const code = `import { type Foo, default as loader } from './x.server.js';`;
    expect(() => transform(code, '/Users/me/repo/p.tsx')).not.toThrow();
    const result = transform(code, '/Users/me/repo/p.tsx');
    // The default import should still be stubbed.
    expect(result?.code).toContain("fetch('/__loaders'");
    // The type import should be skipped (no Foo declaration emitted).
    expect(result?.code).not.toContain('const Foo');
  });
});

describe('loader RPC stub uses searchParams (not the deprecated query)', () => {
  it('default import stub builds searchParams from location.searchParams', () => {
    const code = `import serverLoader from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('searchParams: location.searchParams');
    expect(result?.code).not.toContain('query: location.query');
  });

  it('loader named-import stub builds searchParams from location.searchParams', () => {
    const code = `import { loader } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result?.code).toContain('searchParams: location.searchParams');
    expect(result?.code).not.toContain('query: location.query');
  });
});

describe('re-exports from .server.* are rejected', () => {
  it('throws on `export { loader } from .server.*`', () => {
    const code = `export { loader } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/aggregator.ts')).toThrow(
      /re-export.*from.*\.server.*not supported/i
    );
  });

  it('throws on `export { loader as moviesLoader } from .server.*`', () => {
    const code = `export { loader as moviesLoader } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/aggregator.ts')).toThrow(
      /re-export.*from.*\.server.*not supported/i
    );
  });

  it('throws on `export * from .server.*`', () => {
    const code = `export * from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/aggregator.ts')).toThrow(
      /re-export.*from.*\.server.*not supported/i
    );
  });

  it('does not throw on regular `export * from` of a non-server module', () => {
    const code = `export * from './utils.js';`;
    expect(() => transform(code, '/Users/me/repo/src/aggregator.ts')).not.toThrow();
  });
});

describe('cache alias suffix is collision-free', () => {
  it('produces distinct cache aliases for module sources that sanitize to the same identifier', () => {
    // Before the hash-based suffix, a sanitizer of /[^a-zA-Z0-9_$]/g -> '_'
    // collapsed both "foo-bar" and "foo_bar" to the same alias and broke
    // multi-import cases that resolved to either.
    const code = [
      `import { cache as a } from './foo-bar.server.js';`,
      `import { cache as b } from './foo_bar.server.js';`,
    ].join('\n');
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result).toBeDefined();
    // Two distinct cacheRegistry alias bindings should be emitted.
    const matches = result!.code.match(/__\$cacheRegistry_[a-zA-Z0-9$_]+/g) ?? [];
    const unique = new Set(matches);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});

describe('loader RPC stub key alignment', () => {
  it('default and loader-named stubs share the same fetch envelope (refactored helper)', () => {
    const code = [
      `import serverLoader from './movies.server.js';`,
      `import { loader } from './movies.server.js';`,
    ].join('\n');
    const result = transform(code, '/Users/me/repo/src/iso.tsx');
    expect(result).toBeDefined();
    // Both stubs include the same module RPC body shape.
    const fetchOccurrences =
      (result!.code.match(/fetch\('\/__loaders'/g) ?? []).length;
    expect(fetchOccurrences).toBe(2);
    // Same module string is referenced from both stubs.
    const moduleOccurrences =
      (result!.code.match(/module:\s*"src\/movies"/g) ?? []).length;
    expect(moduleOccurrences).toBe(2);
  });
});

describe('serverOnlyPlugin viteRoot capture', () => {
  it('captures viteRoot from configResolved and exposes it via VITE_ROOT_ACCESSOR', () => {
    const plugin = serverOnlyPlugin() as Plugin & {
      configResolved?: (config: { root: string }) => void;
      [VITE_ROOT_ACCESSOR]?: () => string | undefined;
    };
    expect(plugin[VITE_ROOT_ACCESSOR]?.()).toBeUndefined();
    plugin.configResolved?.({ root: '/Users/me/repo' });
    expect(plugin[VITE_ROOT_ACCESSOR]?.()).toBe('/Users/me/repo');
  });
});

describe('loader stub Symbol.for keying uses path-derived key', () => {
  it('uses the path-derived key (not defineLoader name) for the loader Symbol', () => {
    // After path-keying, the Symbol is derived from the module path, not the
    // defineLoader('foo', ...) first-arg string in the source file.
    const fixtureRoot =
      '/Users/stevenbeshensky/Documents/repos/hono-preact/packages/vite/src/__tests__/fixtures/leak-test';
    const importerPath = fixtureRoot + '/iso.tsx';
    const code = `import { loader } from './pages/foo.server.js';`;
    const result = transform(code, importerPath, { root: fixtureRoot });
    expect(result).toBeDefined();
    expect(result?.code).toContain(
      "__id: Symbol.for('@hono-preact/loader:pages/foo')"
    );
  });

  it('uses path key even when the source file is unreachable', () => {
    const code = `import { loader } from './nope.server.js';`;
    const result = transform(code, '/Users/me/repo/no/such/path/iso.tsx');
    expect(result).toBeDefined();
    // Uses path-derived key, not basename fallback.
    expect(result?.code).toContain(
      "__id: Symbol.for('@hono-preact/loader:no/such/path/nope')"
    );
  });
});
