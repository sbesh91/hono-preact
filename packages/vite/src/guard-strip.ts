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
const NOOP_IMPORT_SOURCE = 'hono-preact/internal';
const NOOP_LOCAL_NAME = '__$guardNoop_hpiso';

// Two rewrite strategies live behind the same allowlist:
//
//   * `arg-noop`: replace the factory's argument (the user-supplied fn)
//     with a shared noop import. The factory call still runs and the
//     resulting object retains its real shape — only the fn body is gone.
//     Used for guards because the guard's body is what carries server-only
//     code (DB calls, secret reads); the wrapping factory call is trivial.
//
//   * `whole-call`: replace the entire call expression with a literal
//     brand object. Used for middleware/observer helpers whose factory
//     output is itself a small descriptor record — no point keeping the
//     factory call when the descriptor can be inlined. Tree-shakes the
//     entire user function plus any modules it pulls in.
//
// Both strategies serve the same purpose: ensure the wrong-env user code
// never reaches the wrong-env bundle even if a module is shared across
// page-level page.tsx (which Vite imports into both bundles).
type StripStrategy =
  | { kind: 'arg-noop'; name: string }
  | { kind: 'whole-call'; name: string; replacement: string };

// In the server bundle we strip anything client-only.
const SERVER_BUNDLE_STRIPS: ReadonlyArray<StripStrategy> = [
  { kind: 'arg-noop', name: 'defineClientGuard' },
  {
    kind: 'whole-call',
    name: 'defineClientMiddleware',
    replacement: `{ __kind: 'middleware', runs: 'client', fn: () => Promise.resolve() }`,
  },
];

// In the client bundle we strip anything server-only. Stream observers
// fire on the server-side streaming pipeline (start/chunk/end/error/abort)
// so they're server-only too.
const CLIENT_BUNDLE_STRIPS: ReadonlyArray<StripStrategy> = [
  { kind: 'arg-noop', name: 'defineServerGuard' },
  {
    kind: 'whole-call',
    name: 'defineServerMiddleware',
    replacement: `{ __kind: 'middleware', runs: 'server', fn: () => Promise.resolve() }`,
  },
  {
    kind: 'whole-call',
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
  argStart: number;
  argEnd: number;
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
    if (
      strategy &&
      n.arguments &&
      n.arguments.length >= 1 &&
      n.arguments[0].start !== undefined &&
      n.arguments[0].end !== undefined
    ) {
      hits.push({
        strategy,
        start: n.start!,
        end: n.end!,
        argStart: n.arguments[0].start!,
        argEnd: n.arguments[0].end!,
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
      let needsNoopImport = false;
      for (const hit of [...hits].reverse()) {
        if (hit.strategy.kind === 'arg-noop') {
          s.overwrite(hit.argStart, hit.argEnd, NOOP_LOCAL_NAME);
          needsNoopImport = true;
        } else {
          s.overwrite(hit.start, hit.end, hit.strategy.replacement);
        }
      }
      if (needsNoopImport) {
        s.prepend(
          `import { ${NOOP_LOCAL_NAME} } from '${NOOP_IMPORT_SOURCE}';\n`
        );
      }
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
