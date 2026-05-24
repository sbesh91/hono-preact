import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import type { Plugin } from 'vite';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';
import type { HonoPreactAdapter } from './adapter.js';

export interface GenerateCoreAppModuleOptions {
  layoutAbsPath: string;
  routesAbsPath: string;
  apiAbsPath: string | undefined;
  appConfigAbsPath: string | undefined;
}

export function generateCoreAppModule(
  opts: GenerateCoreAppModuleOptions
): string {
  const { layoutAbsPath, routesAbsPath, apiAbsPath, appConfigAbsPath } = opts;

  const apiImport = apiAbsPath ? `import userApp from '${apiAbsPath}';\n` : '';
  const apiMount = apiAbsPath ? `  .route('/', userApp)\n` : '';

  // appConfig is optional: when no app-config.ts file exists, fall back to
  // an empty config so the handler chain composition (root -> page -> unit)
  // still works without the user authoring anything. The default-export
  // shape mirrors the `import appConfig from './app-config'` convention so
  // consumers can adopt the file later without other entry changes.
  const appConfigImport = appConfigAbsPath
    ? `import appConfig from '${appConfigAbsPath}';\n`
    : `const appConfig = { use: [] };\n`;

  // The generated source is loaded as a virtual module, which Vite/esbuild
  // treats as plain JS by default. Use h() to construct vnodes rather than
  // JSX so the source compiles without a TSX loader hint.
  return (
    `import { Hono } from 'hono';\n` +
    `import { h } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes, env } from 'hono-preact';\n` +
    `import {\n` +
    `  loadersHandler,\n` +
    `  makePageActionResolvers,\n` +
    `  makePageUseResolvers,\n` +
    `  pageActionHandler,\n` +
    `  renderPage,\n` +
    `  routeServerModules,\n` +
    `} from 'hono-preact/server';\n` +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    appConfigImport +
    `\n` +
    `env.current = 'server';\n` +
    `const dev = import.meta.env.DEV;\n` +
    `const serverModules = routeServerModules(routes);\n` +
    `const pageUseResolvers = makePageUseResolvers(routes.serverRoutes, { dev });\n` +
    `const pageActionResolvers = makePageActionResolvers(routes.serverRoutes, { dev });\n` +
    `\n` +
    `export const app = new Hono()\n` +
    apiMount +
    `  .post('/__loaders', loadersHandler(serverModules, { dev, appConfig, resolvePageUse: pageUseResolvers.byPath }))\n` +
    `  .post('*', pageActionHandler({\n` +
    `    resolverByPath: pageActionResolvers.byPath,\n` +
    `    resolvePageUseByPath: pageUseResolvers.byPath,\n` +
    `    renderPage,\n` +
    `    resolvePageNode: () => h(Layout, null, h(LocationProvider, null, h(Routes, { routes }))),\n` +
    `    appConfig,\n` +
    `  }))\n` +
    `  .get('*', (c) => renderPage(c, h(Layout, null, h(LocationProvider, null, h(Routes, { routes }))), { appConfig }));\n` +
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

// Both generated files live in the Vite cache dir. The wrapper keeps the
// `server-entry.tsx` name because that is the file the adapter's build/dev
// plugins (and wrangler.jsonc `main`) point at; the core app module is a
// separate file the wrapper imports.
export const GENERATED_CORE_APP_RELATIVE =
  'node_modules/.vite/hono-preact/core-app.tsx';
export const GENERATED_ENTRY_WRAPPER_RELATIVE =
  'node_modules/.vite/hono-preact/server-entry.tsx';

export function generatedCoreAppAbsPath(cwd: string = process.cwd()): string {
  return path.resolve(cwd, GENERATED_CORE_APP_RELATIVE);
}

export function generatedEntryWrapperAbsPath(
  cwd: string = process.cwd()
): string {
  return path.resolve(cwd, GENERATED_ENTRY_WRAPPER_RELATIVE);
}

export interface ServerEntryPluginOptions {
  layout: string; // project-relative or absolute
  routes: string;
  api: string; // project-relative or absolute; absence treated as "no api"
  /**
   * Project-relative or absolute path to the user's app-config file. The
   * `hono-preact` umbrella plugin always supplies a default
   * (`src/app-config.ts`), so this is required here even though it's
   * optional from the user's perspective: missing the file on disk is
   * allowed (an inline `{ use: [] }` falls back into the generated core
   * app), but the option name itself must be supplied.
   */
  appConfig: string;
  adapter: HonoPreactAdapter;
  coreAppPath: string; // absolute path to write the core app module
  entryWrapperPath: string; // absolute path to write the adapter wrapper
}

// Returns true if the parsed program contains a top-level
// `export default ...`. The app-config diagnostic uses this to detect a
// common mistake: writing `export const appConfig = defineApp(...)`
// instead of `export default defineApp(...)`. Without a default the
// generated `import appConfig from '...'` binds to undefined and the
// app-level middleware chain silently never runs.
function hasDefaultExport(source: string): boolean {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: BABEL_PARSER_PLUGINS,
      errorRecovery: true,
    });
  } catch {
    // Fall back to "true" on parse failure so we don't pile a misleading
    // app-config error on top of an obvious syntax error elsewhere in the
    // file. The real parse error surfaces from the Vite build itself.
    return true;
  }
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') return true;
  }
  return false;
}

