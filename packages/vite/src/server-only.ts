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
        /\.server(\.[jt]sx?)?$/.test((node as ImportDeclaration).source.value) &&
        (node as ImportDeclaration).specifiers.some(
          (s) =>
            s.type === 'ImportDefaultSpecifier' ||
            (s.type === 'ImportSpecifier' &&
              s.imported.type === 'Identifier' &&
              (s.imported.name === 'serverGuards' ||
                s.imported.name === 'actionGuards' ||
                s.imported.name === 'serverActions'))
        );

      const serverImports = ast.program.body.filter(isServerImport);
      if (serverImports.length === 0) return;

      const s = new MagicString(code);

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
          }
        }

        if (stubs.length > 0) {
          s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
        }
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
