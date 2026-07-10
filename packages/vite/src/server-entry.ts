import * as path from 'node:path';
import * as fs from 'node:fs';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import type { CallExpression } from '@babel/types';
import type { Plugin } from 'vite';
import {
  LOADERS_RPC_PATH,
  SOCKETS_RPC_PATH,
} from '@hono-preact/iso/internal/runtime';
import { BABEL_PARSER_PLUGINS } from './parser-options.js';
import type { HonoPreactAdapter } from './adapter.js';

export interface GenerateCoreAppModuleOptions {
  layoutAbsPath: string;
  routesAbsPath: string;
  apiAbsPath: string | undefined;
  appConfigAbsPath: string | undefined;
  /**
   * Root-relative `import.meta.glob` pattern for the server registry (the
   * `src/server/**` blessed folder), or undefined when the folder does not
   * exist. When present, every matched `.server.*` module is imported into the
   * server build so its route-less loaders/actions, rooms, and sockets register
   * without being attached to a route.
   */
  serverRegistryGlob: string | undefined;
  /**
   * Root-relative dev URL of the framework-owned global stylesheet (serve mode
   * only; undefined in builds). The core app installs it so renderPage links
   * the dev-served source directly, exactly what a hand-authored `?url` link
   * did. Prod delivery reads the build artifact instead.
   */
  devGlobalCssUrl?: string;
}

