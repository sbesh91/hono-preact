import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type {
  File,
  ImportDeclaration,
  ImportExpression,
  Node,
} from '@babel/types';

export type DynamicServerImport = {
  start: number;
  end: number;
  source: string;
};

// Collect `import('...server...')` dynamic-import call sites. Babel parses a
// dynamic import as an `ImportExpression` whose `source` is the specifier; we
// keep the ones whose source is a `.server[.jt]sx?` string literal so the
// transform can replace the body with a resolved stub.
export function findDynamicServerImports(
  ast: File | Node,
  found: DynamicServerImport[]
): void {
  traverse(ast, {
    ImportExpression(path: NodePath<ImportExpression>) {
      const { node } = path;
      // `source` is typed non-null, but under `errorRecovery` a malformed
      // `import()` (e.g. no argument) yields an ImportExpression with no
      // source, so the optional chain guards before reading `.type`.
      const arg = node.source;
      if (
        arg?.type === 'StringLiteral' &&
        /\.server(\.[jt]sx?)?$/.test(arg.value)
      ) {
        found.push({ start: node.start!, end: node.end!, source: arg.value });
      }
    },
  });
}

// Typed against babel's `Node` (every caller already passes AST nodes, e.g.
// `ast.program.body.filter(isServerImport)`), so the discriminant check narrows
// `node` to `ImportDeclaration` and `node.source.value` reads without a cast.
export const isServerImport = (node: Node): node is ImportDeclaration =>
  node.type === 'ImportDeclaration' &&
  /\.server(\.[jt]sx?)?$/.test(node.source.value);
