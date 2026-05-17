import { parse } from '@babel/parser';
import type { ExportNamedDeclaration } from '@babel/types';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

const ALLOWED_NAMED_EXPORTS = new Set([
  'serverActions',
  'actionGuards',
  'serverLoaders',
]);
const ALLOWED_NAMED_EXPORTS_LIST = [...ALLOWED_NAMED_EXPORTS]
  .map((n) => `'${n}'`)
  .join(', ');

export function serverLoaderValidationPlugin(): Plugin {
  return {
    name: 'server-loader-validation',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!/\.server\.[jt]sx?$/.test(id)) return;

      const ast = parse(code, {
        sourceType: 'module',
        plugins: BABEL_PARSER_PLUGINS,
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
      if (hasDefault) {
        errors.push(
          `${id}: .server files may not use a default export. ` +
            `Use \`export const serverLoaders = { default: defineLoader(...) }\` instead.`
        );
      }
      if (
        !namedExports.includes('serverActions') &&
        !namedExports.includes('serverLoaders')
      ) {
        errors.push(
          `${id}: .server files must export either 'serverLoaders' or 'serverActions'. ` +
            `Use \`export const serverLoaders = { default: defineLoader(fn) }\` to define loaders.`
        );
      }

      if (errors.length > 0) {
        this.error(errors.join('\n'));
      }
    },
  };
}
