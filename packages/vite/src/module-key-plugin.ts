import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { CallExpression } from '@babel/types';
import type { Plugin } from 'vite';
import {
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from '@hono-preact/iso/internal/runtime';
import { deriveModuleKey } from './module-key.js';
import { isLoaderCall, parseServerLoaders } from './server-loaders-parser.js';
import { isActionCall, parseServerActions } from './server-actions-parser.js';
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
 * `__moduleKey` export and to thread that key into `defineLoader` and
 * `defineAction` calls (the latter also carrying the action name, so the
 * SSR-rendered `<Form>` emits real `__module`/`__action` hidden inputs).
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

      // Inject an opts object as the trailing argument of a matched call.
      // Handles both the single-arg form (appends a fresh `, { ... }` after the
      // fn) and the two-arg form (merges the extra properties into the head of
      // the existing opts ObjectExpression). `matches` gates which calls are
      // rewritten; `appendText` is the full trailing-opts fragment for the
      // single-arg form; `mergeText` is the property fragment inserted before
      // the first existing property for the two-arg form. Shared by the loader
      // (`__moduleKey`/`__loaderName`) and action (`__module`/`__action`)
      // threading below so both mutate calls through one code path.
      const injectTrailingOpts = (
        node: CallExpression,
        matches: (call: CallExpression) => boolean,
        appendText: string,
        mergeText: string
      ) => {
        if (!matches(node)) return;
        const args = node.arguments;
        // fn-first form: fn(fn) | fn(fn, opts). A nested helper call like
        // route.loader(liveStream({...})) is just `fn` here (single arg), so
        // opts are appended after it rather than merged into the helper's
        // object. More than two args is not a shape we produce; leave it.
        if (args.length === 0 || args.length > 2) return;
        if (args.length === 1) {
          const fnEnd = args[0].end;
          if (fnEnd == null) return;
          s.appendRight(fnEnd, appendText);
          return;
        }
        const opts = args[1];
        if (opts.type !== 'ObjectExpression') return;
        const insertAt = opts.properties[0]?.start ?? opts.start! + 1;
        s.appendRight(insertAt, mergeText);
      };

      // Rewrite a defineLoader call to include __moduleKey and, when inside a
      // serverLoaders object, __loaderName.
      const visitCallWithName = (
        node: CallExpression,
        loaderName: string | undefined
      ) => {
        const namePartAfter = loaderName
          ? `, ${LOADER_NAME_OPTION}: ${JSON.stringify(loaderName)}`
          : '';
        const namePartBefore = loaderName
          ? `${LOADER_NAME_OPTION}: ${JSON.stringify(loaderName)}, `
          : '';
        injectTrailingOpts(
          node,
          isLoaderCall,
          `, { ${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}${namePartAfter} }`,
          `${MODULE_KEY_EXPORT}: ${JSON.stringify(key)}, ${namePartBefore}`
        );
      };

      // Rewrite a defineAction call (or the route.action(...) member form) to
      // include __module + __action. Unlike a loader name, the action name is
      // always present (it is the serverActions property key), so both fields
      // are always threaded. This is what makes the SSR-side action ref carry
      // the identity <Form> renders into its hidden __module/__action inputs, so
      // a no-JS or pre-hydration native POST reaches the right action.
      const visitActionCall = (node: CallExpression, actionName: string) => {
        const keys = `${FORM_MODULE_FIELD}: ${JSON.stringify(key)}, ${FORM_ACTION_FIELD}: ${JSON.stringify(actionName)}`;
        injectTrailingOpts(node, isActionCall, `, { ${keys} }`, `${keys}, `);
      };

      // Walk serverLoaders entries via the shared parser, then mutate each call.
      for (const entry of parseServerLoaders(ast.program)) {
        visitCallWithName(entry.call, entry.name);
      }

      // Walk serverActions entries via the shared parser, then mutate each call.
      for (const entry of parseServerActions(ast.program)) {
        visitActionCall(entry.call, entry.name);
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
