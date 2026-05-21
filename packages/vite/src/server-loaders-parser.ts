import type { Program, CallExpression, ObjectExpression } from '@babel/types';

// Recognized middleware-carrying named exports on .server.* modules. The
// parser does not need to extract them (they're plain top-level exports
// already accessible through the runtime module shape); this set documents
// the contract so route-server-modules and the handler-side resolvers
// agree on the export names.
//
// - loaderUse / actionUse: per-unit middleware now rides on the
//   LoaderRef / ActionStub via .use; these are reserved names for
//   parallel-style future opt-in (e.g. attaching middleware without a
//   defineLoader call).
// - pageUse: page-layer middleware. The .server.* file declares its own
//   pageUse, and route-server-modules indexes the value by route path so
//   loaders/actions handlers can compose [appConfig.use, pageUse, unitUse].
export const RECOGNIZED_USE_EXPORTS = new Set([
  'loaderUse',
  'actionUse',
  'pageUse',
] as const);

export function hasNamedUseExport(program: Program, name: string): boolean {
  for (const stmt of program.body) {
    if (
      stmt.type !== 'ExportNamedDeclaration' ||
      stmt.declaration?.type !== 'VariableDeclaration'
    )
      continue;
    for (const decl of stmt.declaration.declarations) {
      if (decl.id.type === 'Identifier' && decl.id.name === name) return true;
    }
  }
  return false;
}

export type ParsedLoaderEntry = {
  /** Loader name (the key in serverLoaders, e.g. "summary"). */
  name: string;
  /** The defineLoader(...) CallExpression node -- for AST-mutation consumers. */
  call: CallExpression;
  /** The opts ObjectExpression if defineLoader has 2 args; otherwise null. */
  optsArg: ObjectExpression | null;
};

/**
 * Walk a parsed program for `export const serverLoaders = { name: defineLoader(fn, opts?), ... }`.
 * Returns one entry per object property whose value is a defineLoader(...) call.
 * Non-matching properties (spread elements, computed keys, non-call values) are silently skipped.
 * If `serverLoaders` is absent or has the wrong shape, returns [].
 */
export function parseServerLoaders(program: Program): ParsedLoaderEntry[] {
  const entries: ParsedLoaderEntry[] = [];

  for (const stmt of program.body) {
    if (
      stmt.type !== 'ExportNamedDeclaration' ||
      stmt.declaration?.type !== 'VariableDeclaration'
    )
      continue;

    for (const decl of stmt.declaration.declarations) {
      if (
        decl.id.type !== 'Identifier' ||
        decl.id.name !== 'serverLoaders' ||
        decl.init?.type !== 'ObjectExpression'
      )
        continue;

      const obj = decl.init as ObjectExpression;
      for (const prop of obj.properties) {
        if (
          prop.type !== 'ObjectProperty' ||
          prop.key.type !== 'Identifier' ||
          prop.value.type !== 'CallExpression'
        )
          continue;

        const call = prop.value as CallExpression;
        if (
          call.callee.type !== 'Identifier' ||
          call.callee.name !== 'defineLoader'
        )
          continue;

        const secondArg = call.arguments[1];
        const optsArg =
          secondArg?.type === 'ObjectExpression'
            ? (secondArg as ObjectExpression)
            : null;

        entries.push({ name: prop.key.name, call, optsArg });
      }
    }
  }

  return entries;
}

/**
 * Read the `params` option from a defineLoader opts ObjectExpression literal.
 * Returns `string[]` for array literals of string literals, `'*'` for the
 * wildcard string literal, or undefined if not present or unsupported shape.
 */
export function readParamsOpt(
  opts: ObjectExpression
): string[] | '*' | undefined {
  for (const prop of opts.properties) {
    if (
      prop.type !== 'ObjectProperty' ||
      prop.key.type !== 'Identifier' ||
      prop.key.name !== 'params'
    )
      continue;

    const val = prop.value;
    if (val.type === 'StringLiteral' && val.value === '*') {
      return '*';
    }
    if (val.type === 'ArrayExpression') {
      const items: string[] = [];
      for (const el of val.elements) {
        if (el?.type === 'StringLiteral') items.push(el.value);
      }
      if (items.length > 0) return items;
    }
  }

  return undefined;
}
