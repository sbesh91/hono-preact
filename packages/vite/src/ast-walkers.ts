import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type {
  CallExpression,
  File,
  ImportDeclaration,
  Node,
} from '@babel/types';

export type DynamicServerImport = {
  start: number;
  end: number;
  source: string;
};

// @babel/traverse is CJS; under some Node ESM interop the callable lands on
// `.default`. Normalize to the function. (Acceptable module-interop boundary.)
const traverseFn =
  (traverse as unknown as { default?: typeof traverse }).default ?? traverse;

// Collect `import('...server...')` dynamic-import call sites. A dynamic import
// is an `import(...)` CallExpression whose callee is the `Import` node; we keep
// the ones whose first argument is a `.server[.jt]sx?` string literal so the
// transform can replace the body with a resolved stub.
export function findDynamicServerImports(
  ast: File | Node,
  found: DynamicServerImport[]
): void {
  traverseFn(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const { node } = path;
      if (node.callee.type !== 'Import') return;
      const arg = node.arguments[0];
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
