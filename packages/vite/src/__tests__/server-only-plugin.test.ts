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
  it('throws on serverGuards named import (no longer recognized)', () => {
    const code = `import { serverGuards } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /is not a recognized export from a \*\.server\.\* module/,
    );
  });

  it('leaves non-server imports untouched (returns undefined)', () => {
    const code = `import { something } from './utils.js';`;
    const result = transform(code, 'movies.tsx');
    expect(result).toBeUndefined();
  });

  it('returns undefined when ssr option is true', () => {
    const code = `import { serverLoaders } from './movies.server.js';`;
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
      `import { serverLoaders as moviesLoaders } from './movies.server.js';`,
      `import { serverLoaders as authLoaders } from './auth.server.js';`,
    ].join('\n');
    const result = transform(code, '/Users/me/repo/src/pages/page.tsx');
    expect(result?.code).toContain('"src/pages/movies"');
    expect(result?.code).toContain('"src/pages/auth"');
  });

  it('replaces serverActions named import with a Proxy stub using module path key', () => {
    const code = `import { serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "src/pages/movies"');
    expect(result?.code).toContain('__action: String(action)');
    // The stub also exposes useAction wired via the iso re-export.
    expect(result?.code).toContain("import { useAction as __$useAction_hpiso } from '@hono-preact/iso';");
    expect(result?.code).toMatch(/stub\.useAction\s*=\s*\(opts\)\s*=>\s*__\$useAction_hpiso\(stub,\s*opts\)/);
  });

  it('handles serverActions alongside serverLoaders in the same statement', () => {
    const code = `import { serverLoaders, serverActions } from './movies.server.js';`;
    const result = transform(code, '/Users/me/repo/src/pages/movies.tsx');
    expect(result?.code).toContain('const serverLoaders = new Proxy(');
    expect(result?.code).toContain('const serverActions = new Proxy(');
    expect(result?.code).toContain('__module: "src/pages/movies"');
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
    // using the local alias name -- so 'guards' becomes the stub variable.
    // This means renamed imports ARE transformed; the stub uses the alias.
    expect(result?.code).toContain('const guards = [];');
  });

  it('derives module key for serverLoaders stub from the import source, not the consumer file', () => {
    const code = `import { serverLoaders } from './profile.server.ts';`;
    const result = transform(code, '/Users/me/repo/src/pages/some-other-page.tsx');
    expect(result?.code).toContain('"src/pages/profile"');
    expect(result?.code).not.toContain('"src/pages/some-other-page"');
  });
});

describe('cache specifier rejection', () => {
  it('rejects a `cache` named import as an unrecognized export', () => {
    const code = `import { cache } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/iso.tsx')).toThrow(
      /`cache` is not a recognized export from a \*\.server\.\* module/
    );
  });

  it('rejects a mixed cache + serverActions import on the cache specifier', () => {
    const code = `import { cache, serverActions } from './movies.server.js';`;
    expect(() => transform(code, '/Users/me/repo/src/pages/movies.tsx')).toThrow(
      /`cache` is not a recognized export/
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

  it('leaves `import type { Foo } from .server.*` untouched (or stripped -- either is safe since types are erased)', () => {
    const code = `import type { Foo } from './x.server.js';\nconst foo = 1;`;
    // Should NOT throw. The exact transform output is flexible -- assert no throw.
    expect(() => transform(code, '/Users/me/repo/p.tsx')).not.toThrow();
  });

  it('handles mixed `import { type Foo, serverLoaders } from .server.*`', () => {
    const code = `import { type Foo, serverLoaders } from './x.server.js';`;
    expect(() => transform(code, '/Users/me/repo/p.tsx')).not.toThrow();
    const result = transform(code, '/Users/me/repo/p.tsx');
    // serverLoaders should be stubbed with a Proxy.
    expect(result?.code).toContain('const serverLoaders = new Proxy(');
    // The type import should be skipped (no Foo declaration emitted).
    expect(result?.code).not.toContain('const Foo');
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

describe('dynamic import() rewriting for .server.* sources', () => {
  it('rewrites a dynamic import() of a .server.* file to a Promise carrying the module key stub', () => {
    const code = `const m = () => import('./foo.server.ts');`;
    const result = transform(code, '/Users/me/repo/src/routes.ts');
    expect(result).toBeDefined();
    // Stub carries __moduleKey so wrapWithRouteLocations on the client knows
    // which .server module this lazy import represents (the body itself is
    // server-only and stays out of the client bundle).
    expect(result?.code).toContain('Promise.resolve({ __moduleKey: "src/foo" })');
    expect(result?.code).not.toContain("import('./foo.server.ts')");
  });

  it('leaves a string literal containing ".server" untouched when not in a dynamic import', () => {
    const code = `const label = 'movies-list.server.js is the server file';\n`;
    const result = transform(code, '/Users/me/repo/src/routes.ts');
    // No static or dynamic imports of .server.*, so plugin returns undefined.
    expect(result).toBeUndefined();
  });

  it('rewrites both static and dynamic .server.* imports in the same file', () => {
    const code = [
      `import { serverLoaders } from './movies.server.js';`,
      `const lazy = () => import('./auth.server.js');`,
    ].join('\n');
    const result = transform(code, '/Users/me/repo/src/pages/page.tsx');
    expect(result).toBeDefined();
    expect(result?.code).toContain('const serverLoaders = new Proxy(');
    expect(result?.code).toContain('"src/pages/movies"');
    expect(result?.code).toContain('Promise.resolve({ __moduleKey: "src/pages/auth" })');
    expect(result?.code).not.toContain("import('./auth.server.js')");
  });

  it('leaves a dynamic import() of a non-server module untouched', () => {
    const code = `const lazy = () => import('./other.ts');`;
    const result = transform(code, '/Users/me/repo/src/routes.ts');
    // No .server.* substring at all -> early return undefined.
    expect(result).toBeUndefined();
  });

  it('leaves a dynamic import() of a non-server module untouched when other .server text is present', () => {
    // Force the plugin past the `.server` substring early-return so the dynamic
    // walker actually runs; verify it does not falsely rewrite the non-server import.
    const code = [
      `// note: foo.server.ts is referenced elsewhere`,
      `const lazy = () => import('./other.ts');`,
    ].join('\n');
    const result = transform(code, '/Users/me/repo/src/routes.ts');
    // The walker finds no dynamic .server.* import and there are no static
    // .server.* imports either, so the plugin returns undefined.
    expect(result).toBeUndefined();
  });

  it('leaves dynamic .server.* imports untouched in SSR builds', () => {
    const code = `const m = () => import('./foo.server.ts');`;
    const result = transform(code, '/Users/me/repo/src/routes.ts', { ssr: true });
    expect(result).toBeUndefined();
  });

  it('rewrites dynamic .server.* imports even when configResolved has not fired (no viteRoot)', () => {
    const plugin = serverOnlyPlugin() as Plugin & {
      transform: TransformFn;
    };
    // Skip configResolved on purpose; dynamic-only files should still be rewritten.
    // Without viteRoot we cannot derive a __moduleKey, so the stub falls back
    // to a bare `{}` payload.
    const code = `const m = () => import('./foo.server.ts');`;
    const result = plugin.transform.call(
      { warn: () => {} } as any,
      code,
      '/Users/me/repo/src/routes.ts',
      {}
    );
    expect(result).toBeDefined();
    expect(result?.code).toContain('Promise.resolve({})');
  });
});
