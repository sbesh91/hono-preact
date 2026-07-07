// Build-time computation of the client entry's static-import closure: the set
// of chunks the browser will need at boot but can only discover *after*
// downloading and parsing the entry. Emitting `modulepreload` hints for this
// list flattens the first-load request waterfall (see issue #249). Pure over a
// Rollup output bundle so it is unit-testable without a real build.

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Plugin } from 'vite';
import { PRELOAD_MANIFEST_FILE } from '@hono-preact/iso/internal/runtime';
import {
  extractRouteChains,
  resolvePreloadMap,
  resolveRouteCssMap,
  expandGlobFs,
  type RoutePreloadMap,
  type RouteCssMap,
} from './route-preload.js';

/**
 * The client build artifact read at runtime by the adapter's manifest reader.
 * `closure` is the client entry's static-import closure (#250); `routes` maps
 * each route pattern to the chunks its matched layout/view need (#249). Both are
 * `modulepreload` hints emitted into the SSR head; the route map is also matched
 * against the request path at render time.
 */
export interface PreloadArtifact {
  closure: string[];
  routes: RoutePreloadMap;
  routeCss: RouteCssMap;
}

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

export interface PreloadManifestPluginOptions {
  /** Path to the app's `routes.ts` (project-relative or absolute). */
  routes: string;
}

/**
 * Client-build plugin that writes the {@link PreloadArtifact} to
 * {@link PRELOAD_MANIFEST_FILE} in the client output, for the adapter readers to
 * pick up at runtime. Scoped to the `client` environment: the worker/ssr builds
 * ship no browser closure. Runs in `generateBundle` (not `writeBundle`) so the
 * artifact is part of the emitted bundle and moves with the other client assets.
 *
 * The entry closure comes from the bundle alone; the route map additionally
 * AST-walks `routes.ts` (read here from disk) into per-pattern module chains and
 * resolves them against the same bundle. Building the map is best-effort: if the
 * routes file is unreadable or its shape is exotic, the map is empty and preload
 * degrades to entry-closure-only, never an error.
 */
export function preloadManifestPlugin(
  opts: PreloadManifestPluginOptions
): Plugin {
  let routesAbsPath = '';
  return {
    name: 'hono-preact:preload-manifest',
    configResolved(config) {
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
    },
    generateBundle(_options, bundle) {
      // Client environment only; fail closed if the environment is unknown so
      // we never emit a wrong-closure artifact into a server/worker build.
      if (this.environment?.name !== 'client') return;
      const closure = collectEntryPreloadModules(bundle);
      const { routes, routeCss } = buildRouteMaps(
        routesAbsPath,
        bundle,
        (msg) => this.warn(`[preload] ${msg}`)
      );
      const artifact: PreloadArtifact = { closure, routes, routeCss };
      this.emitFile({
        type: 'asset',
        fileName: PRELOAD_MANIFEST_FILE,
        source: JSON.stringify(artifact),
      });
    },
  };
}

/**
 * Read `routes.ts` and resolve its per-pattern module chains to both the JS
 * preload map and the CSS map against the bundle, parsing the routes file once.
 * Any failure yields empty maps, so preload/route-CSS degrade rather than
 * failing the build.
 */
function buildRouteMaps(
  routesAbsPath: string,
  bundle: Parameters<typeof resolvePreloadMap>[1],
  warn: (msg: string) => void
): { routes: RoutePreloadMap; routeCss: RouteCssMap } {
  const empty = { routes: {}, routeCss: {} };
  if (!routesAbsPath) return empty;
  let source: string;
  try {
    source = fs.readFileSync(routesAbsPath, 'utf8');
  } catch {
    return empty;
  }
  try {
    const chains = extractRouteChains(
      source,
      routesAbsPath,
      expandGlobFs,
      warn
    );
    return {
      routes: resolvePreloadMap(chains, bundle),
      routeCss: resolveRouteCssMap(chains, bundle),
    };
  } catch (e) {
    warn(`route map generation failed: ${(e as Error).message}`);
    return empty;
  }
}
