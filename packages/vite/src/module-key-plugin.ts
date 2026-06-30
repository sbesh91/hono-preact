import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { CallExpression } from '@babel/types';
import type { Plugin } from 'vite';
import {
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
} from '@hono-preact/iso/internal/runtime';
import { deriveModuleKey } from './module-key.js';
import { isLoaderCall, parseServerLoaders } from './server-loaders-parser.js';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

// Built from MODULE_KEY_EXPORT so the already-transformed check cannot
// drift from the emitted export. Assumes the name contains no regex
// metacharacters (it is a plain identifier).
const ALREADY_KEYED = new RegExp(
  `^\\s*export\\s+const\\s+${MODULE_KEY_EXPORT}\\s*=`,
  'm'
);

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
      if (ALREADY_KEYED.test(code)) return;

      const key = deriveModuleKey(id, viteRoot);
      const s = new MagicString(code);
      s.prepend(
        `export const ${MODULE_KEY_EXPORT} = ${JSON.stringify(key)};\n`
      );

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
      const visitCallWithName = (
        node: CallExpression,
        loaderName: string | undefined
      ) => {
        if (!isLoaderCall(node)) return;
        const args = node.arguments;
        if (args.length === 0) return;

        const namePartAfter = loaderName
          ? `, ${LOADER_NAME_OPTION}: ${JSON.stringify(loaderName)}`
          : '';
        const namePartBefore = loaderName
          ? `${LOADER_NAME_OPTION}: ${JSON.stringify(loaderName)}, `
          : '';
        const appendOptsAfter = (afterEnd: number) =>
          s.appendRight(
            afterEnd,
            `, { ${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}${namePartAfter} }`
          );
        const mergeInto = (opts: (typeof args)[number]) => {
          if (opts.type !== 'ObjectExpression') return;
          const insertAt = opts.properties[0]?.start ?? opts.start! + 1;
          s.appendRight(
            insertAt,
            `${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}, ${namePartBefore}`
          );
        };

        // fn-first form: defineLoader(fn) | defineLoader(fn, opts) and the
        // member form route.loader(fn) | route.loader(fn, opts). A nested
        // helper call like route.loader(liveStream({...})) is just `fn` here, so
        // opts are appended after it rather than merged into the helper's object.
        if (args.length > 2) return;
        if (args.length === 1) {
          const fnEnd = args[0].end;
          if (fnEnd == null) return;
          appendOptsAfter(fnEnd);
          return;
        }
        mergeInto(args[1]);
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
