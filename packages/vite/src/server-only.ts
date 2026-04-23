import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';

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
              s.imported.name === 'serverGuards')
        );

      const serverImports = ast.program.body.filter(isServerImport);
      if (serverImports.length === 0) return;

      const s = new MagicString(code);

      // Process in reverse order to preserve character offsets
      for (const serverImport of [...serverImports].reverse()) {
        const stubs: string[] = [];

        for (const specifier of serverImport.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            stubs.push(`const ${specifier.local.name} = async () => ({});`);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverGuards'
          ) {
            stubs.push(`const ${specifier.local.name} = [];`);
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
