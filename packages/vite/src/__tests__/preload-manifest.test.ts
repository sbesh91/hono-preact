import { describe, it, expect } from 'vitest';
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
    const plugin = preloadManifestPlugin();
    const emitted: Array<{ type: string; fileName: string; source: string }> =
      [];
    const ctx = {
      environment: { name: envName },
      emitFile: (f: { type: string; fileName: string; source: string }) =>
        emitted.push(f),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (plugin.generateBundle as any).call(ctx, {}, bundle);
    return emitted;
  }

  it('emits the closure as a JSON asset during the client build', () => {
    const emitted = run('client');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('asset');
    expect(emitted[0].fileName).toBe(PRELOAD_MANIFEST_FILE);
    expect(JSON.parse(emitted[0].source)).toEqual(['/static/a.js']);
  });

  it('emits nothing for non-client environments', () => {
    expect(run('ssr')).toHaveLength(0);
  });
});
