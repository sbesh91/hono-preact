import { parse } from '@babel/parser';
import type { ExportNamedDeclaration } from '@babel/types';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';
import {
  RECOGNIZED_SERVER_EXPORTS,
  RECOGNIZED_SERVER_EXPORTS_SET,
} from './server-exports-contract.js';
import { findUseExports } from './server-loaders-parser.js';

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

      // F3: loaderUse / actionUse must resolve to an array at runtime so
      // the dispatcher receives a real ReadonlyArray. We cannot statically
      // prove that an identifier (e.g. `loaderUse = requireSession`
      // re-exporting an array from another module) holds an array, so we
      // reject only the obviously-wrong literal shapes here. There is no
      // runtime backstop, so an indirect (identifier) non-array value
      // cannot be caught until the middleware chain runs. The literal
      // denylist covers the canonical typo case (`loaderUse =
      // singleMwObject`). findUseExports is shared with
      // server-loaders-parser so the recognized-name list stays in one
      // place.
      const REJECTED_LITERAL_TYPES = new Set([
        'ObjectExpression',
        'NumericLiteral',
        'StringLiteral',
        'BooleanLiteral',
        'NullLiteral',
        'RegExpLiteral',
        'TemplateLiteral',
        'BigIntLiteral',
      ]);
      for (const useExport of findUseExports(ast.program)) {
        if (useExport.init == null) continue;
        if (REJECTED_LITERAL_TYPES.has(useExport.init.type)) {
          errors.push(
            `${id}: \`${useExport.name}\` must be an array literal or an ` +
              `identifier that points to an array ` +
              `(e.g. \`export const ${useExport.name} = [requireAuth]\` or ` +
              `\`export const ${useExport.name} = requireSession\`). ` +
              `A non-array value silently disables the middleware at runtime.`
          );
        }
      }

      const disallowedExports = namedExports.filter(
        (n) => !RECOGNIZED_SERVER_EXPORTS_SET.has(n)
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
