import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { CallExpression, File } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

const ISO_PACKAGE_SOURCES = new Set(['@hono-preact/iso', 'hono-preact']);

// The channel factory is NOT a strip. Its call sites are rewritten in BOTH
// bundles, to the same id, which is the whole point: the server and client
// bundles each construct their own channel object, so only a compile-time id
// can make the two agree. A runtime counter cannot.
//
// Id stability rests on one invariant: both bundles must feed this plugin
// identical pre-transform source. Another `enforce: 'pre'` plugin that rewrites
// a module in only one environment would shift the AST and break the agreement.
const CHANNEL_FACTORY = 'defineSessionChannel';

// Each strip replaces the entire call expression with a literal brand
// object. The middleware/observer factory output IS a small descriptor
// record, so inlining the brand object lets the user's fn body and any
// modules it pulls in tree-shake out of the wrong-env bundle.
type StripStrategy = { name: string; replacement: string };

// What a matched call site turns into. `strip` swaps the whole call for an
// inert brand object; `channelId` keeps the callee and supplies the id
// argument the user omitted.
type Rewrite = { kind: 'strip'; replacement: string } | { kind: 'channelId' };

// In the server bundle we strip anything client-only. The replacement
// `fn` arity matches the documented `(ctx, next) => Promise<void | Outcome>`
// shape so any user introspecting `mw.fn` sees the right signature; the
// framework path filters on `runs` before invoking and never executes a
// wrong-env body.
const SERVER_BUNDLE_STRIPS: ReadonlyArray<StripStrategy> = [
  {
    name: 'defineClientMiddleware',
    replacement: `{ __kind: 'middleware', runs: 'client', fn: (_ctx, next) => next() }`,
  },
];

// In the client bundle we strip anything server-only. Stream observers
// fire on the server-side streaming pipeline (start/chunk/end/error/abort)
// so they're server-only too.
const CLIENT_BUNDLE_STRIPS: ReadonlyArray<StripStrategy> = [
  {
    name: 'defineServerMiddleware',
    replacement: `{ __kind: 'middleware', runs: 'server', fn: (_ctx, next) => next() }`,
  },
  {
    name: 'defineStreamObserver',
    replacement: `{ __kind: 'observer' }`,
  },
];

// The bindings a `.server` strip can be reached through in one module:
//   direct     `import { defineServerMiddleware } from 'hono-preact'` -> local
//              name resolves straight to a strategy (matched on `foo()` calls).
//   namespaces `import * as hp from 'hono-preact'` -> the namespace local name;
//              a strip is reached as a member call `hp.defineServerMiddleware()`,
//              matched by property name. Without this the namespace form ships
//              the middleware body to the client -- and since a `.server.*`
//              module cannot export middleware (the exports contract blocks it),
//              guard-strip is the ONLY protection for route-level middleware.
type StripBindings = {
  direct: Map<string, Rewrite>;
  namespaces: Set<string>;
};

function collectLocalBindings(
  ast: ReturnType<typeof parse>,
  byName: ReadonlyMap<string, Rewrite>
): StripBindings {
  const direct = new Map<string, Rewrite>();
  const namespaces = new Set<string>();
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const imp = node;
    if (!ISO_PACKAGE_SOURCES.has(imp.source.value)) continue;
    for (const spec of imp.specifiers) {
      if (spec.type === 'ImportNamespaceSpecifier') {
        namespaces.add(spec.local.name);
        continue;
      }
      if (spec.type !== 'ImportSpecifier') continue;
      if (spec.imported.type !== 'Identifier') continue;
      const rewrite = byName.get(spec.imported.name);
      if (rewrite) {
        direct.set(spec.local.name, rewrite);
      }
    }
  }
  return { direct, namespaces };
}

type Hit = {
  text: string;
  start: number;
  end: number;
};

function findCallsByLocalName(
  ast: File,
  code: string,
  moduleId: string,
  bindings: StripBindings,
  byName: ReadonlyMap<string, Rewrite>,
  hits: Hit[]
): void {
  // Counts every channel call in the module, in source order, whether or not
  // its rewrite survives (a call nested inside a stripped body is dropped at
  // apply time). Counting before that filter is what keeps the index the same
  // in a bundle that strips the enclosing call and one that does not.
  let channelIndex = 0;
  traverse(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const { node } = path;
      const callee = node.callee;
      let rewrite: Rewrite | undefined;
      if (callee.type === 'Identifier') {
        // `defineServerMiddleware(...)` via a named import.
        rewrite = bindings.direct.get(callee.name);
      } else if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.object.type === 'Identifier' &&
        bindings.namespaces.has(callee.object.name) &&
        callee.property.type === 'Identifier'
      ) {
        // `hp.defineServerMiddleware(...)` via a namespace import: the object is
        // a framework namespace binding and the property names the symbol.
        rewrite = byName.get(callee.property.name);
      }
      if (!rewrite || node.start == null || node.end == null) return;
      if (rewrite.kind === 'strip') {
        hits.push({
          text: rewrite.replacement,
          start: node.start,
          end: node.end,
        });
        return;
      }
      const index = channelIndex++;
      // A user who passed an explicit id owns it.
      if (node.arguments.length > 0) return;
      if (callee.start == null || callee.end == null) return;
      // Preserve the callee text so a renamed or namespaced import round-trips.
      const calleeText = code.slice(callee.start, callee.end);
      hits.push({
        text: `${calleeText}(${JSON.stringify(`${moduleId}#${index}`)})`,
        start: node.start,
        end: node.end,
      });
    },
  });
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

