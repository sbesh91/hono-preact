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

type GuardFactory = 'defineServerGuard' | 'defineClientGuard';

function collectLocalBindings(
  ast: ReturnType<typeof parse>,
  targets: Set<GuardFactory>
): Map<string, GuardFactory> {
  const bindings = new Map<string, GuardFactory>();
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const imp = node as ImportDeclaration;
    if (!ISO_PACKAGE_SOURCES.has(imp.source.value)) continue;
    for (const spec of imp.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      if (spec.imported.type !== 'Identifier') continue;
      const name = spec.imported.name;
      if (name === 'defineServerGuard' || name === 'defineClientGuard') {
        if (targets.has(name)) {
          bindings.set(spec.local.name, name);
        }
      }
    }
  }
  return bindings;
}

function findCallsByLocalName(
  node: unknown,
  bindings: Map<string, GuardFactory>,
  hits: Array<{ start: number; end: number; argStart: number; argEnd: number }>
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
    n.callee.name &&
    bindings.has(n.callee.name) &&
    n.arguments &&
    n.arguments.length >= 1 &&
    n.arguments[0].start !== undefined &&
    n.arguments[0].end !== undefined
  ) {
    hits.push({
      start: n.start!,
      end: n.end!,
      argStart: n.arguments[0].start!,
      argEnd: n.arguments[0].end!,
    });
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
      const stripping: GuardFactory = options?.ssr
        ? 'defineClientGuard'
        : 'defineServerGuard';
      if (!code.includes(stripping)) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: BABEL_PARSER_PLUGINS,
        errorRecovery: true,
      });

      const bindings = collectLocalBindings(ast, new Set([stripping]));
      if (bindings.size === 0) return;

      const hits: Array<{
        start: number;
        end: number;
        argStart: number;
        argEnd: number;
      }> = [];
      findCallsByLocalName(ast.program, bindings, hits);
      if (hits.length === 0) return;

      const s = new MagicString(code);
      for (const hit of [...hits].reverse()) {
        s.overwrite(hit.argStart, hit.argEnd, NOOP_LOCAL_NAME);
      }
      s.prepend(
        `import { ${NOOP_LOCAL_NAME} } from '${NOOP_IMPORT_SOURCE}';\n`
      );
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
