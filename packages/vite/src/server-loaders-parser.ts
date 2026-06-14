import type { Program, CallExpression, ObjectExpression } from '@babel/types';

export type ParsedLoaderEntry = {
  /** Loader name (the key in serverLoaders, e.g. "summary"). */
  name: string;
  /** The loader CallExpression node -- for AST-mutation consumers. */
  call: CallExpression;
  /** The opts ObjectExpression if the call has an opts arg; otherwise null. */
  optsArg: ObjectExpression | null;
};

/**
 * Whether a call expression produces a loader inside `serverLoaders`. Matches
 * both `defineLoader(...)` and the `serverRoute(...).loader(...)` /
 * `route.loader(...)` factory form (a non-computed `.loader` member call). The
 * `serverLoaders` contract guarantees its values are `LoaderRef`s, and only
 * these two forms produce them, so matching `.loader(...)` here is safe.
 */
export function isLoaderCall(call: CallExpression): boolean {
  const callee = call.callee;
  if (callee.type === 'Identifier' && callee.name === 'defineLoader') {
    return true;
  }
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'loader'
  );
}

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
        if (!isLoaderCall(call)) continue;

        // The route-id overload `defineLoader('/r/:id', fn, opts?)` shifts the
        // opts object to the third argument; the fn-first form keeps it second.
        const isRouteForm = call.arguments[0]?.type === 'StringLiteral';
        const optsCandidate = isRouteForm
          ? call.arguments[2]
          : call.arguments[1];
        const optsArg =
          optsCandidate?.type === 'ObjectExpression'
            ? (optsCandidate as ObjectExpression)
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
