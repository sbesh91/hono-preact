import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

function moduleNameFromSource(importSource: string): string {
  return importSource
    .split('/')
    .pop()!
    .replace(/\.server(\.[jt]sx?)?$/, '');
}

function extractCacheName(
  importerPath: string,
  importSource: string,
  fallbackModuleName: string
): string {
  // Resolve the import source relative to the importer.
  const importerDir = path.dirname(importerPath);
  const baseResolved = path.resolve(importerDir, importSource);
  // Try common TS/JS extensions.
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
        const src = fs.readFileSync(candidate, 'utf8');
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
                decl.id.name === 'cache' &&
                decl.init?.type === 'CallExpression' &&
                decl.init.callee.type === 'Identifier' &&
                decl.init.callee.name === 'createCache'
              ) {
                const arg = decl.init.arguments[0];
                if (arg?.type === 'StringLiteral') return arg.value;
              }
            }
          }
        }
      } catch {
        // Source-parse failure — fall through to the fallback.
      }
      break; // file exists but no extractable name; don't keep trying extensions
    }
  }
  return fallbackModuleName;
}

export function serverOnlyPlugin(): Plugin {
  return {
    name: 'server-only',
    enforce: 'pre',
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

      const isServerImport = (node: unknown): node is ImportDeclaration =>
        (node as ImportDeclaration).type === 'ImportDeclaration' &&
        /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value);

      const serverImports = ast.program.body.filter(isServerImport);
      if (serverImports.length === 0) return;

      const s = new MagicString(code);
      const needsCacheImport = new Set<string>();

      for (const serverImport of [...serverImports].reverse()) {
        const moduleName = moduleNameFromSource(serverImport.source.value);
        const stubs: string[] = [];

        for (const specifier of serverImport.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            stubs.push(
              `const ${specifier.local.name} = async ({ location }) => {\n` +
              `  const res = await fetch('/__loaders', {\n` +
              `    method: 'POST',\n` +
              `    headers: { 'Content-Type': 'application/json' },\n` +
              `    body: JSON.stringify({ module: ${JSON.stringify(moduleName)}, location: { path: location.path, pathParams: location.pathParams, query: location.query } }),\n` +
              `  });\n` +
              `  if (!res.ok) {\n` +
              `    const body = await res.json().catch(() => ({}));\n` +
              `    throw new Error(body.error ?? \`Loader failed with status \${res.status}\`);\n` +
              `  }\n` +
              `  return res.json();\n` +
              `};`
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
              `const ${specifier.local.name} = new Proxy({}, { get(_, action) { return { __module: ${JSON.stringify(moduleName)}, __action: String(action) }; } });`
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'loader'
          ) {
            stubs.push(
              `const ${specifier.local.name} = {\n` +
              `  __id: Symbol.for('@hono-preact/loader:${moduleName}'),\n` +
              `  fn: async ({ location }) => {\n` +
              `    const res = await fetch('/__loaders', {\n` +
              `      method: 'POST',\n` +
              `      headers: { 'Content-Type': 'application/json' },\n` +
              `      body: JSON.stringify({ module: ${JSON.stringify(moduleName)}, location: { path: location.path, pathParams: location.pathParams, query: location.query } }),\n` +
              `    });\n` +
              `    if (!res.ok) {\n` +
              `      const body = await res.json().catch(() => ({}));\n` +
              `      throw new Error(body.error ?? \`Loader failed with status \${res.status}\`);\n` +
              `    }\n` +
              `    return res.json();\n` +
              `  },\n` +
              `};`
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'cache'
          ) {
            const cacheName = extractCacheName(id, serverImport.source.value, moduleName);
            // Use a per-source unique alias to avoid collisions when multiple .server.ts
            // files contribute cache imports to the same consumer.
            const aliasSuffix = moduleName.replace(/[^a-zA-Z0-9_$]/g, '_');
            needsCacheImport.add(aliasSuffix);
            stubs.push(
              `const ${specifier.local.name} = __$createCache_${aliasSuffix}(${JSON.stringify(cacheName)});`
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
        }
      }

      if (needsCacheImport.size > 0) {
        const importDeclarations = [...needsCacheImport]
          .map(
            (suffix) =>
              `import { createCache as __$createCache_${suffix} } from '@hono-preact/iso';`
          )
          .join('\n');
        s.prepend(importDeclarations + '\n');
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
