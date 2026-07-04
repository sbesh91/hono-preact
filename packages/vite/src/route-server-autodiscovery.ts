import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import type { ObjectExpression, ObjectProperty } from '@babel/types';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

// Server-module extensions probed on disk, in precedence order. Source authors
// import the `.js` specifier (TS NodeNext convention) even though the file is
// `.ts`/`.tsx`, so we probe the TS extensions first and the literal JS ones as
// a fallback for already-compiled trees.
const SERVER_EXTENSIONS = [
  '.server.ts',
  '.server.tsx',
  '.server.js',
  '.server.jsx',
] as const;

// Matches the trailing module extension of a `view`/`layout` import specifier
// so we can splice `.server` in front of it (`./x.js` -> `./x.server.js`).
const MODULE_EXT = /\.(jsx?|tsx?)$/;

// Matches any `*.server.[jt]sx?` filename, for the orphan scan.
const SERVER_FILE = /\.server\.[jt]sx?$/;

// Directories the orphan scan never descends into. These are always skipped
// (for walk speed and as a safe fallback when git is unavailable); the
// gitignore filter below additionally drops anything the user ignores.
const ORPHAN_SCAN_SKIP = new Set([
  'node_modules',
  'dist',
  '.git',
  '.wrangler',
  '__tests__',
]);

// Of `files` (paths relative to `root`), returns the subset the project's git
// ignore rules exclude, using `git check-ignore` as the authoritative engine
// (handles nested .gitignore, negations, and custom build dirs). Degrades to an
// empty set when git is absent, the tree is not a repo, or nothing is ignored
// (`check-ignore` exits non-zero in all three), so the orphan scan simply skips
// the extra filtering rather than failing the build.
function gitIgnored(root: string, files: string[]): Set<string> {
  if (files.length === 0) return new Set();
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: root,
      input: files.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return new Set(
      out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

// Recursively list absolute paths of every `*.server.*` module under `root`,
// skipping build output, deps, test fixtures, and anything gitignored. The
// default source for the orphan check; injectable so tests need no real
// filesystem.
function defaultListServerModules(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ORPHAN_SCAN_SKIP.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
      } else if (SERVER_FILE.test(entry.name)) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);

  const relative = out.map((abs) => path.relative(root, abs));
  const ignored = gitIgnored(root, relative);
  return out.filter((_abs, i) => !ignored.has(relative[i]));
}

export interface RouteServerAutodiscoveryOptions {
  /**
   * Existence probe for a candidate server-module path. Injected for tests;
   * defaults to a synchronous filesystem check. Given an absolute path, returns
   * whether a file lives there.
   */
  fileExists?: (absPath: string) => boolean;
  /**
   * Lists absolute paths of every `*.server.*` module under the project root,
   * for the orphan check (a server file no route imports). Injected for tests;
   * defaults to a recursive filesystem scan.
   */
  listServerModules?: (root: string) => string[];
}

// Reads the static string name of an object property key, or undefined for
// computed / spread / method keys we don't recognize.
function propKeyName(
  prop: ObjectExpression['properties'][number]
): string | undefined {
  if (prop.type !== 'ObjectProperty' || prop.computed) return undefined;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return undefined;
}

// A route's `view`/`layout` is authored as a lazy thunk `() => import('...')`.
// Recover the literal specifier string, or undefined when the value is not a
// bare-import arrow (e.g. `() => import('x').then(wrap)` from contentRoutes,
// which we deliberately skip: those routes carry no colocated server module).
function bareImportSpecifier(prop: ObjectProperty): string | undefined {
  const value = prop.value;
  if (value.type !== 'ArrowFunctionExpression') return undefined;
  const body = value.body;
  if (body.type !== 'ImportExpression') return undefined;
  if (body.source.type !== 'StringLiteral') return undefined;
  return body.source.value;
}

/**
 * Auto-discovers colocated `.server.*` modules so authors don't hand-write the
 * `server:` thunk on every route.
 *
 * For each route object literal that carries a `path` and a `view`/`layout`
 * lazy-import thunk but *no* `server` field, this looks on disk for a sibling
 * server module named after the view/layout file (`login.tsx` ->
 * `login.server.ts`). When one exists, it splices in a
 * `server: () => import('./login.server.js')` thunk that is byte-identical to
 * what an author would write by hand, so every downstream stage (the client
 * stub rewrite in {@link serverOnlyPlugin}, SSR bundling, the runtime route
 * manifest, page-use inheritance, and the boot-time route-binding guard) sees
 * exactly the shape it sees today.
 *
 * An explicit `server:` always wins (discovery only fills an absent field), so
 * this is fully backward compatible and non-sibling server locations stay
 * expressible. Runs before {@link serverOnlyPlugin} in the pipeline, and on
 * both the client and SSR passes (the injected thunk must reach both bundles).
 */
