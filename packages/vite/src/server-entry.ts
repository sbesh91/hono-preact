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

  // The generated source is loaded as a virtual module, which Vite/esbuild
  // treats as plain JS by default. Use h() to construct vnodes rather than
  // JSX so the source compiles without a TSX loader hint.
  return (
    `import { Hono } from 'hono';\n` +
    `import { h } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes, env } from '@hono-preact/iso';\n` +
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
    `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))));\n` +
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

// Walk treats these as opaque: their bodies are user handlers, not route
// registrations. Skipping the body keeps `c.notFound()` inside a handler
// from being mistaken for `app.notFound(...)` at registration time.
const FUNCTION_BODY_PARENTS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
]);

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

  const isFunctionParent =
    typeof n.type === 'string' && FUNCTION_BODY_PARENTS.has(n.type);

  for (const key of Object.keys(node as object)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    if (isFunctionParent && key === 'body') continue;
    walk((node as Record<string, unknown>)[key], warnings);
  }
}

// Project-relative path of the on-disk file the plugin writes during
// configResolved. We use a relative path because @hono/vite-build prepends
// `/` to the entry when constructing its `import.meta.glob([...])`, and
// absolute paths produce a `//Users/...` double-slash that's brittle in the
// Cloudflare Workers runtime. Project-relative keeps the resulting glob
// pattern (`/node_modules/.vite/hono-preact/server-entry.tsx`) clean.
//
// We write to disk rather than register a virtual module because
// @hono/vite-build resolves its entry via `import.meta.glob([entry])`, which
// cannot match a `virtual:*` id. The Cloudflare Workers runtime then fails
// with "Can't import modules from ['/virtual:...']" when it tries to load the
// generated bundle.
export const GENERATED_SERVER_ENTRY_RELATIVE =
  'node_modules/.vite/hono-preact/server-entry.tsx';

export function generatedServerEntryAbsPath(cwd: string = process.cwd()): string {
  return path.resolve(cwd, GENERATED_SERVER_ENTRY_RELATIVE);
}

export interface ServerEntryPluginOptions {
  layout: string; // project-relative or absolute
  routes: string;
  api: string; // project-relative or absolute; absence treated as "no api"
  outputPath: string; // absolute path to write the generated entry file
}

export function serverEntryPlugin(opts: ServerEntryPluginOptions): Plugin {
  let apiAbsPath: string | undefined;

  return {
    name: 'hono-preact:server-entry',
    enforce: 'pre',
    configResolved(config) {
      const layoutAbsPath = path.isAbsolute(opts.layout)
        ? opts.layout
        : path.resolve(config.root, opts.layout);
      const routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
      const candidateApi = path.isAbsolute(opts.api)
        ? opts.api
        : path.resolve(config.root, opts.api);
      apiAbsPath = fs.existsSync(candidateApi) ? candidateApi : undefined;

      const source = generateServerEntrySource({
        layoutAbsPath,
        routesAbsPath,
        apiAbsPath,
      });
      fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
      fs.writeFileSync(opts.outputPath, source, 'utf8');
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
  };
}
