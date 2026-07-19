import type { Program, CallExpression, ObjectExpression } from '@babel/types';

export type ParsedLoaderEntry = {
  /** Loader name (the key in serverLoaders, e.g. "summary"). */
  name: string;
  /** The loader CallExpression node -- for AST-mutation consumers. */
  call: CallExpression;
  /** The opts ObjectExpression if the call has an opts arg; otherwise null. */
  optsArg: ObjectExpression | null;
  /** Whether the loader is bound to a route. True for the `route.loader(...)` /
   * `serverRoute(...).loader(...)` member-call form (which threads a route id on
   * the server); false for the bare `defineLoader(...)` identifier form (a
   * route-independent loader). The client stub carries this so `LoaderHost` can
   * refuse a route-bound loader consumed with no resolvable location. */
  routeBound: boolean;
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
 * The property key may be a bare identifier (`summary:`) or a string literal
 * (`'my-loader':`); both yield the loader name threaded into the client stub.
 * Non-matching properties (spread elements, computed/other-typed keys, non-call
 * values) are silently skipped. If `serverLoaders` is absent or has the wrong
 * shape, returns [].
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

      const obj = decl.init;
      for (const prop of obj.properties) {
        if (
          prop.type !== 'ObjectProperty' ||
          prop.value.type !== 'CallExpression'
        )
          continue;

        // The loader name is the property key. Accept both bare identifier keys
        // (`summary:`) and string-literal keys (`'my-loader':`); any other key
        // shape (numeric, computed expression) yields no name and is skipped.
        const name =
          prop.key.type === 'Identifier'
            ? prop.key.name
            : prop.key.type === 'StringLiteral'
              ? prop.key.value
              : undefined;
        if (name === undefined) continue;

        const call = prop.value;
        if (!isLoaderCall(call)) continue;

        // A loader takes (fn, opts?). The opts arg, when present, is the second
        // argument; narrow it to an ObjectExpression (no cast: a `.type` check
        // narrows the const binding).
        const optsCandidate = call.arguments[1];
        const optsArg =
          optsCandidate?.type === 'ObjectExpression' ? optsCandidate : null;

        // Route-bound iff the call is the member form (`route.loader(...)` /
        // `serverRoute(...).loader(...)`); the bare `defineLoader(...)` identifier
        // form is route-independent.
        const routeBound = call.callee.type === 'MemberExpression';

        entries.push({
          name,
          call,
          optsArg,
          routeBound,
        });
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
export function readParamsOption(
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
