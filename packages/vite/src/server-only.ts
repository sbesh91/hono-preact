import * as path from 'node:path';
import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { deriveModuleKey } from './module-key.js';

// Symbol-keyed accessor used by unit tests to verify `configResolved` fires
// and captures the root. Hidden behind a Symbol so it does not appear in IDE
// autocomplete for the public Plugin surface.
export const VITE_ROOT_ACCESSOR = Symbol.for('@hono-preact/vite/server-only/viteRoot');

type DynamicServerImport = { start: number; end: number; source: string };

function findDynamicServerImports(node: unknown, found: DynamicServerImport[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) findDynamicServerImports(child, found);
    return;
  }
  const n = node as {
    type?: string;
    callee?: { type?: string };
    arguments?: Array<{ type?: string; value?: string }>;
    start?: number;
    end?: number;
  };
  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'Import' &&
    n.arguments?.[0]?.type === 'StringLiteral' &&
    typeof n.arguments[0].value === 'string' &&
    /\.server(\.[jt]sx?)?$/.test(n.arguments[0].value)
  ) {
    found.push({
      start: n.start!,
      end: n.end!,
      source: n.arguments[0].value,
    });
  }
  for (const key of Object.keys(node as object)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    findDynamicServerImports((node as Record<string, unknown>)[key], found);
  }
}

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
        plugins: ['typescript', 'jsx'],
        errorRecovery: true,
      });

      for (const node of ast.program.body) {
        if (
          (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
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

      const isServerImport = (node: unknown): node is ImportDeclaration =>
        (node as ImportDeclaration).type === 'ImportDeclaration' &&
        /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value);

      const serverImports = ast.program.body.filter(isServerImport);

      const dynamicServerImports: DynamicServerImport[] = [];
      findDynamicServerImports(ast.program, dynamicServerImports);

      if (serverImports.length === 0 && dynamicServerImports.length === 0) return;

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
        if ((serverImport as unknown as { importKind?: string }).importKind === 'type') {
          s.overwrite(serverImport.start!, serverImport.end!, '');
          continue;
        }

        // viteRoot is guaranteed defined here: the early-return above bails when
        // we have static imports without a viteRoot. Dynamic-only files skip this
        // loop entirely.
        const absServerPath = path.resolve(importerDir, serverImport.source.value);
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
          if ((specifier as unknown as { importKind?: string }).importKind === 'type') {
            continue;
          }
          hasValueSpecifier = true;
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverLoaders'
          ) {
            needsCreateLoaderStubImport = true;
            stubs.push(
              `const ${specifier.local.name} = new Proxy({}, {\n` +
              `  get(_, name) {\n` +
              `    return __$createLoaderStub_hpiso({\n` +
              `      __moduleKey: ${JSON.stringify(moduleKey)},\n` +
              `      __loaderName: String(name),\n` +
              `    });\n` +
              `  }\n` +
              `});`
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            (specifier.imported.name === 'serverGuards' ||
              specifier.imported.name === 'actionGuards')
          ) {
            stubs.push(`const ${specifier.local.name} = [];`);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverActions'
          ) {
            needsUseActionImport = true;
            stubs.push(
              `const ${specifier.local.name} = new Proxy({}, {\n` +
              `  get(_, action) {\n` +
              `    const stub = { __module: ${JSON.stringify(moduleKey)}, __action: String(action) };\n` +
              `    stub.useAction = (opts) => __$useAction_hpiso(stub, opts);\n` +
              `    return stub;\n` +
              `  }\n` +
              `});`
            );
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
              `Allowed: serverLoaders, serverGuards, serverActions, actionGuards.`
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
        s.overwrite(imp.start, imp.end, 'Promise.resolve({})');
      }

      if (needsCreateLoaderStubImport) {
        s.prepend(`import { __$createLoaderStub_hpiso } from '@hono-preact/iso/internal';\n`);
      }
      if (needsUseActionImport) {
        s.prepend(`import { useAction as __$useAction_hpiso } from '@hono-preact/iso';\n`);
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  } as Plugin & { [VITE_ROOT_ACCESSOR]: () => string | undefined };
}
