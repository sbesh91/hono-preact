import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import type { Plugin } from 'vite';

export interface GenerateServerEntrySourceOptions {
  layoutAbsPath: string;
  routesAbsPath: string;
  apiAbsPath: string | undefined;
}

export function generateServerEntrySource(
  opts: GenerateServerEntrySourceOptions
): string {
  const { layoutAbsPath, routesAbsPath, apiAbsPath } = opts;

  const apiImport = apiAbsPath
    ? `import userApp from '${apiAbsPath}';\n`
    : '';
  const apiMount = apiAbsPath ? `  .route('/', userApp)\n` : '';

  return (
    `import { Hono } from 'hono';\n` +
    `import { env } from '@hono-preact/iso';\n` +
    `import {\n` +
    `  actionsHandler,\n` +
    `  loadersHandler,\n` +
    `  location,\n` +
    `  renderPage,\n` +
    `  routeServerModules,\n` +
    `} from '@hono-preact/server';\n` +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    `\n` +
    `env.current = 'server';\n` +
    `const serverModules = routeServerModules(routes);\n` +
    `\n` +
    `export const app = new Hono()\n` +
    `  .post('/__loaders', loadersHandler(serverModules))\n` +
    `  .post('/__actions', actionsHandler(serverModules))\n` +
    apiMount +
    `  .use(location)\n` +
    `  .get('*', (c) => renderPage(c, <Layout context={c} />));\n` +
    `\n` +
    `export default app;\n`
  );
}

export type CatchAllWarning =
  | { kind: 'wildcard'; method: string; pattern: string; line: number | undefined }
  | { kind: 'notFound'; line: number | undefined };

const HONO_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'all',
  'on',
]);

const WILDCARD_PATTERNS = new Set(['*', '/*']);

export function findApiCatchAllRoutes(source: string): CatchAllWarning[] {
  const warnings: CatchAllWarning[] = [];

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });
  } catch {
    // If api.ts won't parse, the build will fail elsewhere with a clearer
    // error. Don't double-report.
    return warnings;
  }

  walk(ast.program, warnings);
  return warnings;
}

function walk(node: unknown, warnings: CatchAllWarning[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, warnings);
    return;
  }

  const n = node as {
    type?: string;
    callee?: {
      type?: string;
      property?: { type?: string; name?: string };
    };
    arguments?: Array<{ type?: string; value?: unknown }>;
    loc?: { start?: { line?: number } };
  };

  if (
    n.type === 'CallExpression' &&
    n.callee?.type === 'MemberExpression' &&
    n.callee.property?.type === 'Identifier' &&
    typeof n.callee.property.name === 'string'
  ) {
    const method = n.callee.property.name;
    const line = n.loc?.start?.line;

    if (method === 'notFound') {
      warnings.push({ kind: 'notFound', line });
    } else if (HONO_METHODS.has(method)) {
      const firstArg = n.arguments?.[0];
      if (
        firstArg?.type === 'StringLiteral' &&
        typeof firstArg.value === 'string' &&
        WILDCARD_PATTERNS.has(firstArg.value)
      ) {
        warnings.push({
          kind: 'wildcard',
          method,
          pattern: firstArg.value,
          line,
        });
      }
    }
  }

  for (const key of Object.keys(node as object)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    walk((node as Record<string, unknown>)[key], warnings);
  }
}

export const VIRTUAL_SERVER_ENTRY_ID = 'virtual:hono-preact/server';
const RESOLVED_ID = '\0' + VIRTUAL_SERVER_ENTRY_ID;

export interface ServerEntryPluginOptions {
  layout: string; // project-relative or absolute
  routes: string;
  api: string; // project-relative or absolute; absence treated as "no api"
}

export function serverEntryPlugin(opts: ServerEntryPluginOptions): Plugin {
  let layoutAbsPath = '';
  let routesAbsPath = '';
  let apiAbsPath: string | undefined;

  return {
    name: 'hono-preact:server-entry',
    enforce: 'pre',
    configResolved(config) {
      layoutAbsPath = path.isAbsolute(opts.layout)
        ? opts.layout
        : path.resolve(config.root, opts.layout);
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
      const candidateApi = path.isAbsolute(opts.api)
        ? opts.api
        : path.resolve(config.root, opts.api);
      apiAbsPath = fs.existsSync(candidateApi) ? candidateApi : undefined;
    },
    buildStart() {
      if (!apiAbsPath) return;
      const source = fs.readFileSync(apiAbsPath, 'utf8');
      const warnings = findApiCatchAllRoutes(source);
      for (const w of warnings) {
        const where = `${apiAbsPath}${w.line != null ? `:${w.line}` : ''}`;
        if (w.kind === 'notFound') {
          this.warn(
            `[hono-preact] ${where}: app.notFound(...) acts as a catch-all and ` +
              `will be shadowed by the framework's renderPage handler. ` +
              `Move the behavior to a more specific path, or accept that it won't fire.`
          );
        } else {
          this.warn(
            `[hono-preact] ${where}: app.${w.method}('${w.pattern}', ...) is a ` +
              `catch-all route and will be shadowed by the framework's renderPage ` +
              `handler. Move it to a more specific path, or accept that it won't fire.`
          );
        }
      }
    },
    resolveId(id) {
      if (id === VIRTUAL_SERVER_ENTRY_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return generateServerEntrySource({
        layoutAbsPath,
        routesAbsPath,
        apiAbsPath,
      });
    },
  };
}