export function routeServerAutodiscoveryPlugin(
  options: RouteServerAutodiscoveryOptions = {}
): Plugin {
  const fileExists = options.fileExists ?? ((p: string) => fs.existsSync(p));
  const listServerModules =
    options.listServerModules ?? defaultListServerModules;
  // Dev-time observability: discovery is implicit, so announce each wired
  // module once. `announced` dedupes across the client/SSR passes and HMR
  // re-transforms; logging is gated to `vite dev` to keep build output quiet.
  let logger: { info(msg: string): void } | undefined;
  let isDev = false;
  let root: string | undefined;
  const announced = new Set<string>();

  return {
    name: 'route-server-autodiscovery',
    enforce: 'pre',
    configResolved(config: {
      command: string;
      root: string;
      logger: { info(msg: string): void };
    }) {
      logger = config.logger;
      isDev = config.command === 'serve';
      root = config.root;
    },
    // Intentionally ignores the `ssr` flag: the injected thunk must land in
    // both the SSR bundle (so the runtime manifest loads the real module) and
    // the client bundle (where serverOnlyPlugin rewrites it to a stub).
    transform(code: string, id: string) {
      if (!/\.[jt]sx?$/.test(id)) return;
      if (/\.server\.[jt]sx?$/.test(id)) return;
      // Cheap pre-filter: a discoverable route needs a lazy import and a
      // view/layout key. Skips the AST parse for the overwhelming majority of
      // modules that are not route tables.
      if (!code.includes('import(')) return;
      if (!/\b(?:view|layout)\b/.test(code)) return;

      let ast;
      try {
        ast = parse(code, {
          sourceType: 'module',
          plugins: BABEL_PARSER_PLUGINS,
          errorRecovery: true,
        });
      } catch {
        return;
      }

      const importerDir = path.dirname(id);
      const s = new MagicString(code);
      // `this` inside the babel visitor is the traversal context, not the
      // Rollup plugin context, so capture the plugin context up here.
      const ctx = this;
      let changed = false;

      traverse(ast, {
        ObjectExpression(nodePath) {
          const props = nodePath.node.properties;
          const keys = new Set<string>();
          for (const prop of props) {
            const name = propKeyName(prop);
            if (name !== undefined) keys.add(name);
          }
          // Route shape: has `path`, has no explicit `server`. An explicit
          // `server` of any value (including `server: false`) opts the node
          // out of discovery.
          if (!keys.has('path') || keys.has('server')) return;

          // Prefer `view`, fall back to `layout` (a branch route wraps its
          // children with a layout and colocates its server module there).
          let anchor: ObjectProperty | undefined;
          let specifier: string | undefined;
          for (const key of ['view', 'layout'] as const) {
            const prop = props.find(
              (p): p is ObjectProperty => propKeyName(p) === key
            );
            if (!prop) continue;
            const spec = bareImportSpecifier(prop);
            if (spec) {
              anchor = prop;
              specifier = spec;
              break;
            }
          }
          if (!anchor || specifier === undefined) return;

          const ext = specifier.match(MODULE_EXT);
          if (!ext) return; // no explicit extension to splice `.server` into
          const base = specifier.slice(0, -ext[0].length);

          const absBase = path.resolve(importerDir, base);
          const serverExt = SERVER_EXTENSIONS.find((e) =>
            fileExists(absBase + e)
          );
          // Watch the canonical candidate even when absent, so creating the
          // server module in a running dev server re-triggers this transform.
          ctx.addWatchFile?.(absBase + SERVER_EXTENSIONS[0]);
          if (serverExt === undefined) return;
          ctx.addWatchFile?.(absBase + serverExt);

          // Emit a specifier Vite can resolve to the DISCOVERED sibling, not one
          // built from the view import's extension. Vite maps a `.js` import onto
          // `.js`/`.ts`/`.tsx` but never `.jsx`, so a `.jsx` sibling keeps its
          // literal extension while `.ts`/`.tsx`/`.js` siblings use the `.js`
          // convention. (Copying the view extension would emit an unresolvable
          // `.server.tsx` for a `.tsx` view beside a `.server.ts` sibling.)
          const injectedExt =
            serverExt === '.server.jsx' ? '.server.jsx' : '.server.js';
          const injectedSpecifier = `${base}${injectedExt}`;

          s.appendLeft(
            anchor.end!,
            `, server: () => import(${JSON.stringify(injectedSpecifier)})`
          );
          changed = true;

          if (isDev && logger) {
            const pathProp = props.find(
              (p): p is ObjectProperty => propKeyName(p) === 'path'
            );
            const routePath =
              pathProp && pathProp.value.type === 'StringLiteral'
                ? pathProp.value.value
                : injectedSpecifier;
            if (!announced.has(routePath)) {
              announced.add(routePath);
              logger.info(
                `[hono-preact] auto-discovered server module for route '${routePath}' (${injectedSpecifier})`
              );
            }
          }
        },
      });

      if (!changed) return;
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
    // Orphan check: warn about a `*.server.*` file that no route imports, so a
    // misplaced or mis-wired server module is not a silent runtime 404. Runs at
    // build time only (the dev graph is lazy) and only on a server build (on the
    // client, `.server` imports are stubbed, so every server file would look
    // orphaned). "Imported" is read straight off the module graph, which covers
    // both auto-discovered and explicit `server:` wiring, and server-to-server
    // imports (a shared `*.server.ts` util) too.
    buildEnd() {
      if (isDev || root === undefined) return;
      if (!this.environment || this.environment.name === 'client') return;

      const graph = new Set<string>();
      for (const id of this.getModuleIds()) graph.add(id.split('?')[0]);

      for (const file of listServerModules(root)) {
        if (graph.has(file)) continue;
        this.warn(
          `${path.relative(root, file)} looks like a server module but no route imports it. ` +
            `Colocate it next to a route's view/layout (e.g. \`foo.tsx\` -> \`foo.server.ts\`), ` +
            `or add an explicit \`server:\` entry to a route. Its loaders/actions are not reachable.`
        );
      }
    },
  };
}
