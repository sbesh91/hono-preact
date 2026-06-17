import type { ImportDeclaration } from '@babel/types';

export type DynamicServerImport = {
  start: number;
  end: number;
  source: string;
};

export function findDynamicServerImports(
  node: unknown,
  found: DynamicServerImport[]
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) findDynamicServerImports(child, found);
    return;
  }
  const n = node as {
    type?: string;
    callee?: { type?: string };
    arguments?: Array<{ type?: string; value?: string }>;
    start?: number;
    end?: number;
  };
  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'Import' &&
    n.arguments?.[0]?.type === 'StringLiteral' &&
    typeof n.arguments[0].value === 'string' &&
    /\.server(\.[jt]sx?)?$/.test(n.arguments[0].value)
  ) {
    found.push({
      start: n.start!,
      end: n.end!,
      source: n.arguments[0].value,
    });
  }
  for (const key of Object.keys(node as object)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments'
    )
      continue;
    findDynamicServerImports((node as Record<string, unknown>)[key], found);
  }
}

export const isServerImport = (node: unknown): node is ImportDeclaration =>
  (node as ImportDeclaration).type === 'ImportDeclaration' &&
  /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value);
