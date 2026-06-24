import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import {
  parseServerLoaders,
  readParamsOption,
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

// Reads a .server.* file synchronously and extracts the `params` option from
// each entry in the `serverLoaders` ObjectExpression. Returns a map of
// { loaderName -> params } for loaders that declare non-default params, or an
// empty object if the file cannot be parsed or has no serverLoaders.
export function extractServerLoadersMeta(
  absServerPath: string
): Record<string, string[] | '*'> {
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
  const meta: Record<string, string[] | '*'> = {};
  for (const entry of entries) {
    if (!entry.optsArg) continue;
    const params = readParamsOption(entry.optsArg);
    if (params !== undefined) meta[entry.name] = params;
  }

  return meta;
}
