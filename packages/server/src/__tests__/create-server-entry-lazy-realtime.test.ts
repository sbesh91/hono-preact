import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// #381: createServerEntry runs in EVERY deployment, so its static import graph
// must not reach the realtime registry machinery (sockets-handler,
// rooms-handler, and their transitive engine modules). Those modules load via
// dynamic import() at the already-lazy call sites (the registry thunks and the
// /__sockets handler), so a bundler emits them as a separate lazy chunk and an
// app that defines no rooms or sockets never evaluates them. This test walks
// the STATIC (value) import edges from create-server-entry.ts and fails if a
// realtime module becomes eagerly reachable again.

const srcDir = path.dirname(
  fileURLToPath(new URL('../create-server-entry.ts', import.meta.url))
);

/** The realtime module graph that must stay off the eager path. */
const REALTIME_MODULES = [
  'sockets-handler.ts',
  'rooms-handler.ts',
  'socket-resolution.ts',
  'server-socket-handle.ts',
  'room-engine.ts',
];

/**
 * Extract the relative specifiers of a module's static VALUE imports and
 * re-exports. `import type` / `export type` edges are erased by tsc and
 * dynamic import() calls are the lazy edges under test, so both are excluded.
 */
function staticRelativeImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern =
    /^(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1]);
  }
  // Side-effect imports (`import './x.js'`) are value edges too.
  const sideEffect = /^import\s+['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(sideEffect)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/** Resolve a `./x.js` specifier from srcDir to its `.ts`/`.tsx` source file. */
function toSourceFile(specifier: string): string {
  const base = path.resolve(srcDir, specifier.replace(/\.js$/, ''));
  for (const ext of ['.ts', '.tsx']) {
    try {
      readFileSync(base + ext);
      return base + ext;
    } catch {
      // try the next extension
    }
  }
  throw new Error(`cannot resolve source for specifier ${specifier}`);
}

function walkEagerGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const spec of staticRelativeImports(source)) {
      queue.push(toSourceFile(spec));
    }
  }
  return visited;
}

describe('createServerEntry realtime laziness (#381)', () => {
  const eager = walkEagerGraph(path.join(srcDir, 'create-server-entry.ts'));
  const eagerNames = new Set([...eager].map((f) => path.basename(f)));

  it.each(REALTIME_MODULES)(
    '%s is not statically reachable from create-server-entry',
    (mod) => {
      expect(eagerNames).not.toContain(mod);
    }
  );

  it('sanity: the walker sees the real eager graph', () => {
    // If the extraction regex ever rots, the graph would collapse to nearly
    // empty and the assertions above would pass vacuously. Pin two modules
    // that are genuinely eager.
    expect(eagerNames).toContain('loaders-handler.ts');
    expect(eagerNames).toContain('render.tsx');
  });

  it('the realtime modules load via dynamic import at the lazy call sites', () => {
    const source = readFileSync(
      path.join(srcDir, 'create-server-entry.ts'),
      'utf8'
    );
    expect(source).toMatch(/import\(['"]\.\/sockets-handler\.js['"]\)/);
    expect(source).toMatch(/import\(['"]\.\/rooms-handler\.js['"]\)/);
  });
});
