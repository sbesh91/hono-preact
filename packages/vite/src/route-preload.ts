// Build-time route-preload map: map each route pattern to the client chunks its
// matched layout/view modules need, so the SSR layer can emit
// `<link rel="modulepreload">` hints and the browser fetches a route's chunk in
// parallel with the client entry instead of several hops down the module graph
// (issue #249; the sibling of the entry-closure preload in preload-manifest.ts).
//
// Two pure transforms plus an fs-backed glob expander:
//   1. `extractRouteChains` AST-walks `routes.ts` into one source-module chain
//      per leaf pattern (layout ancestors accumulated).
//   2. `resolvePreloadMap` resolves each chain to its client chunks against the
//      Rollup output bundle, minus the client entry's own closure (already
//      fetched eagerly via the entry script).
// Both are pure over their inputs so they unit-test without a real build; the
// plugin that runs them against the real bundle lives in preload-manifest.ts.

import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import { isExpression } from '@babel/types';
import type {
  ArrayExpression,
  Expression,
  Node,
  ObjectExpression,
} from '@babel/types';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

/**
 * Build-generated map from route pattern to the client chunk URLs that route
 * needs, in discovery order (outer layout chunks first, leaf view last).
 * Serialized into the client build artifact; the server's `route-preload-tags`
 * declares the structurally identical consumer type. Kept in sync by the
 * artifact round-trip (a JSON contract between this package's build output and
 * the server runtime), not a shared import (the packages don't share runtime).
 *
 * A flat list (not a priority split): like the entry closure, every route chunk
 * is hydration-only and yields to render-critical CSS/fonts, so the server hints
 * them all at `fetchpriority="low"`. Order is preserved only so the head tags
 * read outer-to-inner.
 */
export type RoutePreloadMap = Record<string, string[]>;

/** A leaf route and the source modules it pulls in (outer layout -> leaf view). */
export interface RouteModuleChain {
  pattern: string;
  /** Absolute source paths (as written, extension intact), outermost first. */
  sources: string[];
}

/** The subset of a Rollup output-bundle chunk `resolvePreloadMap` reads. */
export interface RouteBundleChunkLike {
  type?: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  /** Absolute source module ids that landed in this chunk. */
  moduleIds?: string[];
  /** File names of the chunks this one statically imports. */
  imports?: string[];
  /** Vite's per-chunk CSS metadata: the CSS asset file names this chunk pulls in. */
  viteMetadata?: { importedCss?: Set<string> };
}

// ---------------------------------------------------------------------------
// Route-path joining + content-route slug rules. These are byte-for-byte copies
// of the runtime's private helpers: `joinRoutePath` (iso `define-routes.tsx`)
// and `commonDirPrefix`/`defaultSlug` (iso `content-routes.tsx`). They must stay
// in sync so build-time patterns match the runtime registrations; if the runtime
// rule changes, a divergent copy silently emits wrong/no preload hints for the
// affected routes (an optimization degrades, not a correctness bug).
// TODO(#249): extract the three into a preact-free iso leaf and import here, so
// there is one source of truth instead of a comment-synced copy.
// ---------------------------------------------------------------------------

function joinRoutePath(parentPath: string, childPath: string): string {
  if (parentPath === '') return childPath;
  if (childPath === '') return parentPath;
  if (parentPath === '/') {
    return childPath.startsWith('/') ? childPath : '/' + childPath;
  }
  return parentPath + '/' + childPath;
}

function commonDirPrefix(keys: readonly string[]): string {
  if (keys.length === 0) return '';
  let prefix = keys[0];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i];
    let j = 0;
    while (j < prefix.length && j < k.length && prefix[j] === k[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix === '') break;
  }
  const lastSlash = prefix.lastIndexOf('/');
  return lastSlash === -1 ? '' : prefix.slice(0, lastSlash + 1);
}

function defaultSlug(key: string, base: string): string {
  let s = key.startsWith(base) ? key.slice(base.length) : key;
  s = s.replace(/\.[^./]+$/, '');
  s = s.replace(/(^|\/)index$/, '');
  return s;
}

// ---------------------------------------------------------------------------
// AST extraction
// ---------------------------------------------------------------------------

