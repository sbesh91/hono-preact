import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { CallExpression, File, ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

const ISO_PACKAGE_SOURCES = new Set(['@hono-preact/iso', 'hono-preact']);

// Each strip replaces the entire call expression with a literal brand
// object. The middleware/observer factory output IS a small descriptor
// record, so inlining the brand object lets the user's fn body and any
// modules it pulls in tree-shake out of the wrong-env bundle.
type StripStrategy = { name: string; replacement: string };

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

function collectLocalBindings(
  ast: ReturnType<typeof parse>,
  strips: ReadonlyArray<StripStrategy>
): Map<string, StripStrategy> {
  const bindings = new Map<string, StripStrategy>();
  const byName = new Map(strips.map((s) => [s.name, s]));
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const imp = node as ImportDeclaration;
    if (!ISO_PACKAGE_SOURCES.has(imp.source.value)) continue;
    for (const spec of imp.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      if (spec.imported.type !== 'Identifier') continue;
      const strategy = byName.get(spec.imported.name);
      if (strategy) {
        bindings.set(spec.local.name, strategy);
      }
    }
  }
  return bindings;
}

type Hit = {
  strategy: StripStrategy;
  start: number;
  end: number;
};

function findCallsByLocalName(
  ast: File,
  bindings: Map<string, StripStrategy>,
  hits: Hit[]
): void {
  traverse(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const { node } = path;
      if (node.callee.type !== 'Identifier') return;
      const strategy = bindings.get(node.callee.name);
      if (strategy && node.start != null && node.end != null) {
        hits.push({ strategy, start: node.start, end: node.end });
      }
    },
  });
}

export function guardStripPlugin(): Plugin {
  return {
    name: 'hono-preact:guard-strip',
    enforce: 'pre',
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (!/\.[jt]sx?$/.test(id)) return;
      // F7: `.server.*` files are intentionally skipped in both bundles.
      // In the client bundle the server-only stub plugin already rewrites
      // imports of these files; in the server bundle the file's own
      // body stays as-authored. The validation plugin restricts a
      // `.server.*` module's named exports to the allowlist, so a user
      // cannot land a `defineClientMiddleware(...)` value as a recognized
      // export and ship it to the server.
      if (/\.server\.[jt]sx?$/.test(id)) return;
      const strips = options?.ssr ? SERVER_BUNDLE_STRIPS : CLIENT_BUNDLE_STRIPS;

      // Cheap pre-filter: only parse files that mention at least one of the
      // symbols we strip. Avoids parsing the entire dep graph just to
      // confirm no strips apply.
      if (!strips.some((s) => code.includes(s.name))) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: BABEL_PARSER_PLUGINS,
        errorRecovery: true,
      });

      const bindings = collectLocalBindings(ast, strips);
      if (bindings.size === 0) return;

      const hits: Hit[] = [];
      findCallsByLocalName(ast, bindings, hits);
      if (hits.length === 0) return;

      const s = new MagicString(code);
      for (const hit of [...hits].reverse()) {
        s.overwrite(hit.start, hit.end, hit.strategy.replacement);
      }
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
