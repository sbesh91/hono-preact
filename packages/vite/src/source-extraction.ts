import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import {
  parseServerLoaders,
  readCacheKeyParamsOption,
} from './server-loaders-parser.js';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

// TypeScript NodeNext convention: source code imports `.server.js` even though
// the file on disk is `.server.ts` (or .tsx). Try the literal path first
// (handles plain `.js` cases), then the TS-extension swaps.
export function readSourceWithExtensionFallback(
  absServerPath: string
): string | null {
  const tries = [
    absServerPath,
    absServerPath.replace(/\.js$/, '.ts'),
    absServerPath.replace(/\.jsx$/, '.tsx'),
  ];
  for (const p of tries) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Per-loader metadata threaded from a `.server.*` file into its client stub.
 * `cacheKeyParams` is the cache-key dependency list (omitted when default).
 * `routeBound` marks a loader created via `serverRoute().loader` (omitted
 * when false, i.e. a route-independent bare `defineLoader`) so the client
 * `LoaderHost` guard can refuse it when consumed with no resolvable
 * location.
 */
export type ServerLoaderMeta = {
  cacheKeyParams?: string[] | '*';
  routeBound?: true;
};

// Reads a .server.* file synchronously and extracts per-loader metadata from
// each entry in the `serverLoaders` ObjectExpression. Returns a map of
// { loaderName -> ServerLoaderMeta }, with an entry ONLY for loaders that carry
// something non-default (declared cacheKeyParams and/or route-bound), or an
// empty object if the file cannot be parsed or has no serverLoaders. A
// route-independent param-less loader has no entry (both fields default).
export function extractServerLoadersMeta(
  absServerPath: string
): Record<string, ServerLoaderMeta> {
  const src = readSourceWithExtensionFallback(absServerPath);
  if (src == null) return {};

  let ast;
  try {
    ast = parse(src, {
      sourceType: 'module',
      plugins: BABEL_PARSER_PLUGINS,
      errorRecovery: true,
    });
  } catch {
    return {};
  }

  const entries = parseServerLoaders(ast.program);
  const meta: Record<string, ServerLoaderMeta> = {};
  for (const entry of entries) {
    const cacheKeyParams = entry.optsArg
      ? readCacheKeyParamsOption(entry.optsArg)
      : undefined;
    if (cacheKeyParams === undefined && !entry.routeBound) continue;
    const m: ServerLoaderMeta = {};
    if (cacheKeyParams !== undefined) m.cacheKeyParams = cacheKeyParams;
    if (entry.routeBound) m.routeBound = true;
    meta[entry.name] = m;
  }

  return meta;
}
