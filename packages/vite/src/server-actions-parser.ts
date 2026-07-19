import type { Program, CallExpression } from '@babel/types';

export type ParsedActionEntry = {
  /** Action name (the key in serverActions, e.g. "login"). */
  name: string;
  /** The action CallExpression node -- for AST-mutation consumers. */
  call: CallExpression;
};

/**
 * Whether a call expression produces an action inside `serverActions`. Matches
 * both `defineAction(...)` and the `serverRoute(...).action(...)` /
 * `route.action(...)` factory form (a non-computed `.action` member call). The
 * `serverActions` contract guarantees its values are `ActionRef`s, and only
 * these two forms produce them, so matching `.action(...)` here is safe.
 */
export function isActionCall(call: CallExpression): boolean {
  const callee = call.callee;
  if (callee.type === 'Identifier' && callee.name === 'defineAction') {
    return true;
  }
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'action'
  );
}

/**
 * Walk a parsed program for `export const serverActions = { name: defineAction(fn, opts?), ... }`.
 * Returns one entry per object property whose value is a defineAction(...) call.
 * The property key may be a bare identifier (`login:`) or a string literal
 * (`'sign-up':`); both yield the action name threaded into the SSR `<Form>`
 * hidden inputs. Non-matching properties (spread elements, computed/other-typed
 * keys, non-call values) are silently skipped. If `serverActions` is absent or
 * has the wrong shape, returns [].
 */
export function parseServerActions(program: Program): ParsedActionEntry[] {
  const entries: ParsedActionEntry[] = [];

  for (const stmt of program.body) {
    if (
      stmt.type !== 'ExportNamedDeclaration' ||
      stmt.declaration?.type !== 'VariableDeclaration'
    )
      continue;

    for (const decl of stmt.declaration.declarations) {
      if (
        decl.id.type !== 'Identifier' ||
        decl.id.name !== 'serverActions' ||
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

        // The action name is the property key. Accept both bare identifier keys
        // (`login:`) and string-literal keys (`'sign-up':`); any other key shape
        // (numeric, computed expression) yields no name and is skipped.
        const name =
          prop.key.type === 'Identifier'
            ? prop.key.name
            : prop.key.type === 'StringLiteral'
              ? prop.key.value
              : undefined;
        if (name === undefined) continue;

        const call = prop.value;
        if (!isActionCall(call)) continue;

        entries.push({ name, call });
      }
    }
  }

  return entries;
}
