import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// #400: the session-channel client store must not be statically reachable from
// the always-loaded client graph. `boot-client.ts` runs on every page, and the
// three RPC paths (`internal/loader-fetch.ts`, `action.ts`, `form.tsx`) are
// loaded by any app that uses loaders or actions at all; a static edge from any
// of them to `internal/channel-store.ts` puts the store, the wire decoder and
// the document hydrate into every app's bundle whether or not it ever declares
// a channel. They reach it through the inert `internal/channel-sink.ts` seam
// instead, and `defineSessionChannel` installs the real implementation.
//
// The byte cost is guarded separately by `scripts/__tests__/core-size-floor.test.mjs`.
// A budget can be raised; this names the edge that must not come back. The walk
// mirrors `packages/server/src/__tests__/create-server-entry-lazy-realtime.test.ts`,
// which guards the same kind of property on the server entry.

const srcDir = path.dirname(
  fileURLToPath(new URL('../action.ts', import.meta.url))
);

/** Entry points every page (or every app using loaders/actions) already loads. */
const ALWAYS_LOADED_ENTRIES = [
  'boot-client.ts',
  'internal/loader-fetch.ts',
  'action.ts',
  'form.tsx',
];

/** Must stay off the always-loaded path, reachable only via a channel declaration. */
const CHANNEL_MODULES = ['channel-store.ts', 'channel-wire.ts'];

/**
 * Relative specifiers of a module's static VALUE imports and re-exports.
 * `import type` edges are erased by tsc, and dynamic `import()` is a lazy edge.
 */
function staticRelativeImports(source: string): string[] {
  const specifiers: string[] = [];
  const withClause =
    /^(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(withClause)) specifiers.push(match[1]!);
  const sideEffect = /^import\s+['"](\.[^'"]+)['"]/gm;
  for (const match of source.matchAll(sideEffect)) specifiers.push(match[1]!);
  return specifiers;
}

function toSourceFile(fromFile: string, specifier: string): string | null {
  const base = path.resolve(
    path.dirname(fromFile),
    specifier.replace(/\.js$/, '')
  );
  for (const ext of ['.ts', '.tsx']) {
    try {
      readFileSync(base + ext);
      return base + ext;
    } catch {
      // try the next extension
    }
  }
  // A specifier that resolves to neither is not a source edge this walk owns
  // (a .css or asset import, say); skipping it is correct and keeps the walk
  // from failing on an unrelated import shape.
  return null;
}

function walkEagerGraph(entries: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const spec of staticRelativeImports(readFileSync(file, 'utf8'))) {
      const resolved = toSourceFile(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return visited;
}

describe('session-channel store laziness (#400)', () => {
  const eager = walkEagerGraph(
    ALWAYS_LOADED_ENTRIES.map((e) => path.join(srcDir, e))
  );
  const eagerNames = new Set([...eager].map((f) => path.basename(f)));

  it.each(CHANNEL_MODULES)(
    '%s is not statically reachable from the always-loaded graph',
    (mod) => {
      expect(eagerNames).not.toContain(mod);
    }
  );

  it('reaches the store only through the inert sink', () => {
    expect(eagerNames).toContain('channel-sink.ts');
  });

  it('sanity: the walker sees the real eager graph', () => {
    // If the extraction regex rots, the graph collapses to the entries alone
    // and every assertion above passes vacuously. Pin modules that are
    // genuinely eager from these entries.
    expect(eagerNames).toContain('history-shim.ts');
    expect(eagerNames).toContain('to-error.ts');
    expect(eagerNames).toContain('contract.ts');
  });

  it('declaring a channel is what pulls the store in', () => {
    const declared = walkEagerGraph([path.join(srcDir, 'session-channel.ts')]);
    const declaredNames = new Set([...declared].map((f) => path.basename(f)));
    expect(declaredNames).toContain('channel-store.ts');
    expect(declaredNames).toContain('channel-wire.ts');
  });
});
