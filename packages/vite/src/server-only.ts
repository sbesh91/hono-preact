import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { deriveModuleKey } from './module-key.js';

// Symbol-keyed accessor used by unit tests to verify `configResolved` fires
// and captures the root. Hidden behind a Symbol so it does not appear in IDE
// autocomplete for the public Plugin surface.
export const VITE_ROOT_ACCESSOR = Symbol.for('@hono-preact/vite/server-only/viteRoot');

function hashSuffix(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 8);
}

function readSource(importerPath: string, importSource: string): string | null {
  const importerDir = path.dirname(importerPath);
  const baseResolved = path.resolve(importerDir, importSource);
  const candidates = [
    baseResolved,
    baseResolved.replace(/\.js$/, '.ts'),
    baseResolved.replace(/\.jsx$/, '.tsx'),
    baseResolved.replace(/\.mjs$/, '.mts'),
    baseResolved + '.ts',
    baseResolved + '.tsx',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate, 'utf8');
      } catch {
        return null;
      }
    }
  }
  return null;
}

function extractStringArgFromVarDecl(
  src: string,
  exportName: string,
  factoryName: string,
  argIndex: number
): string | null {
  try {
    const ast = parse(src, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });
    for (const node of ast.program.body) {
      if (
        node.type === 'ExportNamedDeclaration' &&
        node.declaration?.type === 'VariableDeclaration'
      ) {
        for (const decl of node.declaration.declarations) {
          if (
            decl.id.type === 'Identifier' &&
            decl.id.name === exportName &&
            decl.init?.type === 'CallExpression' &&
            decl.init.callee.type === 'Identifier' &&
            decl.init.callee.name === factoryName
          ) {
            const arg = decl.init.arguments[argIndex];
            if (arg?.type === 'StringLiteral') return arg.value;
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractCacheName(
  importerPath: string,
  importSource: string,
  fallbackModuleName: string
): string {
  const src = readSource(importerPath, importSource);
  if (src === null) return fallbackModuleName;
  return (
    extractStringArgFromVarDecl(src, 'cache', 'createCache', 0) ?? fallbackModuleName
  );
}

function loaderFetchArrow(moduleName: string, indent: string): string {
  const i = indent;
  return (
    `async ({ location }) => {\n` +
    `${i}  const res = await fetch('/__loaders', {\n` +
    `${i}    method: 'POST',\n` +
    `${i}    headers: { 'Content-Type': 'application/json' },\n` +
    `${i}    body: JSON.stringify({ module: ${JSON.stringify(moduleName)}, location: { path: location.path, pathParams: location.pathParams, searchParams: location.searchParams } }),\n` +
    `${i}  });\n` +
    `${i}  if (!res.ok) {\n` +
    `${i}    const body = await res.json().catch(() => ({}));\n` +
    `${i}    throw new Error(body.error ?? \`Loader failed with status \${res.status}\`);\n` +
    `${i}  }\n` +
    `${i}  return res.json();\n` +
    `${i}}`
  );
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
      if (serverImports.length === 0) return;
      if (viteRoot === undefined) {
        this.warn(
          `serverOnlyPlugin: configResolved hasn't fired before transform on ${id}. ` +
          `.server.* imports will not be transformed; this can leak server code into the client bundle. ` +
          `Ensure moduleKeyPlugin and serverOnlyPlugin are added to the Vite config under the standard plugin pipeline.`
        );
        return;
      }
      const importerDir = path.dirname(id);

      const s = new MagicString(code);
      const needsCacheImport = new Set<string>();

      for (const serverImport of [...serverImports].reverse()) {
        if ((serverImport as unknown as { importKind?: string }).importKind === 'type') {
          s.overwrite(serverImport.start!, serverImport.end!, '');
          continue;
        }

        const absServerPath = path.resolve(importerDir, serverImport.source.value);
        const moduleKey = deriveModuleKey(absServerPath, viteRoot);
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
          const isDefaultImport =
            specifier.type === 'ImportDefaultSpecifier' ||
            (specifier.type === 'ImportSpecifier' &&
              specifier.imported.type === 'Identifier' &&
              specifier.imported.name === 'default');
          if (isDefaultImport) {
            stubs.push(
              `const ${specifier.local.name} = ${loaderFetchArrow(moduleKey, '')};`
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
            stubs.push(
              `const ${specifier.local.name} = new Proxy({}, { get(_, action) { return { __module: ${JSON.stringify(moduleKey)}, __action: String(action) }; } });`
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'loader'
          ) {
            stubs.push(
              `const ${specifier.local.name} = {\n` +
              `  __id: Symbol.for('@hono-preact/loader:${moduleKey}'),\n` +
              `  fn: ${loaderFetchArrow(moduleKey, '  ')},\n` +
              `};`
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'cache'
          ) {
            const cacheName = extractCacheName(id, serverImport.source.value, moduleKey);
            const aliasSuffix = hashSuffix(serverImport.source.value);
            needsCacheImport.add(aliasSuffix);
            stubs.push(
              `const ${specifier.local.name} = __$cacheRegistry_${aliasSuffix}.acquire(${JSON.stringify(cacheName)}, () => __$createCache_${aliasSuffix}(${JSON.stringify(cacheName)}));`
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
              `Allowed: default, loader, cache, serverGuards, serverActions, actionGuards.`
            );
          }
        }

        if (stubs.length > 0) {
          s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
        } else if (!hasValueSpecifier) {
          s.overwrite(serverImport.start!, serverImport.end!, '');
        }
      }

      if (needsCacheImport.size > 0) {
        const importDeclarations = [...needsCacheImport]
          .map(
            (suffix) =>
              `import { cacheRegistry as __$cacheRegistry_${suffix}, createCache as __$createCache_${suffix} } from '@hono-preact/iso';`
          )
          .join('\n');
        s.prepend(importDeclarations + '\n');
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  } as Plugin & { [VITE_ROOT_ACCESSOR]: () => string | undefined };
}
