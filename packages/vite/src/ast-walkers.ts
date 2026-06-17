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

export const isServerImport = (node: unknown): node is ImportDeclaration =>
  (node as ImportDeclaration).type === 'ImportDeclaration' &&
  /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value);
