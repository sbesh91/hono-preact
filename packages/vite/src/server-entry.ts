import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Plugin, ViteDevServer } from 'vite';
import { findApiShadowingRoutes, hasDefaultExport } from './ast-diagnostics.js';
import {
  probeOptionalFile,
  watchProbeFlips,
  type EntryProbes,
} from './entry-probes.js';
import type { HonoPreactAdapter } from './adapter.js';
import { createRootRef, type RootRef } from './root.js';

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
  /**
   * The shared root holder. This plugin is `enforce: 'pre'`, so its `config`
   * hook is the first to see `userConfig`; it resolves the root here and every
   * other consumer (the umbrella plugin's optimizer seed, the adapter context)
   * reads the same value back.
   *
   * Optional: defaults to a fresh `createRootRef()` when omitted, which is
   * enough for a standalone call to this plugin. Pass one explicitly only
   * when another plugin (e.g. the `honoPreact()` umbrella) needs to read the
   * same resolved root.
   */
  rootRef?: RootRef;
  /**
   * Project-relative or absolute path to the app's global stylesheet
   * (`honoPreact({ css: { global } })`). In serve mode the generated core
   * app installs its root-relative dev URL via `installDevGlobalCss`, so
   * renderPage links the dev-served source directly. Builds skip the
   * install; prod delivery reads the build artifact instead.
   */
  cssGlobal?: string;
  /**
   * Output file names declared via `honoPreact({ assets })`, forwarded to the
   * adapter's `wrapEntry()` as `HonoPreactAdapterContext.assetNames`. Defaults
   * to none, which is what a standalone call to this plugin wants.
   */
  assetNames?: readonly string[];
}

export function serverEntryPlugin(opts: ServerEntryPluginOptions): Plugin {
  // Created once per call, not per `config` hook invocation: a fresh RootRef
  // per hook call would defeat the first-writer-wins memoization the type
  // documents.
  const rootRef = opts.rootRef ?? createRootRef();
  // What the `config` hook's existence probes found, retained so the
  // dev-server watcher (configureServer below) can detect when a probe's
  // answer changes mid-session. See `entry-probes.ts`.
  let probes: EntryProbes | undefined;

  return {
    name: 'hono-preact:server-entry',
    enforce: 'pre',
    // Write generated files in `config` -- the earliest hook -- so the entry
    // wrapper exists before @cloudflare/vite-plugin's own `config` hook does
    // fs.existsSync on wrangler.jsonc `main`.
    config(userConfig, env) {
      const root = rootRef.set(userConfig);
      const coreAppPath = generatedCoreAppAbsPath(root);
      const entryWrapperPath = generatedEntryWrapperAbsPath(root);
      const layoutAbsPath = path.isAbsolute(opts.layout)
        ? opts.layout
        : path.resolve(root, opts.layout);
      const routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(root, opts.routes);
      const api = probeOptionalFile(root, opts.api);
      const appConfig = probeOptionalFile(root, opts.appConfig);
      const apiAbsPath = api.resolved;
      const appConfigAbsPath = appConfig.resolved;

      // Build the registry glob only when the folder exists, so a project
      // without a `src/server` dir emits `serverRegistry = []` (no glob at all)
      // rather than a glob that matches nothing. `import.meta.glob` needs a
      // root-relative literal, so normalize to `/<dir>/**/*.server.{...}` with
      // posix separators.
      const serverDirAbsPath = path.isAbsolute(opts.serverDir)
        ? opts.serverDir
        : path.resolve(root, opts.serverDir);
      const serverDirExisted = fs.existsSync(serverDirAbsPath);
      probes = {
        api,
        appConfig,
        serverDir: { abs: serverDirAbsPath, existed: serverDirExisted },
      };
      const serverRegistryGlob = serverDirExisted
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
      fs.mkdirSync(path.dirname(coreAppPath), { recursive: true });
      fs.writeFileSync(coreAppPath, source, 'utf8');

      const wrapper = opts.adapter.wrapEntry({
        root,
        coreAppModuleId: coreAppPath,
        entryWrapperId: entryWrapperPath,
        apiModuleId: apiAbsPath,
        assetNames: opts.assetNames ?? [],
      });
      fs.writeFileSync(entryWrapperPath, wrapper, 'utf8');
    },
    configureServer(server: ViteDevServer) {
      watchProbeFlips(server, () => probes);
    },
    buildStart() {
      // The api.ts shadowing diagnostic stays in buildStart: it needs
      // this.warn / this.error, which the `config` hook context lacks.
      // The app-config default-export diagnostic lives here for the same
      // reason.
      const appConfigAbsPath = probes?.appConfig.resolved;
      const apiAbsPath = probes?.api.resolved;
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