export function serverEntryPlugin(opts: ServerEntryPluginOptions): Plugin {
  let apiAbsPath: string | undefined;
  let appConfigAbsPath: string | undefined;

  return {
    name: 'hono-preact:server-entry',
    enforce: 'pre',
    // Write generated files in `config` -- the earliest hook -- so the entry
    // wrapper exists before @cloudflare/vite-plugin's own `config` hook does
    // fs.existsSync on wrangler.jsonc `main`.
    config(userConfig) {
      const root = userConfig.root
        ? path.resolve(userConfig.root)
        : process.cwd();
      const layoutAbsPath = path.isAbsolute(opts.layout)
        ? opts.layout
        : path.resolve(root, opts.layout);
      const routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(root, opts.routes);
      const candidateApi = path.isAbsolute(opts.api)
        ? opts.api
        : path.resolve(root, opts.api);
      apiAbsPath = fs.existsSync(candidateApi) ? candidateApi : undefined;
      const candidateAppConfig = path.isAbsolute(opts.appConfig)
        ? opts.appConfig
        : path.resolve(root, opts.appConfig);
      appConfigAbsPath = fs.existsSync(candidateAppConfig)
        ? candidateAppConfig
        : undefined;

      const source = generateCoreAppModule({
        layoutAbsPath,
        routesAbsPath,
        apiAbsPath,
        appConfigAbsPath,
      });
      fs.mkdirSync(path.dirname(opts.coreAppPath), { recursive: true });
      fs.writeFileSync(opts.coreAppPath, source, 'utf8');

      const wrapper = opts.adapter.wrapEntry({
        root,
        coreAppModuleId: opts.coreAppPath,
        entryWrapperId: opts.entryWrapperPath,
        apiModuleId: apiAbsPath,
      });
      fs.writeFileSync(opts.entryWrapperPath, wrapper, 'utf8');
    },
    buildStart() {
      // The api.ts shadowing diagnostic stays in buildStart: it needs
      // this.warn / this.error, which the `config` hook context lacks.
      // The app-config default-export diagnostic lives here for the same
      // reason.
      if (appConfigAbsPath) {
        const appConfigSource = fs.readFileSync(appConfigAbsPath, 'utf8');
        if (!hasDefaultExport(appConfigSource)) {
          this.error(
            `[hono-preact] ${appConfigAbsPath}: app-config.ts must default-export ` +
              `the result of defineApp(...) (e.g. ` +
              `\`export default defineApp({ use: [...] })\`). The generated entry ` +
              `does \`import appConfig from '...'\`; without a default export the ` +
              `import resolves to undefined and the app-level middleware chain ` +
              `silently never runs.`
          );
        }
      }

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
