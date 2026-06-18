import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Plugin } from 'vite';
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
 * Build-time route-preload map generation (prototype).
 *
 * Approach 1 from the network-dependency-tree investigation: at build time,
 * map each route pattern to the client chunks its matched layout/view modules
 * need, so the SSR layer can emit `<link rel="modulepreload">` hints and the
 * browser fetches the route chunk in parallel with the client entry instead of
 * three hops down the module graph.
 *
 * This file owns the two pure transforms (route-tree -> module chains, and
 * chains + manifest -> preload href map) plus the vite plugin that runs them
 * against the real `routes.ts` and client manifest.
 */

/** A leaf route and the source modules it pulls in (outer layout -> leaf view). */
export type RouteModuleChain = {
  pattern: string;
  /** Absolute source paths (as written, extension intact), outermost first. */
  sources: string[];
};

/** Vite client manifest, narrowed to the fields we read. */
export type ClientManifest = Record<
  string,
  {
    file: string;
    src?: string;
    isEntry?: boolean;
    isDynamicEntry?: boolean;
    imports?: string[];
  }
>;

/**
 * Per-pattern preload hrefs split by fetch priority:
 * - `high`: layout-chain chunks. They gate the hydration shell, so they keep
 *   modulepreload's default (High) priority.
 * - `low`: the leaf view/content chunk(s). The page content is already in the
 *   SSR HTML, so these are emitted with `fetchpriority="low"` to avoid
 *   contending with render-critical resources (CSS, fonts, the client entry)
 *   for bandwidth during first paint.
 */
export type RoutePreloadMap = Record<string, { high: string[]; low: string[] }>;

// ---------------------------------------------------------------------------
// Route-path joining + content-route slug rules. Kept byte-compatible with
// `joinRoutePath` (define-routes) and `commonDirPrefix`/`defaultSlug`
// (content-routes) so build-time patterns match the runtime registrations.
// ---------------------------------------------------------------------------

function joinRoutePath(parentPath: string, childPath: string): string {
  if (parentPath === '') return childPath;
  return childPath === '' ? parentPath : parentPath + '/' + childPath;
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
          chains.push({
            pattern,
            sources: [...layoutStack, toAbs(key)],
          });
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
// Manifest resolution
// ---------------------------------------------------------------------------

function stripExt(p: string): string {
  return p.replace(/\.[^./]+$/, '');
}

/** Index manifest entries by absolute source path without extension. */
function indexBySource(
  manifest: ClientManifest,
  rootDir: string
): Map<string, string> {
  // key (abs-source-no-ext) -> manifest key
  const index = new Map<string, string>();
  for (const [key, entry] of Object.entries(manifest)) {
    const src = entry.src ?? (key.startsWith('_') ? undefined : key);
    if (!src) continue;
    index.set(stripExt(path.resolve(rootDir, src)), key);
  }
  return index;
}

/** Collect a manifest entry's chunk file plus its transitive static imports. */
function collectStaticChunks(
  manifestKey: string,
  manifest: ClientManifest,
  out: Set<string>,
  seen: Set<string>
): void {
  if (seen.has(manifestKey)) return;
  seen.add(manifestKey);
  const entry = manifest[manifestKey];
  if (!entry) return;
  out.add(entry.file);
  for (const imp of entry.imports ?? []) {
    collectStaticChunks(imp, manifest, out, seen);
  }
}

/** The chunk-file closure of the client entry (already fetched eagerly). */
function entryClosure(manifest: ClientManifest): Set<string> {
  const out = new Set<string>();
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.isEntry) collectStaticChunks(key, manifest, out, new Set());
  }
  return out;
}

/**
 * Resolve route module chains to a pattern -> { high, low } preload map against
 * the client manifest.
 *
 * Each chain is `[...layouts, view]` (outer layout first, leaf view last). The
 * layout chunks (and their static imports) go in `high`; the view chunk's
 * own chunks go in `low`. Both sets subtract the client entry's closure (those
 * chunks load eagerly via the entry script anyway), and `low` also subtracts
 * `high` so a chunk shared by layout and view is preloaded once, at the higher
 * priority. Hrefs are prefixed with the build base.
 */
