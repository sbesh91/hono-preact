import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from '@babel/parser';
import type { ImportDeclaration } from '@babel/types';
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import {
  MODULE_KEY_EXPORT,
  LOADER_NAME_OPTION,
  FORM_MODULE_FIELD,
  FORM_ACTION_FIELD,
} from '@hono-preact/iso/internal/runtime';
import { deriveModuleKey } from './module-key.js';
import { parseServerLoaders, readParamsOpt } from './server-loaders-parser.js';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';
import { RECOGNIZED_SERVER_EXPORTS } from './server-exports-contract.js';

// The unknown-specifier rejection message lists every recognized server
// export so a user can immediately see the valid set. The list is derived
// from the shared contract so it cannot drift from the validation plugin.
const ALLOWED_SPECIFIERS_LIST = RECOGNIZED_SERVER_EXPORTS.join(', ');

// Symbol-keyed accessor used by unit tests to verify `configResolved` fires
// and captures the root. Hidden behind a Symbol so it does not appear in IDE
// autocomplete for the public Plugin surface.
export const VITE_ROOT_ACCESSOR = Symbol.for(
  '@hono-preact/vite/server-only/viteRoot'
);

/**
 * Reads a .server.* file synchronously and extracts the `params` option from
 * each entry in the `serverLoaders` ObjectExpression. Returns a map of
 * { loaderName -> params } for loaders that declare non-default params.
 * Returns an empty object if the file cannot be parsed or has no serverLoaders.
 */
function readSourceWithExtensionFallback(absServerPath: string): string | null {
  // TypeScript NodeNext convention: source code imports `.server.js` even
  // though the file on disk is `.server.ts` (or .tsx). Try the literal path
  // first (handles plain `.js` cases), then the TS-extension swaps.
  const tries = [
    absServerPath,
    absServerPath.replace(/\.js$/, '.ts'),
    absServerPath.replace(/\.jsx$/, '.tsx'),
  ];
  for (const p of tries) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      // try next candidate
    }
  }
  return null;
}

function extractServerLoadersMeta(
  absServerPath: string
): Record<string, string[] | '*'> {
  const src = readSourceWithExtensionFallback(absServerPath);
  if (src == null) return {};

  let ast;
  try {
    ast = parse(src, {
      sourceType: 'module',
      plugins: BABEL_PARSER_PLUGINS,
      errorRecovery: true,
    });
  } catch {
    return {};
  }

  const entries = parseServerLoaders(ast.program);
  const meta: Record<string, string[] | '*'> = {};
  for (const entry of entries) {
    if (!entry.optsArg) continue;
    const params = readParamsOpt(entry.optsArg);
    if (params !== undefined) meta[entry.name] = params;
  }

  return meta;
}

type DynamicServerImport = { start: number; end: number; source: string };

