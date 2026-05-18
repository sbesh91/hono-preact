import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';

export interface GenerateServerEntrySourceOptions {
  layoutAbsPath: string;
  routesAbsPath: string;
  apiAbsPath: string | undefined;
}

export function generateServerEntrySource(
  opts: GenerateServerEntrySourceOptions
): string {
  const { layoutAbsPath, routesAbsPath, apiAbsPath } = opts;

  const apiImport = apiAbsPath ? `import userApp from '${apiAbsPath}';\n` : '';
  const apiMount = apiAbsPath ? `  .route('/', userApp)\n` : '';

  // The generated source is loaded as a virtual module, which Vite/esbuild
  // treats as plain JS by default. Use h() to construct vnodes rather than
  // JSX so the source compiles without a TSX loader hint.
  return (
    `import { Hono } from 'hono';\n` +
    `import { h } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes, env } from 'hono-preact';\n` +
    `import {\n` +
    `  actionsHandler,\n` +
    `  loadersHandler,\n` +
    `  renderPage,\n` +
    `  routeServerModules,\n` +
    `} from 'hono-preact/server';\n` +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    `\n` +
    `env.current = 'server';\n` +
    `const serverModules = routeServerModules(routes);\n` +
    `const handlerOpts = { dev: import.meta.env.DEV };\n` +
    `\n` +
    `export const app = new Hono()\n` +
    apiMount +
    `  .post('/__loaders', loadersHandler(serverModules, handlerOpts))\n` +
    `  .post('/__actions', actionsHandler(serverModules, handlerOpts))\n` +
    `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes })))));\n` +
    `\n` +
    `export default app;\n`
  );
}

export type ApiShadowingRoute =
  | {
      kind: 'wildcard';
      method: string;
      pattern: string;
      line: number | undefined;
      severity: 'error';
    }
  | {
      kind: 'reserved';
      method: string;
      pattern: string;
      line: number | undefined;
      severity: 'error';
    }
  | { kind: 'notFound'; line: number | undefined; severity: 'warning' };

// Framework-reserved request paths. A literal registration of either in
// api.ts shadows the framework's RPC handler now that the user app mounts
// ahead of them.
const RESERVED_PATHS = new Set(['/__loaders', '/__actions']);

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

export function findApiShadowingRoutes(source: string): ApiShadowingRoute[] {
  const found: ApiShadowingRoute[] = [];

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: BABEL_PARSER_PLUGINS,
      errorRecovery: true,
    });
  } catch (err) {
    // If api.ts won't parse, the build will fail elsewhere with a clearer
    // error. Surface a note so the framework user can correlate a missing
    // shadowing warning with a parse-time syntax issue rather than wondering
    // why nothing was reported.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[hono-preact] Failed to parse api.ts for shadowing-route detection: ${msg}. ` +
        `The build will surface the real syntax error; this warning explains why ` +
        `route-overlap diagnostics may be missing.`
    );
    return found;
  }

  walk(ast.program, found);
  return found;
}

function walk(node: unknown, found: ApiShadowingRoute[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, found);
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
      found.push({ kind: 'notFound', line, severity: 'warning' });
    } else if (HONO_METHODS.has(method)) {
      // `app.on(method, path, ...)` puts the path at argument index 1;
      // every other Hono routing method takes the path as argument 0.
      const pathArg = n.arguments?.[method === 'on' ? 1 : 0];
      if (
        pathArg?.type === 'StringLiteral' &&
        typeof pathArg.value === 'string'
      ) {
        if (WILDCARD_PATTERNS.has(pathArg.value)) {
          found.push({
            kind: 'wildcard',
            method,
            pattern: pathArg.value,
            line,
            severity: 'error',
          });
        } else if (RESERVED_PATHS.has(pathArg.value)) {
          found.push({
            kind: 'reserved',
            method,
            pattern: pathArg.value,
            line,
            severity: 'error',
          });
        }
      }
    }
  }

  const isFunctionParent =
    typeof n.type === 'string' && FUNCTION_BODY_PARENTS.has(n.type);

  for (const key of Object.keys(node as object)) {
    if (
      key === 'loc' ||
      key === 'leadingComments' ||
      key === 'trailingComments'
    )
      continue;
    if (isFunctionParent && key === 'body') continue;
    walk((node as Record<string, unknown>)[key], found);
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

export function generatedServerEntryAbsPath(
  cwd: string = process.cwd()
): string {
  return path.resolve(cwd, GENERATED_SERVER_ENTRY_RELATIVE);
}

export interface ServerEntryPluginOptions {
  layout: string; // project-relative or absolute
  routes: string;
  api: string; // project-relative or absolute; absence treated as "no api"
  outputPath: string; // absolute path to write the generated entry file
}

export function serverEntryPlugin(opts: ServerEntryPluginOptions): Plugin {
  // Paths resolved during configResolved (cheap) — actual disk write
  // happens in buildStart so config-only Vite invocations (IDE probes,
  // typecheck-only runs, dependency-optimizer cold runs) don't side-effect
  // the cache directory. Writing on every config resolution was a tax that
  // showed up when integration tests loaded vite.config.ts to inspect the
  // plugin chain.
  let layoutAbsPath: string | undefined;
  let routesAbsPath: string | undefined;
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
      // configResolved must have run first. Bail loudly if not — silent
      // emission of a stub would be much harder to debug.
      if (!layoutAbsPath || !routesAbsPath) {
        throw new Error(
          '[hono-preact] server-entry buildStart fired before configResolved; ' +
            'layout/routes paths were never resolved.'
        );
      }
      const source = generateServerEntrySource({
        layoutAbsPath,
        routesAbsPath,
        apiAbsPath,
      });
      fs.mkdirSync(path.dirname(opts.outputPath), { recursive: true });
      fs.writeFileSync(opts.outputPath, source, 'utf8');

      if (!apiAbsPath) return;
      const apiSource = fs.readFileSync(apiAbsPath, 'utf8');
      const shadowing = findApiShadowingRoutes(apiSource);
      const errors: string[] = [];
      for (const r of shadowing) {
        const where = `${apiAbsPath}${r.line != null ? `:${r.line}` : ''}`;
        if (r.kind === 'notFound') {
          this.warn(
            `[hono-preact] ${where}: app.notFound(...) will not fire — the ` +
              `framework's renderPage handler matches every unmatched request. ` +
              `Move the behavior to a specific path, or accept that it won't fire.`
          );
        } else if (r.kind === 'wildcard') {
          errors.push(
            `${where}: app.${r.method}('${r.pattern}', ...) is a catch-all route`
          );
        } else {
          errors.push(
            `${where}: app.${r.method}('${r.pattern}', ...) registers the ` +
              `framework-reserved path '${r.pattern}'`
          );
        }
      }
      if (errors.length > 0) {
        this.error(
          `[hono-preact] api.ts registers routes that shadow framework handlers:\n` +
            errors.map((e) => `  - ${e}`).join('\n') +
            `\nThe framework mounts your app ahead of its reserved paths ` +
            `(/__loaders, /__actions) and the SSR handler, so these routes break ` +
            `loaders/actions and/or page rendering. Use specific, non-wildcard paths.`
        );
      }
    },
  };
}