export function resolvePreloadMap(
  chains: readonly RouteModuleChain[],
  manifest: ClientManifest,
  opts: { rootDir: string; base?: string }
): RoutePreloadMap {
  const base = opts.base ?? '/';
  const bySource = indexBySource(manifest, opts.rootDir);
  const eager = entryClosure(manifest);
  const href = (file: string): string =>
    (base.endsWith('/') ? base : base + '/') + file;

  const chunksOf = (sources: readonly string[]): Set<string> => {
    const files = new Set<string>();
    for (const src of sources) {
      const manifestKey = bySource.get(stripExt(src));
      if (manifestKey)
        collectStaticChunks(manifestKey, manifest, files, new Set());
    }
    return files;
  };

  const map: RoutePreloadMap = {};
  for (const chain of chains) {
    const layoutSources = chain.sources.slice(0, -1);
    const viewSource = chain.sources[chain.sources.length - 1];
    const highFiles = chunksOf(layoutSources);
    const viewFiles = viewSource ? chunksOf([viewSource]) : new Set<string>();

    const high: string[] = [];
    for (const file of highFiles) {
      if (!eager.has(file)) high.push(href(file));
    }
    const low: string[] = [];
    for (const file of viewFiles) {
      if (!eager.has(file) && !highFiles.has(file)) low.push(href(file));
    }
    if (high.length > 0 || low.length > 0) {
      map[chain.pattern] = { high, low };
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Glob expansion (fs-backed). Supports `<dir>/**/*.<ext>` and `<dir>/*.<ext>`.
// ---------------------------------------------------------------------------

function expandGlobFs(globPattern: string, fromDir: string): string[] {
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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/** Token the generated core-app uses as a placeholder for the inlined map. */
export const ROUTE_PRELOAD_PLACEHOLDER = 'globalThis.__HP_ROUTE_PRELOAD__';

export interface RoutePreloadPluginOptions {
  routes: string; // project-relative or absolute path to routes.ts
}

/**
 * Generate the route-preload map after the client build and inline it into the
 * already-emitted worker bundle.
 *
 * Threading note (prototype): the worker environment builds BEFORE the client
 * environment, so the client manifest does not exist when the worker is
 * bundled. Rather than reorder the build, this plugin waits for the client
 * `closeBundle` (which runs last, with the manifest written), computes the map,
 * and string-replaces the `globalThis.__HP_ROUTE_PRELOAD__` placeholder the
 * generated core-app left in the unminified worker bundle. A cleaner long-term
 * threading (assets-binding read, or a manifest-injection pass) is noted in the
 * PR.
 */
export function routePreloadPlugin(opts: RoutePreloadPluginOptions): Plugin {
  let root = process.cwd();
  let routesAbsPath = '';
  let base = '/';

  return {
    name: 'hono-preact:route-preload',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      base = config.base || '/';
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
    },
    closeBundle() {
      // Only act after the client build, whose manifest we read.
      const envName = (this as { environment?: { name?: string } }).environment
        ?.name;
      if (envName !== 'client') return;

      const manifestPath = path.resolve(
        root,
        'dist/client/.vite/manifest.json'
      );
      const workerEntry = path.resolve(root, 'dist/hono_preact/index.js');
      if (!fs.existsSync(manifestPath) || !fs.existsSync(workerEntry)) return;

      let manifest: ClientManifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        this.warn('route-preload: client manifest unreadable; skipping');
        return;
      }

      const source = fs.readFileSync(routesAbsPath, 'utf8');
      const chains = extractRouteChains(
        source,
        routesAbsPath,
        expandGlobFs,
        (m) => this.warn(`route-preload: ${m}`)
      );
      const map = resolvePreloadMap(chains, manifest, { rootDir: root, base });

      const worker = fs.readFileSync(workerEntry, 'utf8');
      if (!worker.includes(ROUTE_PRELOAD_PLACEHOLDER)) {
        this.warn(
          'route-preload: placeholder not found in worker bundle; ' +
            'preload hints will be inactive'
        );
        return;
      }
      const patched = worker.replace(
        ROUTE_PRELOAD_PLACEHOLDER,
        JSON.stringify(map)
      );
      fs.writeFileSync(workerEntry, patched, 'utf8');
      this.info(
        `route-preload: inlined preload map for ${Object.keys(map).length} route patterns`
      );
    },
  };
}
