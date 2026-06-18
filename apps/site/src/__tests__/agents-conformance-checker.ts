// AST checker for the AGENTS.md conformance gate. Pure functions over source
// text - no filesystem. Lives under __tests__ so the live scan excludes it and
// vitest does not collect it as a suite (the include glob matches *.test.ts).
//
// `any` is used freely here to walk Babel's untyped node graph generically;
// this is test infrastructure, excluded from the gate's own scan.
import { parse } from '@babel/parser';

type AnyNode = { type?: string; start?: number; end?: number } & Record<
  string,
  unknown
>;

function parseSource(source: string, tsx: boolean) {
  return parse(source, {
    sourceType: 'module',
    plugins: tsx ? ['typescript', 'jsx'] : ['typescript'],
    errorRecovery: true,
  });
}

// Visit every node in the tree. Recurses into arrays and objects that look
// like AST nodes (have a string `type`); skips position/comment metadata.
function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return;
  const n = node as AnyNode;
  if (typeof n.type === 'string') visit(n);
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range')
      continue;
    const val = n[key];
    if (Array.isArray(val)) {
      for (const child of val) walk(child, visit);
    } else if (val && typeof val === 'object') {
      walk(val, visit);
    }
  }
}

export function collectImports(source: string, tsx: boolean): string[] {
  const ast = parseSource(source, tsx);
  const out: string[] = [];
  walk(ast.program, (n) => {
    if (
      (n.type === 'ImportDeclaration' ||
        n.type === 'ExportNamedDeclaration' ||
        n.type === 'ExportAllDeclaration' ||
        n.type === 'ImportExpression') &&
      n.source &&
      typeof (n.source as AnyNode).value === 'string'
    ) {
      out.push((n.source as AnyNode).value as string);
    }
  });
  return out;
}

function isAsConst(typeAnnotation: AnyNode | undefined): boolean {
  // `x as const` parses to a TSAsExpression whose typeAnnotation is a
  // TSTypeReference to the identifier `const`.
  if (!typeAnnotation) return false;
  if (typeAnnotation.type !== 'TSTypeReference') return false;
  const name = typeAnnotation.typeName as AnyNode | undefined;
  return name?.type === 'Identifier' && name.name === 'const';
}

export function collectCasts(
  source: string,
  tsx: boolean
): { expr: string }[] {
  const ast = parseSource(source, tsx);

  // Collect every cast node first, then build a Set of nodes that are the
  // direct `.expression` child of another cast (i.e. the inner half of a chain
  // like `x as unknown as Foo`). Those inner nodes are excluded so that a chain
  // counts as one cast at the outermost level.
  //
  // NOTE: range-containment would be wrong here. `(x as T).foo as U` has two
  // independent casts that happen to be range-nested; we must report both.
  // Only direct `.expression` parentage is the correct predicate.
  const castNodes: AnyNode[] = [];
  walk(ast.program, (n) => {
    if (n.type === 'TSAsExpression' || n.type === 'TSTypeAssertion') {
      castNodes.push(n);
    }
  });

  // Build the set of nodes that are the direct inner expression of some cast.
  const innerNodes = new Set<AnyNode>();
  for (const node of castNodes) {
    const expr = node.expression as AnyNode | undefined;
    if (
      expr &&
      (expr.type === 'TSAsExpression' || expr.type === 'TSTypeAssertion')
    ) {
      innerNodes.add(expr);
    }
  }

  const out: { expr: string }[] = [];
  for (const n of castNodes) {
    if (innerNodes.has(n)) continue;
    if (isAsConst(n.typeAnnotation as AnyNode | undefined)) continue;
    const text = source
      .slice(n.start ?? 0, n.end ?? 0)
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ expr: text });
  }
  return out;
}
