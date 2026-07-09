// Build-time computation of the client entry's static-import closure: the set
// of chunks the browser will need at boot but can only discover *after*
// downloading and parsing the entry. Emitting `modulepreload` hints for this
// list flattens the first-load request waterfall (see issue #249). Pure over a
// Rollup output bundle so it is unit-testable without a real build.

import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Plugin } from 'vite';
import type { Targets } from 'lightningcss';
import { PRELOAD_MANIFEST_FILE } from '@hono-preact/iso/internal/runtime';
import {
  chunkCloser,
  extractRouteChains,
  resolvePreloadMap,
  resolveRouteCssMap,
  expandGlobFs,
  type RouteModuleChain,
  type RoutePreloadMap,
  type RouteCssMap,
} from './route-preload.js';
import { applyCssAutoSplit } from './css-auto-split.js';

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
  /**
   * The residual global stylesheet URLs the SSR head injects render-blocking
   * before route sheets; `[]` unless the app configured `css.global`.
   */
  globalCss: string[];
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
  /** Present when the app configured `css.global` (framework-owned global CSS). */
  css?: { autoSplit: boolean; minSize: number };
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
  let targets: Targets | undefined;
  return {
    name: 'hono-preact:preload-manifest',
    configResolved(config) {
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
      targets = config.css?.lightningcss?.targets;
    },
    generateBundle(_options, bundle) {
      // Client environment only; fail closed if the environment is unknown so
      // we never emit a wrong-closure artifact into a server/worker build.
      if (this.environment?.name !== 'client') return;
      const warn = (msg: string): void => this.warn(`[preload] ${msg}`);
      const closure = collectEntryPreloadModules(bundle);
      const chains = readRouteChains(routesAbsPath, warn);
      // One memoized closure resolver shared by applyCssAutoSplit,
      // resolvePreloadMap, and resolveRouteCssMap, so each per-chain chunk
      // closure is computed once over the bundle.
      const chunksOf = chunkCloser(bundle);
      let globalCss: string[] = [];
      if (opts.css) {
        try {
          globalCss = applyCssAutoSplit(bundle, chains, chunksOf, {
            autoSplit: opts.css.autoSplit,
            minSize: opts.css.minSize,
            targets,
            emitFile: (a) => this.emitFile(a),
            getFileName: (ref) => this.getFileName(ref),
            warn,
          });
        } catch (e) {
          this.error(
            `[hono-preact] css auto-split failed: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
      const routes = resolvePreloadMap(chains, bundle, chunksOf);
      const routeCss = resolveRouteCssMap(chains, bundle, chunksOf);
      const artifact: PreloadArtifact = {
        closure,
        routes,
        routeCss,
        globalCss,
      };
      this.emitFile({
        type: 'asset',
        fileName: PRELOAD_MANIFEST_FILE,
        source: JSON.stringify(artifact),
      });
    },
  };
}

/**
 * Read `routes.ts` and AST-walk it into per-pattern module chains. Best-effort:
 * if the routes file is unreadable or its shape is exotic, this yields `[]` so
 * preload/route-CSS/css-auto-split degrade to entry-closure-only, never an
 * error.
 */
function readRouteChains(
  routesAbsPath: string,
  warn: (msg: string) => void
): RouteModuleChain[] {
  if (!routesAbsPath) return [];
  let source: string;
  try {
    source = fs.readFileSync(routesAbsPath, 'utf8');
  } catch {
    return [];
  }
  try {
    return extractRouteChains(source, routesAbsPath, expandGlobFs, warn);
  } catch (e) {
    warn(`route map generation failed: ${(e as Error).message}`);
    return [];
  }
}
