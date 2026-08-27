import { parse } from '@babel/parser';
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
          const named = node;
          if (named.exportKind === 'type') continue;

          for (const s of named.specifiers) {
            namedExports.push(
              s.exported.type === 'Identifier'
                ? s.exported.name
                : s.exported.value
            );
          }
          const decl = named.declaration;
          if (decl) {
            switch (decl.type) {
              case 'FunctionDeclaration':
              case 'ClassDeclaration':
              case 'TSEnumDeclaration':
                if (decl.id) namedExports.push(decl.id.name);
                break;
              case 'VariableDeclaration':
                for (const d of decl.declarations) {
                  if (d.id.type === 'Identifier') namedExports.push(d.id.name);
                }
                break;
              case 'TSInterfaceDeclaration':
              case 'TSTypeAliasDeclaration':
                // Type-only shapes that can slip past exportKind === 'type' in
                // some parser configurations; erased at runtime, nothing to
                // whitelist.
                break;
              case 'TSDeclareFunction':
                // An ambient `declare function` or an overload signature.
                // Neither exists at runtime: the ambient form is erased
                // entirely, and an overload signature has no body of its own,
                // it is a type annotation on the implementation declared
                // right after it. That implementation is a real
                // FunctionDeclaration and gets whitelisted on its own.
                break;
              default:
                errors.push(
                  `${id}: unsupported export declaration (${decl.type}) in a .server file. ` +
                    `.server files may only export ${ALLOWED_NAMED_EXPORTS_LIST}.`
                );
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
