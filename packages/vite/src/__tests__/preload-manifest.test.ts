import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  collectEntryPreloadModules,
  preloadManifestPlugin,
} from '../preload-manifest.js';
import { PRELOAD_MANIFEST_FILE } from '@hono-preact/iso/internal/runtime';

// Minimal Rollup-output-bundle shape the collector reads.
type Chunk = {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  imports: string[];
};
function chunk(fileName: string, imports: string[], isEntry = false): Chunk {
  return { type: 'chunk', fileName, isEntry, imports };
}

describe('collectEntryPreloadModules', () => {
  it("collects the entry's transitive static imports as root-relative URLs, excluding the entry itself", () => {
    const bundle = {
      'static/client.js': chunk('static/client.js', ['static/a.js'], true),
      'static/a.js': chunk('static/a.js', ['static/b.js']),
      'static/b.js': chunk('static/b.js', []),
    };
    expect(collectEntryPreloadModules(bundle)).toEqual([
      '/static/a.js',
      '/static/b.js',
    ]);
  });

  it('dedupes a diamond so each chunk appears once', () => {
    const bundle = {
      'static/client.js': chunk(
        'static/client.js',
        ['static/a.js', 'static/b.js'],
        true
      ),
      'static/a.js': chunk('static/a.js', ['static/shared.js']),
      'static/b.js': chunk('static/b.js', ['static/shared.js']),
      'static/shared.js': chunk('static/shared.js', []),
    };
    const out = collectEntryPreloadModules(bundle);
    expect(out.filter((u) => u === '/static/shared.js')).toHaveLength(1);
    expect(out).toEqual(['/static/a.js', '/static/b.js', '/static/shared.js']);
  });

  it('returns an empty list when the entry has no static imports', () => {
    const bundle = {
      'static/client.js': chunk('static/client.js', [], true),
    };
    expect(collectEntryPreloadModules(bundle)).toEqual([]);
  });
});