// Small, stable, non-cryptographic hash (FNV-1a, 32-bit) used only to keep the
// fallback id unique across two modules that share a basename.
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The id embedded in the bundle, and therefore shipped to every client in the
 * SSR bootstrap and the `X-HP-Channels` header. It must be
 *
 *   1. identical between the server and client transforms of the same module
 *      (both run with the same Vite `root`, so a root-relative path is safe),
 *   2. identical across machines and platforms (forward slashes always), and
 *   3. free of the build machine's directory layout.
 *
 * A module inside the project root becomes a root-relative POSIX path. A module
 * outside the root has no root-relative spelling, so it falls back to a
 * `node_modules/`-relative path when it lives in a dependency, and otherwise to
 * its basename plus a short hash of the full path. Both fallbacks are stable for
 * a given module and carry no absolute prefix.
 */
export function channelModuleId(moduleId: string, root: string | null): string {
  const path = toPosix(moduleId);
  if (root !== null) {
    const base = toPosix(root).replace(/\/+$/, '');
    if (path === base) return path.slice(path.lastIndexOf('/') + 1);
    if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  }
  const marker = '/node_modules/';
  const at = path.lastIndexOf(marker);
  if (at !== -1) return `node_modules/${path.slice(at + marker.length)}`;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return `${name}@${shortHash(path)}`;
}

// Vite hands the transform an id that can carry a `?v=...` / `?import` suffix,
// and the suffix is not the same in the two bundles. The path before the `?`
// is, so that is the identity.
function normalizeModuleId(id: string): string {
  return id.split('?')[0] ?? id;
}

/**
 * Why a module is or is not eligible for rewriting. The reason is part of the
 * result rather than a bare boolean so a test can pin WHICH gate rejected an
 * id: a `.server.*` module carrying a `?v=` suffix must be rejected as
 * `server-module`, and rejecting it as `not-script` would mean normalization
 * never ran.
 */
export type ModuleIdVerdict =
  | 'eligible'
  // A rollup/commonjs virtual id (`\0...`). Not something this plugin authored
  // or is meant to see.
  | 'virtual-id'
  | 'not-script'
  // `.server.*` files are intentionally skipped in both bundles.
  // In the client bundle the server-only stub plugin already rewrites
  // imports of these files; in the server bundle the file's own
  // body stays as-authored. The validation plugin restricts a
  // `.server.*` module's named exports to the allowlist, so a user
  // cannot land a `defineClientMiddleware(...)` value as a recognized
  // export and ship it to the server.
  | 'server-module';

/**
 * Classifies a raw Vite module id. Normalizes first, on purpose: a dev id
 * carries a `?v=<hash>` suffix that would otherwise fail the extension test and
 * skip the module entirely, leaking a server middleware body into the client
 * bundle.
 */
export function classifyModuleId(rawId: string): {
  verdict: ModuleIdVerdict;
  moduleId: string;
} {
  const moduleId = normalizeModuleId(rawId);
  if (moduleId.startsWith('\0')) return { verdict: 'virtual-id', moduleId };
  if (!/\.[jt]sx?$/.test(moduleId)) return { verdict: 'not-script', moduleId };
  if (/\.server\.[jt]sx?$/.test(moduleId))
    return { verdict: 'server-module', moduleId };
  return { verdict: 'eligible', moduleId };
}

export function guardStripPlugin(): Plugin {
  // The resolved Vite project root, captured so injected channel ids can be
  // root-relative instead of leaking the build machine's absolute paths.
  let root: string | null = null;
  return {
    name: 'hono-preact:guard-strip',
    enforce: 'pre',
    configResolved(config: { root: string }) {
      root = config.root;
    },
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      const { verdict, moduleId } = classifyModuleId(id);
      if (verdict !== 'eligible') return;
      const strips = options?.ssr ? SERVER_BUNDLE_STRIPS : CLIENT_BUNDLE_STRIPS;

      // Cheap pre-filter: only parse files that mention at least one of the
      // symbols we rewrite. Avoids parsing the entire dep graph just to
      // confirm nothing applies.
      const mentioned =
        strips.some((s) => code.includes(s.name)) ||
        code.includes(CHANNEL_FACTORY);
      if (!mentioned) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: BABEL_PARSER_PLUGINS,
        errorRecovery: true,
      });

      const byName = new Map<string, Rewrite>(
        strips.map((s) => [
          s.name,
          { kind: 'strip', replacement: s.replacement },
        ])
      );
      byName.set(CHANNEL_FACTORY, { kind: 'channelId' });
      const bindings = collectLocalBindings(ast, byName);
      if (bindings.direct.size === 0 && bindings.namespaces.size === 0) return;

      const hits: Hit[] = [];
      findCallsByLocalName(
        ast,
        code,
        channelModuleId(moduleId, root),
        bindings,
        byName,
        hits
      );
      if (hits.length === 0) return;

      // Drop any hit nested inside an earlier one: the outer rewrite already
      // replaced that source range, and overlapping overwrites are an error.
      const ordered = [...hits].sort((a, b) => a.start - b.start);
      const applicable: Hit[] = [];
      let coveredTo = -1;
      for (const hit of ordered) {
        if (hit.start < coveredTo) continue;
        applicable.push(hit);
        coveredTo = hit.end;
      }

      const s = new MagicString(code);
      for (const hit of applicable.reverse()) {
        s.overwrite(hit.start, hit.end, hit.text);
      }
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
