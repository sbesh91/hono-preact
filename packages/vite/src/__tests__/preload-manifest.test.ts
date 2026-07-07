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

  function run(envName: string) {
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
    (plugin.generateBundle as any).call(ctx, {}, bundle);
    return emitted;
  }

  it('emits the { closure, routes } artifact as a JSON asset during the client build', () => {
    const emitted = run('client');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('asset');
    expect(emitted[0].fileName).toBe(PRELOAD_MANIFEST_FILE);
    // No configResolved was run, so routesAbsPath is unset -> empty route map,
    // but the closure is still computed from the bundle.
    expect(JSON.parse(emitted[0].source)).toEqual({
      closure: ['/static/a.js'],
      routes: {},
      routeCss: {},
    });
  });

  it('emits nothing for non-client environments', () => {
    expect(run('ssr')).toHaveLength(0);
  });

  it('populates the route map from routes.ts once configResolved sets its path', () => {
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
    (plugin.generateBundle as any).call(ctx, {}, routeBundle);

    expect(JSON.parse(emitted[0].source).routes).toEqual({
      '/': ['/static/home-XX.js'],
    });

    expect(JSON.parse(emitted[0].source).routeCss).toEqual({
      '/': ['/static/home-XX.css'],
    });
  });
});
