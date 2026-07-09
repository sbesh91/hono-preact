import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type {
  Expression,
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

// A dynamic `import()` whose specifier is NOT statically resolvable but whose
// static text clearly targets a `.server` module (e.g. a template literal with
// an interpolation whose trailing text is `.server.js`). It cannot be stubbed to
// a single module, so the plugin fails the build closed rather than letting
// rollup resolve/bundle the real server body into the client.
export type UnstubbableServerImport = {
  start: number;
  end: number;
};

// Matches a specifier (or a template-literal segment) that ends in the `.server`
// module convention (`.server`, `.server.ts`, `.server.jsx`, ...).
const SERVER_SPECIFIER_RE = /\.server(\.[jt]sx?)?$/;

// Read the constant specifier string from a dynamic-import argument, or null
// when the argument is not a compile-time-static string. Two static forms
// resolve to a single specifier: a `StringLiteral` (`import('./x.server')`) and
// a no-substitution `TemplateLiteral` (`` import(`./x.server`) ``, one quasi and
// zero expressions). Both name exactly one module, so both must be stubbed --
// treating only the quote form as static is the leak: a backtick specifier would
// otherwise ride through and bundle the real `.server` body into the client.
function staticImportSpecifier(
  arg: Expression | null | undefined
): string | null {
  if (!arg) return null;
  if (arg.type === 'StringLiteral') return arg.value;
  if (
    arg.type === 'TemplateLiteral' &&
    arg.expressions.length === 0 &&
    arg.quasis.length === 1
  ) {
    return arg.quasis[0].value.cooked ?? null;
  }
  return null;
}

// True when a NON-static dynamic-import argument still visibly targets a
// `.server` module: a template literal WITH interpolation whose final quasi ends
// in a `.server` extension (`` import(`./${name}.server.js`) ``). Such a
// specifier cannot be resolved to one module at transform time, so it is a
// fail-closed case, not a stub. Anchored on the trailing quasi so `.server-utils`
// or a bare `./${name}` never trips it (no false positives).
function templateTargetsServerModule(
  arg: Expression | null | undefined
): boolean {
  if (!arg || arg.type !== 'TemplateLiteral' || arg.expressions.length === 0) {
    return false;
  }
  const lastQuasi = arg.quasis[arg.quasis.length - 1]?.value.cooked ?? '';
  return SERVER_SPECIFIER_RE.test(lastQuasi);
}

// Collect `import('...server...')` dynamic-import call sites. Babel parses a
// dynamic import as an `ImportExpression` whose `source` is the specifier.
//
// - `found`: sites whose source is a STATIC `.server[.jt]sx?` specifier (quoted
//   or a no-substitution template literal). The transform replaces the body with
//   a resolved stub.
// - `unstubbable` (optional): sites whose source is a non-static specifier that
//   still visibly targets a `.server` module. These cannot be stubbed; the
//   caller fails the build closed rather than leaking the real body.
export function findDynamicServerImports(
  ast: File | Node,
  found: DynamicServerImport[],
  unstubbable?: UnstubbableServerImport[]
): void {
  traverse(ast, {
    ImportExpression(path: NodePath<ImportExpression>) {
      const { node } = path;
      // `source` is typed non-null, but under `errorRecovery` a malformed
      // `import()` (e.g. no argument) yields an ImportExpression with no
      // source, so read it through the static-specifier helper which guards
      // the missing/non-static cases.
      const specifier = staticImportSpecifier(node.source);
      if (specifier !== null) {
        if (SERVER_SPECIFIER_RE.test(specifier)) {
          found.push({ start: node.start!, end: node.end!, source: specifier });
        }
        return;
      }
      if (unstubbable && templateTargetsServerModule(node.source)) {
        unstubbable.push({ start: node.start!, end: node.end! });
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
