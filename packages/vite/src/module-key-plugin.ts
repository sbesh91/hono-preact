import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { CallExpression } from '@babel/types';
import type { Plugin } from 'vite';
import { deriveModuleKey } from './module-key.js';

/**
 * Transforms `.server.*` files to inject a stable module-level
 * `__moduleKey` export and to thread that key into `defineLoader` calls.
 * The key is path-derived (see `deriveModuleKey`), so it survives builds
 * and HMR, and is unique per file.
 *
 * Pairs with `serverOnlyPlugin`, which transforms client-side imports of
 * `.server.*` files. Both plugins compute the same key from the same
 * absolute path + viteRoot.
 */
export function moduleKeyPlugin(): Plugin {
  let viteRoot: string | undefined;
  return {
    name: 'module-key',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root;
    },
    transform(code: string, id: string) {
      if (viteRoot === undefined) return;
      if (!/\.server\.[jt]sx?$/.test(id)) return;
      if (!id.startsWith(viteRoot + '/')) return;

      const key = deriveModuleKey(id, viteRoot);
      const s = new MagicString(code);
      s.prepend(`export const __moduleKey = ${JSON.stringify(key)};\n`);

      // Walk the AST for top-level CallExpressions whose callee is the
      // identifier `defineLoader` and which have exactly one argument.
      // Rewrite to `defineLoader(<arg>, { __moduleKey: '<key>' })`.
      let ast;
      try {
        ast = parse(code, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
          errorRecovery: true,
        });
      } catch {
        // If the file fails to parse we still emit the prepended
        // __moduleKey so the routing layer works even if loader threading
        // doesn't. Surface the parse error to Vite so the user sees it.
        return { code: s.toString(), map: s.generateMap({ hires: true }) };
      }

      const visitCall = (node: CallExpression) => {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'defineLoader' ||
          node.arguments.length !== 1
        ) {
          return;
        }
        const arg = node.arguments[0];
        if (arg.type === 'StringLiteral') return; // single-arg string literal isn't a valid defineLoader form; skip to avoid garbling
        const insertAt = arg.end;
        if (insertAt == null) return;
        s.appendRight(
          insertAt,
          `, { __moduleKey: ${JSON.stringify(key)} }`
        );
      };

      // Top-level statement walk. defineLoader is overwhelmingly used at
      // module scope; we don't recurse into nested function bodies to keep
      // the plugin cheap.
      for (const stmt of ast.program.body) {
        if (
          stmt.type === 'ExportNamedDeclaration' &&
          stmt.declaration?.type === 'VariableDeclaration'
        ) {
          for (const decl of stmt.declaration.declarations) {
            if (decl.init?.type === 'CallExpression') visitCall(decl.init);
          }
        } else if (
          stmt.type === 'VariableDeclaration'
        ) {
          for (const decl of stmt.declarations) {
            if (decl.init?.type === 'CallExpression') visitCall(decl.init);
          }
        }
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
