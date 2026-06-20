import * as path from 'node:path';
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { MODULE_KEY_EXPORT } from '@hono-preact/iso/internal/runtime';
import { deriveModuleKey } from './module-key.js';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';
import { RECOGNIZED_SERVER_EXPORTS } from './server-exports-contract.js';
import {
  findDynamicServerImports,
  isServerImport,
  type DynamicServerImport,
} from './ast-walkers.js';
import { extractServerLoadersMeta } from './source-extraction.js';
import { loaderStubSource, actionStubSource } from './stub-templates.js';

// The unknown-specifier rejection message lists every recognized server
// export so a user can immediately see the valid set. The list is derived
// from the shared contract so it cannot drift from the validation plugin.
const ALLOWED_SPECIFIERS_LIST = RECOGNIZED_SERVER_EXPORTS.join(', ');

// Symbol-keyed accessor used by unit tests to verify `configResolved` fires
// and captures the root. Hidden behind a Symbol so it does not appear in IDE
// autocomplete for the public Plugin surface.
export const VITE_ROOT_ACCESSOR = Symbol.for(
  '@hono-preact/vite/server-only/viteRoot'
);

export function serverOnlyPlugin(): Plugin {
  let viteRoot: string | undefined;
  return {
    name: 'server-only',
    enforce: 'pre',
    configResolved(config) {
      viteRoot = config.root;
    },
    [VITE_ROOT_ACCESSOR]: () => viteRoot,
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return;
      if (!/\.[jt]sx?$/.test(id)) return;
      if (/\.server\.[jt]sx?$/.test(id)) return;
      if (!code.includes('.server')) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: BABEL_PARSER_PLUGINS,
        errorRecovery: true,
      });

      for (const node of ast.program.body) {
        if (
          (node.type === 'ExportNamedDeclaration' ||
            node.type === 'ExportAllDeclaration') &&
          node.source &&
          /\.server(\.[jt]sx?)?$/.test(node.source.value)
        ) {
          throw new Error(
            `${id}: re-export from '${node.source.value}' (a .server.* module) is not supported. ` +
              `Import the named member directly instead, e.g. ` +
              `\`import { loader } from '${node.source.value}';\``
          );
        }
      }

      const serverImports = ast.program.body.filter(isServerImport);

      const dynamicServerImports: DynamicServerImport[] = [];
      findDynamicServerImports(ast, dynamicServerImports);

      if (serverImports.length === 0 && dynamicServerImports.length === 0)
        return;

      if (serverImports.length > 0 && viteRoot === undefined) {
        this.warn(
          `serverOnlyPlugin: configResolved hasn't fired before transform on ${id}. ` +
            `.server.* imports will not be transformed; this can leak server code into the client bundle. ` +
            `Ensure moduleKeyPlugin and serverOnlyPlugin are added to the Vite config under the standard plugin pipeline.`
        );
        return;
      }
      const importerDir = path.dirname(id);

      const s = new MagicString(code);
      let needsCreateLoaderStubImport = false;
      let needsUseActionImport = false;

      for (const serverImport of [...serverImports].reverse()) {
        // `import type { … } from './x.server'` is erased entirely. @babel/types
        // declares `importKind` on ImportDeclaration, so read it directly.
        if (serverImport.importKind === 'type') {
          s.overwrite(serverImport.start!, serverImport.end!, '');
          continue;
        }

        // viteRoot is guaranteed defined here: the early-return above bails when
        // we have static imports without a viteRoot. Dynamic-only files skip this
        // loop entirely.
        const absServerPath = path.resolve(
          importerDir,
          serverImport.source.value
        );
        const moduleKey = deriveModuleKey(absServerPath, viteRoot as string);
        if (moduleKey.startsWith('..')) {
          this.warn(
            `serverOnlyPlugin: import of '${serverImport.source.value}' from '${id}' resolves outside the Vite root (${viteRoot}). ` +
              `Generated module key '${moduleKey}' will not match any server-side moduleKeyPlugin output, so RPC calls will return 404. ` +
              `Move the .server.* file inside the Vite root, or restructure the import.`
          );
        }
        const stubs: string[] = [];
        let hasValueSpecifier = false;

        for (const specifier of serverImport.specifiers) {
          // Skip inline type-only specifiers (`import { type Foo }`). Only
          // ImportSpecifier carries `importKind`; narrow before reading it.
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.importKind === 'type'
          ) {
            continue;
          }
          hasValueSpecifier = true;
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverLoaders'
          ) {
            needsCreateLoaderStubImport = true;
            const absServerPath = path.resolve(
              importerDir,
              serverImport.source.value
            );
            const loadersMeta = extractServerLoadersMeta(absServerPath);
            stubs.push(
              loaderStubSource(specifier.local.name, moduleKey, loadersMeta)
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverActions'
          ) {
            needsUseActionImport = true;
            stubs.push(actionStubSource(specifier.local.name, moduleKey));
          } else {
            const importedName =
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier'
                ? specifier.imported.name
                : specifier.type === 'ImportNamespaceSpecifier'
                  ? '* as ' + specifier.local.name
                  : '<unknown>';
            throw new Error(
              `${id}: \`${importedName}\` is not a recognized export from a *.server.* module. ` +
                `Allowed: ${ALLOWED_SPECIFIERS_LIST}.`
            );
          }
        }

        if (stubs.length > 0) {
          s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
        } else if (!hasValueSpecifier) {
          s.overwrite(serverImport.start!, serverImport.end!, '');
        }
      }

      for (const imp of [...dynamicServerImports].reverse()) {
        // Preserve __moduleKey in the client stub so callers (e.g.
        // defineRoutes' wrapWithRouteLocations) can identify which server
        // module this lazy import represents, even though the body is
        // replaced with an empty resolved promise.
        let stubContent = '{}';
        if (viteRoot !== undefined) {
          const absServerPath = path.resolve(importerDir, imp.source);
          const moduleKey = deriveModuleKey(absServerPath, viteRoot as string);
          if (!moduleKey.startsWith('..')) {
            stubContent = `{ ${MODULE_KEY_EXPORT}: ${JSON.stringify(moduleKey)} }`;
          }
        }
        s.overwrite(imp.start, imp.end, `Promise.resolve(${stubContent})`);
      }

      if (needsCreateLoaderStubImport) {
        s.prepend(
          `import { __$createLoaderStub_hpiso } from 'hono-preact/internal/runtime';\n`
        );
      }
      if (needsUseActionImport) {
        s.prepend(
          `import { useAction as __$useAction_hpiso } from 'hono-preact';\n`
        );
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  } as Plugin & { [VITE_ROOT_ACCESSOR]: () => string | undefined };
}
