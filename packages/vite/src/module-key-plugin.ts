import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { CallExpression } from '@babel/types';
import type { Plugin } from 'vite';
import { deriveModuleKey } from './module-key.js';
import { parseServerLoaders } from './server-loaders-parser.js';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

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
    // transform receives an `options.ssr` argument from Vite, but we want
    // __moduleKey injected into both the client and SSR builds (so the SSR
    // runtime sees the same routing key the handler reads), so we ignore the
    // flag and always run.
    transform(code: string, id: string) {
      if (viteRoot === undefined) return;
      if (!/\.server\.[jt]sx?$/.test(id)) return;
      if (!id.startsWith(viteRoot + '/')) return;
      if (/^\s*export\s+const\s+__moduleKey\s*=/m.test(code)) return;

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
          plugins: BABEL_PARSER_PLUGINS,
          errorRecovery: true,
        });
      } catch {
        // If the file fails to parse we still emit the prepended
        // __moduleKey so the routing layer works even if loader threading
        // doesn't. Surface the parse error to Vite so the user sees it.
        return { code: s.toString(), map: s.generateMap({ hires: true }) };
      }

      // Rewrite a defineLoader call to include __moduleKey and, when inside
      // a serverLoaders object, __loaderName. Handles both the single-arg
      // form (appends a new opts object) and the two-arg form (merges into
      // the existing opts ObjectExpression).
      const visitCallWithName = (node: CallExpression, loaderName: string | undefined) => {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'defineLoader'
        ) {
          return;
        }
        if (node.arguments.length === 0 || node.arguments.length > 2) return;
        const fnArg = node.arguments[0];
        if (fnArg.type === 'StringLiteral') return; // not a valid defineLoader fn form; skip

        if (node.arguments.length === 1) {
          const insertAt = fnArg.end;
          if (insertAt == null) return;
          const namePart = loaderName ? `, __loaderName: ${JSON.stringify(loaderName)}` : '';
          s.appendRight(
            insertAt,
            `, { __moduleKey: ${JSON.stringify(key)}${namePart} }`
          );
          return;
        }

        // arguments.length === 2: merge __moduleKey/__loaderName into the
        // existing opts object literal. Bail if it isn't an ObjectExpression.
        const optsArg = node.arguments[1];
        if (optsArg.type !== 'ObjectExpression') return;
        const insertAt = optsArg.properties[0]?.start ?? (optsArg.start! + 1);
        const namePart = loaderName ? `__loaderName: ${JSON.stringify(loaderName)}, ` : '';
        s.appendRight(
          insertAt,
          `__moduleKey: ${JSON.stringify(key)}, ${namePart}`
        );
      };

      // Walk serverLoaders entries via the shared parser, then mutate each call.
      for (const entry of parseServerLoaders(ast.program)) {
        visitCallWithName(entry.call, entry.name);
      }

      // Top-level fallthrough: legacy `export const loader = defineLoader(...)`
      // (single-loader path). defineLoader is overwhelmingly used at module
      // scope; we don't recurse into nested function bodies to keep the plugin cheap.
      for (const stmt of ast.program.body) {
        if (
          stmt.type === 'ExportNamedDeclaration' &&
          stmt.declaration?.type === 'VariableDeclaration'
        ) {
          for (const decl of stmt.declaration.declarations) {
            if (
              decl.id.type === 'Identifier' &&
              decl.id.name !== 'serverLoaders' &&
              decl.init?.type === 'CallExpression'
            ) {
              visitCallWithName(decl.init, undefined);
            }
          }
        }
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