export function generateCoreAppModule(
  opts: GenerateCoreAppModuleOptions
): string {
  const {
    layoutAbsPath,
    routesAbsPath,
    apiAbsPath,
    appConfigAbsPath,
    serverRegistryGlob,
    devGlobalCssUrl,
  } = opts;

  const apiImport = apiAbsPath ? `import userApp from '${apiAbsPath}';\n` : '';
  const apiOption = apiAbsPath ? `  api: userApp,\n` : '';

  // The registry is a lazy `import.meta.glob` of the blessed server folder,
  // reduced to the same `() => import(...)` thunk array shape as
  // `routes.serverImports`. Empty when the folder is absent.
  const registryDecl = serverRegistryGlob
    ? `const serverRegistry = Object.values(import.meta.glob(${JSON.stringify(
        serverRegistryGlob
      )}));\n`
    : `const serverRegistry = [];\n`;

  // appConfig is optional: when no app-config.ts file exists, fall back to an
  // empty config so the middleware chain still composes without the user
  // authoring anything. The default-export shape mirrors the
  // `import appConfig from './app-config'` convention so consumers can adopt
  // the file later without other entry changes.
  const appConfigImport = appConfigAbsPath
    ? `import appConfig from '${appConfigAbsPath}';\n`
    : `const appConfig = { use: [] };\n`;

  const devGlobalCssInstall = devGlobalCssUrl
    ? `import { installDevGlobalCss } from 'hono-preact/server/internal/runtime';\n` +
      `installDevGlobalCss([${JSON.stringify(devGlobalCssUrl)}]);\n`
    : '';

  // The generated entry delegates all wiring to the framework-private
  // createServerEntry factory (loaders RPC, action POST, SSR catch-all, and the
  // optional api mount). The factory lives behind hono-preact/server/internal/
  // runtime: a version-coupled contract this codegen emits, not a public API.
  // `serverImports` is re-exported so the Cloudflare adapter's worker entry can
  // build the room registry inside the Durable Object isolate
  // (installRoomRegistry(() => buildRoomRegistry(serverImports))). The Durable
  // Object never sees the worker's request-time wiring, so it resolves room
  // defs from this same lazy-loader array. The Node entry ignores the export;
  // its room runtime builds the registry inline inside createServerEntry. It is
  // the routes manifest's own `serverImports` array (the lazy `.server` module
  // loaders), surfaced as a named export with no extra collection work.
  return (
    `import { createServerEntry } from 'hono-preact/server/internal/runtime';\n` +
    devGlobalCssInstall +
    `import Layout from '${layoutAbsPath}';\n` +
    `import routes from '${routesAbsPath}';\n` +
    apiImport +
    appConfigImport +
    registryDecl +
    `\n` +
    // Include the registry so the Cloudflare adapter's Durable Object builds its
    // room registry from route-attached AND src/server rooms alike.
    `export const serverImports = [...routes.serverImports, ...serverRegistry];\n` +
    `\n` +
    `export const app = createServerEntry({\n` +
    `  routes,\n` +
    `  layout: Layout,\n` +
    `  appConfig,\n` +
    `  serverRegistry,\n` +
    apiOption +
    `  dev: import.meta.env.DEV,\n` +
    `});\n` +
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

// Framework-reserved request paths. A literal registration of any of these in
// api.ts shadows the framework's RPC handlers now that the user app mounts
// ahead of them.
const RESERVED_PATHS = new Set([LOADERS_RPC_PATH, SOCKETS_RPC_PATH]);

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

  traverse(ast, {
    // Handler bodies are opaque: their contents are user code, not route
    // registrations, so skip every function subtree. This keeps e.g.
    // `c.notFound()` inside a handler from being read as `app.notFound(...)`.
    // (The original walker skipped only a function's `body`; pruning the whole
    // function additionally ignores the absurd case of a route registration in
    // a param default / decorator, which is the safe direction.)
    Function(path) {
      path.skip();
    },
    CallExpression(path: NodePath<CallExpression>) {
      const { node } = path;
      if (
        node.callee.type !== 'MemberExpression' ||
        node.callee.property.type !== 'Identifier'
      ) {
        return;
      }
      const method = node.callee.property.name;
      const line = node.loc?.start.line;

      if (method === 'notFound') {
        found.push({ kind: 'notFound', line, severity: 'warning' });
        return;
      }
      if (!HONO_METHODS.has(method)) return;

      // `app.on(method, path, ...)` puts the path at argument index 1; every
      // other Hono routing method takes the path as argument 0.
      const pathArg = node.arguments[method === 'on' ? 1 : 0];
      if (pathArg?.type !== 'StringLiteral') return;
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
    },
  });
  return found;
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
  /**
   * Project-relative or absolute path to the blessed server-registry folder
   * (default `src/server`). Every `.server.*` module under it is globbed into
   * the server build. Absent-on-disk is fine: the registry is simply empty.
   */
  serverDir: string;
  adapter: HonoPreactAdapter;
  coreAppPath: string; // absolute path to write the core app module
  entryWrapperPath: string; // absolute path to write the adapter wrapper
  /**
   * Project-relative or absolute path to the app's global stylesheet
   * (`honoPreact({ css: { global } })`). In serve mode the generated core
   * app installs its root-relative dev URL via `installDevGlobalCss`, so
   * renderPage links the dev-served source directly. Builds skip the
   * install; prod delivery reads the build artifact instead.
   */
  cssGlobal?: string;
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
    config(userConfig, env) {
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

      // Build the registry glob only when the folder exists, so a project
      // without a `src/server` dir emits `serverRegistry = []` (no glob at all)
      // rather than a glob that matches nothing. `import.meta.glob` needs a
      // root-relative literal, so normalize to `/<dir>/**/*.server.{...}` with
      // posix separators.
      const serverDirAbsPath = path.isAbsolute(opts.serverDir)
        ? opts.serverDir
        : path.resolve(root, opts.serverDir);
      const serverRegistryGlob = fs.existsSync(serverDirAbsPath)
        ? '/' +
          path.relative(root, serverDirAbsPath).split(path.sep).join('/') +
          '/**/*.server.{ts,tsx,js,jsx}'
        : undefined;

      const devGlobalCssUrl =
        env.command === 'serve' && opts.cssGlobal
          ? '/' +
            path
              .relative(
                root,
                path.isAbsolute(opts.cssGlobal)
                  ? opts.cssGlobal
                  : path.resolve(root, opts.cssGlobal)
              )
              .split(path.sep)
              .join('/')
          : undefined;

      const source = generateCoreAppModule({
        layoutAbsPath,
        routesAbsPath,
        apiAbsPath,
        appConfigAbsPath,
        serverRegistryGlob,
        devGlobalCssUrl,
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
            `[hono-preact] ${where}: app.notFound(...) will not fire: the ` +
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
            `(/__loaders) and the SSR handler, so these routes break ` +
            `loaders/actions and/or page rendering. Use specific, non-wildcard paths.`
        );
      }
    },
  };
}