/** Glob expander: returns module keys (with leading `./`) relative to fromDir. */
export type GlobExpander = (globPattern: string, fromDir: string) => string[];

function isObjectExpression(n: Node | null | undefined): n is ObjectExpression {
  return !!n && n.type === 'ObjectExpression';
}

function getProperty(
  obj: ObjectExpression,
  name: string
): Expression | undefined {
  for (const p of obj.properties) {
    if (
      p.type === 'ObjectProperty' &&
      !p.computed &&
      ((p.key.type === 'Identifier' && p.key.name === name) ||
        (p.key.type === 'StringLiteral' && p.key.value === name)) &&
      // ObjectProperty.value unions Expression | PatternLike (the latter only
      // in destructuring patterns). In a route object literal it is always an
      // Expression; narrow with the predicate rather than casting.
      isExpression(p.value)
    ) {
      return p.value;
    }
  }
  return undefined;
}

function stringLiteralValue(n: Node | null | undefined): string | undefined {
  return n && n.type === 'StringLiteral' ? n.value : undefined;
}

/** Extract the specifier from a `() => import('spec')` thunk. */
function importThunkSpecifier(n: Node | null | undefined): string | undefined {
  if (!n || n.type !== 'ArrowFunctionExpression') return undefined;
  const body = n.body;
  if (
    body.type === 'ImportExpression' &&
    body.source.type === 'StringLiteral'
  ) {
    return body.source.value;
  }
  return undefined;
}

/** Match `import.meta.glob('lit')` and return the literal pattern. */
function importMetaGlobPattern(n: Node): string | undefined {
  if (n.type !== 'CallExpression') return undefined;
  const callee = n.callee;
  if (
    callee.type !== 'MemberExpression' ||
    callee.property.type !== 'Identifier' ||
    callee.property.name !== 'glob' ||
    callee.object.type !== 'MetaProperty'
  ) {
    return undefined;
  }
  return stringLiteralValue(n.arguments[0]);
}

/** Match `contentRoutes(import.meta.glob('lit'), { base?: 'lit' })`. */
function contentRoutesCall(
  n: Node
): { globPattern: string; base?: string; hasCustomSlug: boolean } | undefined {
  if (n.type !== 'CallExpression') return undefined;
  if (n.callee.type !== 'Identifier' || n.callee.name !== 'contentRoutes') {
    return undefined;
  }
  const first = n.arguments[0];
  if (!first) return undefined;
  const globPattern = importMetaGlobPattern(first);
  if (globPattern == null) return undefined;
  let base: string | undefined;
  let hasCustomSlug = false;
  const opts = n.arguments[1];
  if (opts && opts.type === 'ObjectExpression') {
    base = stringLiteralValue(getProperty(opts, 'base'));
    hasCustomSlug = getProperty(opts, 'slug') !== undefined;
  }
  return { globPattern, base, hasCustomSlug };
}

/** Resolve the `defineRoutes(ARG)` argument to its array literal. */
function findRouteArray(ast: ReturnType<typeof parse>): ArrayExpression | null {
  let argExpr: Expression | null = null;
  const body = ast.program.body;
  for (const stmt of body) {
    const decl =
      stmt.type === 'ExportDefaultDeclaration' ? stmt.declaration : undefined;
    const call =
      decl && decl.type === 'CallExpression'
        ? decl
        : stmt.type === 'ExpressionStatement' &&
            stmt.expression.type === 'CallExpression'
          ? stmt.expression
          : undefined;
    if (
      call &&
      call.callee.type === 'Identifier' &&
      call.callee.name === 'defineRoutes'
    ) {
      // arguments[0] unions Expression | SpreadElement | ArgumentPlaceholder;
      // narrow with the predicate rather than casting.
      const arg = call.arguments[0];
      if (arg && isExpression(arg)) argExpr = arg;
      break;
    }
  }
  if (!argExpr) return null;

  const unwrap = (e: Expression): Expression =>
    e.type === 'TSAsExpression' || e.type === 'TSSatisfiesExpression'
      ? unwrap(e.expression)
      : e;
  argExpr = unwrap(argExpr);

  if (argExpr.type === 'ArrayExpression') return argExpr;

  // Identifier reference: resolve `const X = [...] as const`.
  if (argExpr.type === 'Identifier') {
    const name = argExpr.name;
    for (const stmt of body) {
      if (stmt.type !== 'VariableDeclaration') continue;
      for (const d of stmt.declarations) {
        if (d.id.type === 'Identifier' && d.id.name === name && d.init) {
          const init = unwrap(d.init);
          if (init.type === 'ArrayExpression') return init;
        }
      }
    }
  }
  return null;
}