describe('preloadManifestPlugin', () => {
  const bundle = {
    'static/client.js': chunk('static/client.js', ['static/a.js'], true),
    'static/a.js': chunk('static/a.js', []),
  };

  async function run(envName: string) {
    const plugin = preloadManifestPlugin({ routes: 'src/routes.ts' });
    const emitted: Array<{ type: string; fileName: string; source: string }> =
      [];
    const ctx = {
      environment: { name: envName },
      warn: () => {},
      emitFile: (f: { type: string; fileName: string; source: string }) =>
        emitted.push(f),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin.generateBundle as any).call(ctx, {}, bundle);
    return emitted;
  }

  it('emits the { closure, routes } artifact as a JSON asset during the client build', async () => {
    const emitted = await run('client');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('asset');
    expect(emitted[0].fileName).toBe(PRELOAD_MANIFEST_FILE);
    // No configResolved was run, so routesAbsPath is unset -> empty route map,
    // but the closure is still computed from the bundle.
    expect(JSON.parse(emitted[0].source)).toEqual({
      closure: ['/static/a.js'],
      routes: {},
      routeCss: {},
      globalCss: [],
    });
  });

  it('emits nothing for non-client environments', async () => {
    expect(await run('ssr')).toHaveLength(0);
  });

  it('populates the route map from routes.ts once configResolved sets its path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-preload-'));
    const routesPath = path.join(dir, 'src', 'routes.ts');
    fs.mkdirSync(path.dirname(routesPath), { recursive: true });
    fs.writeFileSync(
      routesPath,
      `export default defineRoutes([
         { path: '/', view: () => import('./pages/home.js') },
       ]);`
    );

    const routeBundle = {
      'static/client.js': {
        type: 'chunk',
        fileName: 'static/client.js',
        isEntry: true,
        imports: [],
        moduleIds: [],
      },
      'static/home-XX.js': {
        type: 'chunk',
        fileName: 'static/home-XX.js',
        isEntry: false,
        imports: [],
        moduleIds: [path.join(dir, 'src', 'pages', 'home.tsx')],
        viteMetadata: { importedCss: new Set(['static/home-XX.css']) },
      },
      'static/home-XX.css': { type: 'asset', fileName: 'static/home-XX.css' },
    };

    const plugin = preloadManifestPlugin({ routes: 'src/routes.ts' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.configResolved as any)({ root: dir });
    const emitted: Array<{ source: string }> = [];
    const ctx = {
      environment: { name: 'client' },
      warn: () => {},
      emitFile: (f: { source: string }) => emitted.push(f),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin.generateBundle as any).call(ctx, {}, routeBundle);

    expect(JSON.parse(emitted[0].source).routes).toEqual({
      '/': ['/static/home-XX.js'],
    });

    expect(JSON.parse(emitted[0].source).routeCss).toEqual({
      '/': ['/static/home-XX.css'],
    });
  });

  it('degrades to empty route maps (with a warning) when map resolution throws, instead of failing the build', async () => {
    // buildRouteMaps (the predecessor of readRouteChains) used to wrap
    // chunkCloser + resolvePreloadMap + resolveRouteCssMap in the same
    // try/catch as extractRouteChains; a later refactor split them apart and
    // left the map-resolution calls unprotected, so a bundle shape the
    // resolvers can't handle would abort the whole client build instead of
    // degrading a preload/CSS-delivery optimization. This pins the restored
    // degrade-and-warn behavior.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-preload-'));
    const routesPath = path.join(dir, 'src', 'routes.ts');
    fs.mkdirSync(path.dirname(routesPath), { recursive: true });
    fs.writeFileSync(
      routesPath,
      `export default defineRoutes([
         { path: '/', view: () => import('./pages/home.js') },
       ]);`
    );

    const malformedBundle = {
      'static/client.js': {
        type: 'chunk',
        fileName: 'static/client.js',
        isEntry: true,
        imports: [],
        moduleIds: [],
      },
      'static/home-XX.js': {
        type: 'chunk',
        fileName: 'static/home-XX.js',
        isEntry: false,
        // Malformed: Rollup output always gives a chunk a real array here;
        // this stands in for a bundle shape the resolver's own
        // defensiveness (`chunk.imports ?? []`) cannot anticipate, since a
        // truthy non-nullish, non-iterable value passes the `??` check and
        // then throws a TypeError at the `for...of`.
        imports: 5,
        moduleIds: [path.join(dir, 'src', 'pages', 'home.tsx')],
      },
    };

    const plugin = preloadManifestPlugin({ routes: 'src/routes.ts' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.configResolved as any)({ root: dir });
    const warnings: string[] = [];
    const emitted: Array<{ source: string }> = [];
    const ctx = {
      environment: { name: 'client' },
      warn: (m: string) => warnings.push(m),
      emitFile: (f: { source: string }) => emitted.push(f),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin.generateBundle as any).call(ctx, {}, malformedBundle);

    const artifact = JSON.parse(emitted[0].source);
    expect(artifact.routes).toEqual({});
    expect(artifact.routeCss).toEqual({});
    expect(
      warnings.some((w) => w.includes('route map generation failed'))
    ).toBe(true);
  });

  it('runs css auto-split end-to-end: replaces the entry css asset and fills globalCss', async () => {
    // No configResolved -> empty chains -> nothing is scopable, so the whole
    // sheet stays global; this still exercises the generateBundle ->
    // applyCssAutoSplit -> artifact wiring (emit residual, delete original).
    const cssBundle: Record<string, unknown> = {
      'static/client.js': {
        type: 'chunk',
        fileName: 'static/client.js',
        isEntry: true,
        code: 'boot("app-shell")',
        imports: [],
        moduleIds: [],
        viteMetadata: { importedCss: new Set(['static/global-orig.css']) },
      },
      'static/home-XX.js': {
        type: 'chunk',
        fileName: 'static/home-XX.js',
        isEntry: false,
        code: 'render("hx-hero")',
        imports: [],
        moduleIds: [],
        viteMetadata: { importedCss: new Set<string>() },
      },
      'static/global-orig.css': {
        type: 'asset',
        fileName: 'static/global-orig.css',
        source: '.hx-hero{color:red}.app-shell{margin:0}',
      },
    };

    const plugin = preloadManifestPlugin({
      routes: 'src/routes.ts',
      css: { autoSplit: true, minSize: 0 },
    });
    const emitted: Array<{
      type: string;
      fileName?: string;
      name?: string;
      source: string;
    }> = [];
    const ctx = {
      environment: { name: 'client' },
      warn: () => {},
      emitFile: (f: {
        type: string;
        fileName?: string;
        name?: string;
        source: string;
      }) => {
        emitted.push(f);
        return `ref-${emitted.length - 1}`;
      },
      getFileName: (ref: string) => {
        const i = Number(ref.replace(/^ref-/, ''));
        return `static/${emitted[i].name!.replace(/\.css$/, '')}-HASH.css`;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin.generateBundle as any).call(ctx, {}, cssBundle);

    const manifest = emitted.find((f) => f.fileName === PRELOAD_MANIFEST_FILE);
    expect(manifest).toBeDefined();
    const artifact = JSON.parse(manifest!.source);
    expect(artifact.globalCss).toEqual(['/static/global-HASH.css']);
    // The original monolith was replaced: gone from the bundle and from the
    // entry chunk's importedCss; its rules live on in the emitted residual.
    expect(cssBundle['static/global-orig.css']).toBeUndefined();
    const residual = emitted.find((f) => f.name === 'global.css');
    expect(residual).toBeDefined();
    expect(residual!.source).toContain('hx-hero');
    expect(residual!.source).toContain('app-shell');
  });

  it('reads the configured Layout file and feeds it as non-scopable css-auto-split evidence', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hp-preload-layout-'));
    fs.writeFileSync(
      path.join(dir, 'Layout.tsx'),
      '<nav class="hp-shell-nav">shell</nav>'
    );

    // Same coincidental-collision shape as the css-auto-split.ts unit tests:
    // 'hp-shell-nav' appears only in one scopable chunk's code, so without
    // the Layout evidence it would be (wrongly) scoped away.
    const cssBundle: Record<string, unknown> = {
      'static/client.js': {
        type: 'chunk',
        fileName: 'static/client.js',
        isEntry: true,
        code: 'boot("nothing-shell-related")',
        imports: [],
        moduleIds: [],
        viteMetadata: { importedCss: new Set(['static/global-orig.css']) },
      },
      'static/home-XX.js': {
        type: 'chunk',
        fileName: 'static/home-XX.js',
        isEntry: false,
        code: 'render("hp-shell-nav")',
        imports: [],
        moduleIds: [],
        viteMetadata: { importedCss: new Set<string>() },
      },
      'static/global-orig.css': {
        type: 'asset',
        fileName: 'static/global-orig.css',
        source: '.hp-shell-nav{display:flex}',
      },
    };

    const plugin = preloadManifestPlugin({
      routes: 'src/routes.ts',
      layout: 'Layout.tsx',
      css: { autoSplit: true, minSize: 0 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.configResolved as any)({ root: dir });
    const emitted: Array<{
      type: string;
      fileName?: string;
      name?: string;
      source: string;
    }> = [];
    const ctx = {
      environment: { name: 'client' },
      warn: () => {},
      emitFile: (f: {
        type: string;
        fileName?: string;
        name?: string;
        source: string;
      }) => {
        emitted.push(f);
        return `ref-${emitted.length - 1}`;
      },
      getFileName: (ref: string) => {
        const i = Number(ref.replace(/^ref-/, ''));
        return `static/${emitted[i].name!.replace(/\.css$/, '')}-HASH.css`;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin.generateBundle as any).call(ctx, {}, cssBundle);

    // The class collides with exactly one scopable chunk, but the Layout
    // evidence disqualifies it from exclusive attribution, so it stays in
    // the residual rather than the per-chunk sheet.
    const residual = emitted.find((f) => f.name === 'global.css');
    expect(residual).toBeDefined();
    expect(residual!.source).toContain('hp-shell-nav');
    const homeScoped = emitted.find((f) => f.name === 'home-XX.scoped.css');
    expect(homeScoped).toBeUndefined();
  });

  it('degrades gracefully (old behavior) when the configured Layout file is unreadable', async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'hp-preload-layout-missing-')
    );
    const cssBundle: Record<string, unknown> = {
      'static/client.js': {
        type: 'chunk',
        fileName: 'static/client.js',
        isEntry: true,
        code: 'boot("app-shell")',
        imports: [],
        moduleIds: [],
        viteMetadata: { importedCss: new Set(['static/global-orig.css']) },
      },
      'static/global-orig.css': {
        type: 'asset',
        fileName: 'static/global-orig.css',
        source: '.app-shell{margin:0}',
      },
    };

    const plugin = preloadManifestPlugin({
      routes: 'src/routes.ts',
      layout: 'Layout.tsx', // does not exist under `dir`
      css: { autoSplit: true, minSize: 0 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.configResolved as any)({ root: dir });
    const emitted: Array<{ name?: string; source: string }> = [];
    const ctx = {
      environment: { name: 'client' },
      warn: () => {},
      emitFile: (f: { name?: string; source: string }) => {
        emitted.push(f);
        return `ref-${emitted.length - 1}`;
      },
      getFileName: (ref: string) => {
        const i = Number(ref.replace(/^ref-/, ''));
        return `static/${emitted[i].name!.replace(/\.css$/, '')}-HASH.css`;
      },
    };
    // Never throws even though the Layout path is unreadable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(
      (plugin.generateBundle as any).call(ctx, {}, cssBundle)
    ).resolves.toBeUndefined();
    const residual = emitted.find((f) => f.name === 'global.css');
    expect(residual?.source).toContain('app-shell');
  });
});
