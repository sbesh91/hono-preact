import { parse } from '@babel/parser';
import type {
  CallExpression,
  Identifier,
  ImportDeclaration,
} from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

const ISO_PACKAGE_SOURCES = new Set(['@hono-preact/iso', 'hono-preact']);

// Each strip replaces the entire call expression with a literal brand
// object. The middleware/observer factory output IS a small descriptor
// record, so inlining the brand object lets the user's fn body and any
// modules it pulls in tree-shake out of the wrong-env bundle.
type StripStrategy = { name: string; replacement: string };

// In the server bundle we strip anything client-only.
const SERVER_BUNDLE_STRIPS: ReadonlyArray<StripStrategy> = [
  {
    name: 'defineClientMiddleware',
    replacement: `{ __kind: 'middleware', runs: 'client', fn: () => Promise.resolve() }`,
  },
];

// In the client bundle we strip anything server-only. Stream observers
// fire on the server-side streaming pipeline (start/chunk/end/error/abort)
// so they're server-only too.
const CLIENT_BUNDLE_STRIPS: ReadonlyArray<StripStrategy> = [
  {
    name: 'defineServerMiddleware',
    replacement: `{ __kind: 'middleware', runs: 'server', fn: () => Promise.resolve() }`,
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
  node: unknown,
  bindings: Map<string, StripStrategy>,
  hits: Hit[]
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) findCallsByLocalName(child, bindings, hits);
    return;
  }
  const n = node as {
    type?: string;
    callee?: Identifier & { type?: string; name?: string };
    arguments?: CallExpression['arguments'];
    start?: number;
    end?: number;
  };
  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'Identifier' &&
    n.callee.name
  ) {
    const strategy = bindings.get(n.callee.name);
    if (strategy && n.start !== undefined && n.end !== undefined) {
      hits.push({
        strategy,
        start: n.start,
        end: n.end,
      });
    }
  }
  for (const key of Object.keys(node as object)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments'
    )
      continue;
    findCallsByLocalName(
      (node as Record<string, unknown>)[key],
      bindings,
      hits
    );
  }
}

export function guardStripPlugin(): Plugin {
  return {
    name: 'hono-preact:guard-strip',
    enforce: 'pre',
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (!/\.[jt]sx?$/.test(id)) return;
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
      findCallsByLocalName(ast.program, bindings, hits);
      if (hits.length === 0) return;

      const s = new MagicString(code);
      for (const hit of [...hits].reverse()) {
        s.overwrite(hit.start, hit.end, hit.strategy.replacement);
      }
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