/**
 * Walk the route-tree AST into one chain per leaf (view) route. Layout
 * ancestors accumulate as the walk descends, so each leaf carries its full
 * outer-to-inner module list. `contentRoutes(import.meta.glob(...))` spreads
 * are expanded via the injected `expandGlob`.
 *
 * Unsupported shapes (non-literal `view`, custom `slug`, exotic globs) are
 * reported through `warn` and skipped, so those routes fall back to today's
 * no-preload behavior rather than silently emitting wrong hints.
 */
export function extractRouteChains(
  source: string,
  routesAbsPath: string,
  expandGlob: GlobExpander,
  warn: (msg: string) => void = () => {}
): RouteModuleChain[] {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: BABEL_PARSER_PLUGINS,
    errorRecovery: true,
  });
  const arr = findRouteArray(ast);
  if (!arr) {
    warn('could not locate the defineRoutes([...]) route array; skipping');
    return [];
  }

  const routesDir = path.dirname(routesAbsPath);
  const toAbs = (spec: string): string => path.resolve(routesDir, spec);
  const chains: RouteModuleChain[] = [];

  const walkElements = (
    elements: ArrayExpression['elements'],
    parentPattern: string,
    layoutStack: string[]
  ): void => {
    for (const el of elements) {
      if (!el) continue;

      if (el.type === 'SpreadElement') {
        const content = contentRoutesCall(el.argument);
        if (!content) {
          warn(
            `unsupported spread in route children at ${parentPattern || '/'}; skipping`
          );
          continue;
        }
        if (content.hasCustomSlug) {
          warn(
            `contentRoutes at ${parentPattern || '/'} uses a custom slug() — ` +
              `cannot replicate it at build time; skipping its preload hints`
          );
          continue;
        }
        const keys = expandGlob(content.globPattern, routesDir);
        const base = content.base ?? commonDirPrefix(keys);
        for (const key of keys) {
          const slug = defaultSlug(key, base);
          const pattern = joinRoutePath(parentPattern, slug);
          chains.push({ pattern, sources: [...layoutStack, toAbs(key)] });
        }
        continue;
      }

      if (!isObjectExpression(el)) continue;
      const routePath = stringLiteralValue(getProperty(el, 'path'));
      if (routePath == null) {
        warn('route node without a string `path`; skipping');
        continue;
      }
      const here = joinRoutePath(parentPattern, routePath);
      const viewSpec = importThunkSpecifier(getProperty(el, 'view'));
      const layoutSpec = importThunkSpecifier(getProperty(el, 'layout'));
      const childrenExpr = getProperty(el, 'children');
      const children =
        childrenExpr && childrenExpr.type === 'ArrayExpression'
          ? childrenExpr.elements
          : undefined;

      if (viewSpec) {
        // `view` + `children` is rejected by defineRoutes at runtime; if it ever
        // reaches here, warn rather than silently dropping the child subtree's
        // hints (this branch treats the node as a leaf and ignores `children`).
        if (children) {
          warn(
            `route ${here}: node has both \`view\` and \`children\`; preloading only the view chunk`
          );
        }
        chains.push({
          pattern: here,
          sources: [...layoutStack, toAbs(viewSpec)],
        });
      } else if (layoutSpec && children) {
        walkElements(children, here, [...layoutStack, toAbs(layoutSpec)]);
      } else if (children) {
        // Bare grouping: prefix children, no layout module of its own.
        walkElements(children, here, layoutStack);
      } else if (getProperty(el, 'view') && !viewSpec) {
        warn(
          `route ${here}: \`view\` is not a literal import() thunk; skipping`
        );
      }
    }
  };

  walkElements(arr.elements, '', []);
  return chains;
}