function findDynamicServerImports(
  node: unknown,
  found: DynamicServerImport[]
): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) findDynamicServerImports(child, found);
    return;
  }
  const n = node as {
    type?: string;
    callee?: { type?: string };
    arguments?: Array<{ type?: string; value?: string }>;
    start?: number;
    end?: number;
  };
  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'Import' &&
    n.arguments?.[0]?.type === 'StringLiteral' &&
    typeof n.arguments[0].value === 'string' &&
    /\.server(\.[jt]sx?)?$/.test(n.arguments[0].value)
  ) {
    found.push({
      start: n.start!,
      end: n.end!,
      source: n.arguments[0].value,
    });
  }
  for (const key of Object.keys(node as object)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments'
    )
      continue;
    findDynamicServerImports((node as Record<string, unknown>)[key], found);
  }
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
        plugins: BABEL_PARSER_PLUGINS,
        errorRecovery: true,
      });

      for (const node of ast.program.body) {
        if (
          (node.type === 'ExportNamedDeclaration' ||
            node.type === 'ExportAllDeclaration') &&
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

      const dynamicServerImports: DynamicServerImport[] = [];
      findDynamicServerImports(ast.program, dynamicServerImports);

      if (serverImports.length === 0 && dynamicServerImports.length === 0)
        return;

      if (serverImports.length > 0 && viteRoot === undefined) {
        this.warn(
          `serverOnlyPlugin: configResolved hasn't fired before transform on ${id}. ` +
            `.server.* imports will not be transformed; this can leak server code into the client bundle. ` +
            `Ensure moduleKeyPlugin and serverOnlyPlugin are added to the Vite config under the standard plugin pipeline.`
        );
        return;
      }
      const importerDir = path.dirname(id);

      const s = new MagicString(code);
      let needsCreateLoaderStubImport = false;
      let needsUseActionImport = false;

      for (const serverImport of [...serverImports].reverse()) {
        if (
          (serverImport as unknown as { importKind?: string }).importKind ===
          'type'
        ) {
          s.overwrite(serverImport.start!, serverImport.end!, '');
          continue;
        }

        // viteRoot is guaranteed defined here: the early-return above bails when
        // we have static imports without a viteRoot. Dynamic-only files skip this
        // loop entirely.
        const absServerPath = path.resolve(
          importerDir,
          serverImport.source.value
        );
        const moduleKey = deriveModuleKey(absServerPath, viteRoot as string);
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
          if (
            (specifier as unknown as { importKind?: string }).importKind ===
            'type'
          ) {
            continue;
          }
          hasValueSpecifier = true;
          if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverLoaders'
          ) {
            needsCreateLoaderStubImport = true;
            const absServerPath = path.resolve(
              importerDir,
              serverImport.source.value
            );
            const loadersMeta = extractServerLoadersMeta(absServerPath);
            const metaVar = `__$serverLoadersMeta_${specifier.local.name}`;
            const metaJson = JSON.stringify(loadersMeta);
            stubs.push(
              `const ${metaVar} = ${metaJson};\n` +
                `const ${specifier.local.name} = new Proxy({}, {\n` +
                `  get(_, name) {\n` +
                `    const __meta = ${metaVar}[String(name)];\n` +
                `    return __$createLoaderStub_hpiso({\n` +
                `      ${MODULE_KEY_EXPORT}: ${JSON.stringify(moduleKey)},\n` +
                `      ${LOADER_NAME_OPTION}: String(name),\n` +
                `      params: __meta,\n` +
                `    });\n` +
                `  }\n` +
                `});`
            );
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            (specifier.imported.name === 'pageUse' ||
              specifier.imported.name === 'loaderUse' ||
              specifier.imported.name === 'actionUse')
          ) {
            // Middleware-carrying named exports never run on the client; the
            // client only needs the array to exist so user imports don't
            // crash. The real `use` arrays live on the server side and are
            // wired into the dispatcher via pageUse resolvers.
            stubs.push(`const ${specifier.local.name} = [];`);
          } else if (
            specifier.type === 'ImportSpecifier' &&
            specifier.imported.type === 'Identifier' &&
            specifier.imported.name === 'serverActions'
          ) {
            needsUseActionImport = true;
            // F9: each `serverActions.<name>` read constructs a fresh
            // stub object, so `serverActions.create !== serverActions.create`
            // across two reads. Not new in the middleware refactor, but
            // worth flagging: callers that store the stub in a variable
            // and treat it as a stable identity (e.g. `Map` keys) will
            // surprise themselves. The contract is "stubs are descriptor
            // records, not singletons."
            stubs.push(
              `const ${specifier.local.name} = new Proxy({}, {\n` +
                `  get(_, action) {\n` +
                `    const stub = { ${FORM_MODULE_FIELD}: ${JSON.stringify(moduleKey)}, ${FORM_ACTION_FIELD}: String(action) };\n` +
                `    stub.useAction = (opts) => __$useAction_hpiso(stub, opts);\n` +
                `    return stub;\n` +
                `  }\n` +
                `});`
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
                `Allowed: ${ALLOWED_SPECIFIERS_LIST}.`
            );
          }
        }

        if (stubs.length > 0) {
          s.overwrite(serverImport.start!, serverImport.end!, stubs.join('\n'));
        } else if (!hasValueSpecifier) {
          s.overwrite(serverImport.start!, serverImport.end!, '');
        }
      }

      for (const imp of [...dynamicServerImports].reverse()) {
        // Preserve __moduleKey in the client stub so callers (e.g.
        // defineRoutes' wrapWithRouteLocations) can identify which server
        // module this lazy import represents, even though the body is
        // replaced with an empty resolved promise.
        let stubContent = '{}';
        if (viteRoot !== undefined) {
          const absServerPath = path.resolve(importerDir, imp.source);
          const moduleKey = deriveModuleKey(absServerPath, viteRoot as string);
          if (!moduleKey.startsWith('..')) {
            stubContent = `{ ${MODULE_KEY_EXPORT}: ${JSON.stringify(moduleKey)} }`;
          }
        }
        s.overwrite(imp.start, imp.end, `Promise.resolve(${stubContent})`);
      }

      if (needsCreateLoaderStubImport) {
        s.prepend(
          `import { __$createLoaderStub_hpiso } from 'hono-preact/internal/runtime';\n`
        );
      }
      if (needsUseActionImport) {
        s.prepend(
          `import { useAction as __$useAction_hpiso } from 'hono-preact';\n`
        );
      }

      return { code: s.toString(), map: s.generateMap({ hires: true }) };
    },
  } as Plugin & { [VITE_ROOT_ACCESSOR]: () => string | undefined };
}
