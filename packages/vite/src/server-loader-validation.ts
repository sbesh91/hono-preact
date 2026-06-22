import { parse } from '@babel/parser';
import type { ExportNamedDeclaration } from '@babel/types';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';
import {
  RECOGNIZED_SERVER_EXPORTS,
  RECOGNIZED_SERVER_EXPORTS_SET,
} from './server-exports-contract.js';
const ALLOWED_NAMED_EXPORTS_LIST = RECOGNIZED_SERVER_EXPORTS.map(
  (n) => `'${n}'`
).join(', ');

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
        (n) => !RECOGNIZED_SERVER_EXPORTS_SET.has(n)
      );
      if (disallowedExports.length > 0) {
        errors.push(
          `${id}: .server files may only export ${ALLOWED_NAMED_EXPORTS_LIST} as named exports (found: ${disallowedExports.join(', ')}). ` +
            `Export loaders via \`serverLoaders\` and actions via \`serverActions\`.`
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
        !namedExports.includes('serverLoaders') &&
        !namedExports.includes('serverRooms') &&
        !namedExports.includes('serverSockets')
      ) {
        errors.push(
          `${id}: .server files must export at least one of 'serverLoaders', 'serverActions', 'serverRooms', or 'serverSockets'. ` +
            `Use \`export const serverLoaders = { default: defineLoader(fn) }\` to define loaders.`
        );
      }

      if (errors.length > 0) {
        this.error(errors.join('\n'));
      }
    },
  };
}