// ---------------------------------------------------------------------------
// Bundle resolution
// ---------------------------------------------------------------------------

function stripExt(p: string): string {
  return p.replace(/\.[^./]+$/, '');
}

// Root-relative href for a build output file name, shared by resolvePreloadMap
// (JS chunks) and resolveRouteCssMap (CSS assets). Ignores a configured Vite
// `base` (hardcoded '/' + fileName); for the JS preload hints a wrong href is
// only a lost optimization (the browser falls back to normal discovery), but
// for route CSS a wrong href is a broken first paint (the stylesheet 404s), so
// this must be base-prefixed first if base support is ever added.
function toRootRelative(file: string): string {
  return '/' + file;
}

/** Index every chunk by each of its source module ids (extension-stripped). */
function indexBySource(
  bundle: Record<string, RouteBundleChunkLike>
): Map<string, string> {
  const index = new Map<string, string>();
  for (const chunk of Object.values(bundle)) {
    if (chunk.type === 'asset') continue;
    for (const id of chunk.moduleIds ?? []) {
      index.set(stripExt(id), chunk.fileName);
    }
  }
  return index;
}

/** Collect a chunk's file plus its transitive static imports. */
function collectStaticChunks(
  fileName: string,
  bundle: Record<string, RouteBundleChunkLike>,
  out: Set<string>,
  seen: Set<string>
): void {
  if (seen.has(fileName)) return;
  seen.add(fileName);
  const chunk = bundle[fileName];
  if (!chunk || chunk.type === 'asset') return;
  out.add(fileName);
  for (const imp of chunk.imports ?? []) {
    collectStaticChunks(imp, bundle, out, seen);
  }
}

/** The chunk-file closure of the client entry (already fetched eagerly). */
function entryClosure(
  bundle: Record<string, RouteBundleChunkLike>
): Set<string> {
  const out = new Set<string>();
  for (const chunk of Object.values(bundle)) {
    if (chunk.isEntry && chunk.type !== 'asset') {
      collectStaticChunks(chunk.fileName, bundle, out, new Set());
    }
  }
  return out;
}

// Merge a route's resolved URLs into the pattern->urls map: key the top-level
// index route ('') under '/', and union (not overwrite) when two chains resolve
// to the same pattern, so a shared pattern keeps all its URLs. Shared by
// resolvePreloadMap (JS) and resolveRouteCssMap (CSS).
function mergeRouteUrls(
  map: Record<string, string[]>,
  rawPattern: string,
  urls: string[]
): void {
  if (urls.length === 0) return;
  const pattern = rawPattern === '' ? '/' : rawPattern;
  const prior = map[pattern];
  map[pattern] = prior
    ? [...prior, ...urls.filter((u) => !prior.includes(u))]
    : urls;
}

/**
 * A memoized source -> static-chunk-closure resolver over one bundle. Both
 * route maps (JS preload and CSS) walk the same chains against the same
 * bundle, so the caller building both should create one of these and pass it
 * to each resolver rather than letting each recompute every closure.
 * The returned Sets are shared by the memo: treat them as read-only.
 */
export function chunkCloser(
  bundle: Record<string, RouteBundleChunkLike>
): (src: string) => ReadonlySet<string> {
  const bySource = indexBySource(bundle);
  const memo = new Map<string, Set<string>>();
  return (src) => {
    const hit = memo.get(src);
    if (hit) return hit;
    const files = new Set<string>();
    const fileName = bySource.get(stripExt(src));
    if (fileName) collectStaticChunks(fileName, bundle, files, new Set());
    memo.set(src, files);
    return files;
  };
}

/**
 * Resolve route module chains to a pattern -> { high, low } preload map against
 * the Rollup output bundle.
 *
 * Each chain is `[...layouts, view]` (outer layout first, leaf view last). The
 * layout chunks (and their static imports) go in `high`; the view chunk's own
 * chunks go in `low`. Both subtract the client entry's closure (those chunks
 * load eagerly via the entry script anyway), and `low` also subtracts `high` so
 * a chunk shared by layout and view is preloaded once, at the higher priority.
 * Hrefs are root-relative (`/` + fileName), matching the entry-closure hints.
 */
