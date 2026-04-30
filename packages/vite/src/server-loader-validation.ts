import { parse } from '@babel/parser';
import type { ExportNamedDeclaration } from '@babel/types';
import type { Plugin } from 'vite';

const ALLOWED_NAMED_EXPORTS = new Set(['serverGuards', 'serverActions', 'actionGuards', 'loader', 'cache']);
const ALLOWED_NAMED_EXPORTS_LIST = [...ALLOWED_NAMED_EXPORTS].map((n) => `'${n}'`).join(', ');

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
      const errors: string[] = [];

      for (const node of ast.program.body) {
        if (node.type === 'ExportDefaultDeclaration') {
          hasDefault = true;
        } else if (node.type === 'ExportAllDeclaration') {
          errors.push(
            `${id}: .server files may not use 'export * from ...'. Use explicit named exports only.`
          );
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
        (n) => !ALLOWED_NAMED_EXPORTS.has(n)
      );
      if (disallowedExports.length > 0) {
        errors.push(
          `${id}: .server files may only export ${ALLOWED_NAMED_EXPORTS_LIST} as named exports (found: ${disallowedExports.join(', ')}). ` +
            `Export the server loader as the default export only.`
        );
      }
      if (!hasDefault && !namedExports.includes('serverActions')) {
        errors.push(
          `${id}: .server files must have a default export. ` +
            `Export the server loader as: export default async function serverLoader(...) { ... }`
        );
      }

      if (errors.length > 0) {
        this.error(errors.join('\n'));
      }
    },
  };
}
