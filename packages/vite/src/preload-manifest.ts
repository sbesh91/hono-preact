// Build-time computation of the client entry's static-import closure: the set
// of chunks the browser will need at boot but can only discover *after*
// downloading and parsing the entry. Emitting `modulepreload` hints for this
// list flattens the first-load request waterfall (see issue #249). Pure over a
// Rollup output bundle so it is unit-testable without a real build.

import type { Plugin } from 'vite';
import { PRELOAD_MANIFEST_FILE } from '@hono-preact/iso/internal/runtime';

/** The subset of a Rollup output-bundle entry this collector reads. */
export interface BundleChunkLike {
  type?: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  imports?: string[];
}

/**
 * Walk the entry chunk's transitive **static** imports breadth-first and return
 * them as root-relative URLs (`/` + fileName), deduped, excluding the entry
 * itself. Breadth-first so the entry's direct dependencies are hinted before
 * their transitive ones, matching the order the browser would otherwise
 * discover them. Dynamic imports are intentionally excluded (they are route- or
 * interaction-lazy, not part of the boot closure).
 */
export function collectEntryPreloadModules(
  bundle: Record<string, BundleChunkLike>
): string[] {
  const entry = Object.values(bundle).find(
    (c) => c.isEntry && c.type !== 'asset'
  );
  if (!entry) return [];

  const seen = new Set<string>([entry.fileName]);
  const out: string[] = [];
  const queue: string[] = [...(entry.imports ?? [])];

  while (queue.length > 0) {
    const fileName = queue.shift()!;
    if (seen.has(fileName)) continue;
    seen.add(fileName);
    out.push('/' + fileName);
    const chunk = bundle[fileName];
    if (chunk?.imports) queue.push(...chunk.imports);
  }

  return out;
}

/**
 * Client-build plugin that writes the entry closure to
 * {@link PRELOAD_MANIFEST_FILE} in the client output, for the adapter readers to
 * pick up at runtime. Scoped to the `client` environment: the worker/ssr builds
 * ship no browser closure. Runs in `generateBundle` (not `writeBundle`) so the
 * artifact is part of the emitted bundle and moves with the other client assets.
 */
export function preloadManifestPlugin(): Plugin {
  return {
    name: 'hono-preact:preload-manifest',
    generateBundle(_options, bundle) {
      // Client environment only; fail closed if the environment is unknown so
      // we never emit a wrong-closure artifact into a server/worker build.
      if (this.environment?.name !== 'client') return;
      const urls = collectEntryPreloadModules(bundle);
      this.emitFile({
        type: 'asset',
        fileName: PRELOAD_MANIFEST_FILE,
        source: JSON.stringify(urls),
      });
    },
  };
}