export function resolvePreloadMap(
  chains: readonly RouteModuleChain[],
  bundle: Record<string, RouteBundleChunkLike>,
  chunksOf: (src: string) => ReadonlySet<string> = chunkCloser(bundle)
): RoutePreloadMap {
  const eager = entryClosure(bundle);

  const map: RoutePreloadMap = {};
  for (const chain of chains) {
    // Walk sources outer-to-inner (layout ancestors first, leaf view last) so
    // the resulting list reads in discovery order. A Set dedupes a chunk shared
    // across the chain; the entry closure is subtracted (fetched eagerly).
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const src of chain.sources) {
      for (const file of chunksOf(src)) {
        if (eager.has(file) || seen.has(file)) continue;
        seen.add(file);
        urls.push(toRootRelative(file));
      }
    }
    mergeRouteUrls(map, chain.pattern, urls);
  }
  return map;
}

/**
 * Build-generated map from route pattern to the CSS asset URLs that route needs,
 * the render-critical sibling of {@link RoutePreloadMap}. Serialized into the
 * client build artifact; the server injects the matched route's sheets as
 * `<link rel="stylesheet">` into the SSR head.
 */
export type RouteCssMap = Record<string, string[]>;

/** The distinct CSS asset file names a set of chunks import, in first-seen order. */
function cssOfChunks(
  files: Iterable<string>,
  bundle: Record<string, RouteBundleChunkLike>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const importedCss = bundle[file]?.viteMetadata?.importedCss;
    if (!importedCss) continue;
    for (const css of importedCss) {
      if (seen.has(css)) continue;
      seen.add(css);
      out.push(css);
    }
  }
  return out;
}

/**
 * Resolve route module chains to a pattern -> CSS-URL map against the Rollup
 * output bundle. For each chain, collect the CSS imported by the chain's static
 * chunk closure (layouts + view). Mirrors `resolvePreloadMap`'s dedup,
 * empty-path -> '/' keying, and pattern-collision union, so the two maps stay
 * consistent.
 *
 * A route's CSS list is every stylesheet its own chunks import, full stop:
 * nothing SSR-injects the client entry's CSS (only the entry's JS closure is
 * modulepreload-hinted; there is no CSS analog), so a stylesheet cannot be
 * assumed already on the page just because the entry also imports it. A
 * stylesheet meant to load on every route should be linked by the app's
 * Layout (the `?url` pattern) or imported per-route, not relied upon via the
 * entry closure.
 */
export function resolveRouteCssMap(
  chains: readonly RouteModuleChain[],
  bundle: Record<string, RouteBundleChunkLike>,
  chunksOf: (src: string) => ReadonlySet<string> = chunkCloser(bundle)
): RouteCssMap {
  const map: RouteCssMap = {};
  for (const chain of chains) {
    const files = new Set<string>();
    for (const src of chain.sources) {
      for (const file of chunksOf(src)) files.add(file);
    }
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const css of cssOfChunks(files, bundle)) {
      if (seen.has(css)) continue;
      seen.add(css);
      urls.push(toRootRelative(css));
    }
    mergeRouteUrls(map, chain.pattern, urls);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Glob expansion (fs-backed). Supports `<dir>/**/*.<ext>` and `<dir>/*.<ext>`.
// ---------------------------------------------------------------------------

export function expandGlobFs(globPattern: string, fromDir: string): string[] {
  const m = globPattern.match(/^(.*?)(\*\*\/)?\*(\.[^./*]+)$/);
  if (!m) return [];
  const literalPrefix = m[1].replace(/^\.\//, '');
  const recursive = !!m[2];
  const ext = m[3];
  const baseDir = path.resolve(fromDir, literalPrefix);
  const keys: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive) walk(full);
      } else if (e.isFile() && e.name.endsWith(ext)) {
        const rel = path.relative(fromDir, full).split(path.sep).join('/');
        keys.push('./' + rel);
      }
    }
  };
  walk(baseDir);
  return keys;
}
