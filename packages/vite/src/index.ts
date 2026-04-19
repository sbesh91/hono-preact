import { parse } from '@babel/parser';
import type { ExportNamedDeclaration, ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

export function serverLoaderValidationPlugin(): Plugin {
  return {
    name: 'server-loader-validation',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!/\.server\.[jt]sx?$/.test(id)) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        errorRecovery: true,
      });

      let hasDefault = false;
      const namedExports: string[] = [];

      for (const node of ast.program.body) {
        if (node.type === 'ExportDefaultDeclaration') {
          hasDefault = true;
        } else if (node.type === 'ExportNamedDeclaration') {
          const named = node as ExportNamedDeclaration;
          if (named.exportKind === 'type') continue;

          for (const s of named.specifiers) {
            namedExports.push(
              s.exported.type === 'Identifier'
                ? s.exported.name
                : s.exported.value
            );
          }
          if (
            named.declaration?.type === 'FunctionDeclaration' &&
            named.declaration.id
          ) {
            namedExports.push(named.declaration.id.name);
          } else if (named.declaration?.type === 'VariableDeclaration') {
            for (const decl of named.declaration.declarations) {
              if (decl.id.type === 'Identifier')
                namedExports.push(decl.id.name);
            }
          }
        }
      }

      const disallowedExports = namedExports.filter(
        (n) => n !== 'serverGuards'
      );
      if (disallowedExports.length > 0) {
        this.error(
          `${id}: .server files may only export 'serverGuards' as a named export (found: ${disallowedExports.join(', ')}). ` +
            `Export the server loader as the default export only.`
        );
      }
      if (!hasDefault) {
        this.error(
          `${id}: .server files must have a default export. ` +
            `Export the server loader as: export default async function serverLoader(...) { ... }`
        );
      }
    },
  };
}

export function serverOnlyPlugin(): Plugin {
  return {
    name: 'server-only',
    enforce: 'pre',
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return;
      if (/\.server\.[jt]sx?$/.test(id)) return;
      if (!code.includes('.server')) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        errorRecovery: true,
      });

      const isServerImport = (node: unknown): node is ImportDeclaration =>
        (node as ImportDeclaration).type === 'ImportDeclaration' &&
        /\.server(\.[jt]sx?)?$/.test(
          (node as ImportDeclaration).source.value
        ) &&
        (node as ImportDeclaration).specifiers.some(
          (s) =>
            s.type === 'ImportDefaultSpecifier' ||
            (s.type === 'ImportSpecifier' &&
              s.imported.type === 'Identifier' &&
              s.imported.name === 'serverGuards')
        );

      const serverImport = ast.program.body.find(isServerImport);
      if (!serverImport) return;

      const stubs: string[] = [];

      for (const s of serverImport.specifiers) {
        if (s.type === 'ImportDefaultSpecifier') {
          stubs.push(`const ${s.local.name} = async () => ({});`);
        } else if (
          s.type === 'ImportSpecifier' &&
          s.imported.type === 'Identifier' &&
          s.imported.name === 'serverGuards'
        ) {
          stubs.push(`const ${s.local.name} = [];`);
        }
      }

      if (stubs.length === 0) return;

      const s = new MagicString(code);
      s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  };
}
