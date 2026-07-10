import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Plugin } from 'vite';
import { VIRTUAL_CLIENT_ID } from '@hono-preact/iso/internal/runtime';

export const VIRTUAL_CLIENT_ENTRY_ID = VIRTUAL_CLIENT_ID;
const RESOLVED_ID = '\0' + VIRTUAL_CLIENT_ENTRY_ID;

export interface GenerateClientEntrySourceOptions {
  routesAbsPath: string;
  /**
   * Absolute path of the app's framework-owned global stylesheet
   * (`honoPreact({ css: { global } })`). Imported first so Vite's CSS pipeline
   * processes it into the entry chunk's importedCss, where the auto-splitter
   * picks it up. Build-time only: in dev the import would apply styles via JS
   * after hydration (a global FOUC), so the dev server instead injects a
   * <link> to the source URL (see the dev-global-css seam in the server pkg).
   */
  cssGlobalAbsPath?: string;
}

// Rollup/esbuild import specifiers are always forward-slash paths, even on
// Windows: a raw backslash in a generated specifier either corrupts the path
// or throws a SyntaxError depending on where it lands in the string. Absolute
// paths built from `path.resolve`/`path.join` carry the platform separator
// (backslash on win32), so every generated specifier must be normalized to
// posix separators before being embedded in source text.
function toPosixSpecifier(p: string): string {
  return p.split('\\').join('/');
}

export function generateClientEntrySource(
  opts: GenerateClientEntrySourceOptions
): string {
  return (
    (opts.cssGlobalAbsPath
      ? `import ${JSON.stringify(toPosixSpecifier(opts.cssGlobalAbsPath))};\n`
      : '') +
    `import { h, hydrate } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes } from 'hono-preact';\n` +
    `import { installNavTransitionScheduler, installStreamRegistry, installHistoryShim } from 'hono-preact/internal/runtime';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
    `\n` +
    `installHistoryShim();\n` +
    `installNavTransitionScheduler();\n` +
    `installStreamRegistry();\n` +
    `\n` +
    // View transitions are driven by installNavTransitionScheduler() above: it
    // overrides Preact's render scheduler so a navigation's re-render runs inside
    // document.startViewTransition (capturing the outgoing route as the old
    // snapshot before the new one swaps in). No per-navigation wiring needed.
    `hydrate(\n` +
    `  h(LocationProvider, null,\n` +
    `    h(Routes, { routes })\n` +
    `  ),\n` +
    `  document.getElementById('app')\n` +
    `);\n`
  );
}

export interface ClientEntryPluginOptions {
  routes: string; // project-relative or absolute
  /** Project-relative or absolute path to the app's global stylesheet. */
  cssGlobal?: string;
}

export function clientEntryPlugin(opts: ClientEntryPluginOptions): Plugin {
  let routesAbsPath = '';
  let cssGlobalAbsPath = '';
  let isBuild = false;

  return {
    name: 'hono-preact:client-entry',
    enforce: 'pre',
    configResolved(config) {
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
      // `!== undefined` (not a truthy check): an empty string is a distinct
      // misconfiguration (see the isFile() note below) that must still throw,
      // not silently be treated as "no cssGlobal configured".
      if (opts.cssGlobal !== undefined) {
        cssGlobalAbsPath = path.isAbsolute(opts.cssGlobal)
          ? opts.cssGlobal
          : path.resolve(config.root, opts.cssGlobal);
        // isFile() also rejects '' and directory paths (resolving cssGlobal
        // against config.root when it is '' yields the project dir itself,
        // which exists but is not a stylesheet). Resolved against
        // config.root (not process.cwd()) so an app whose Vite root differs
        // from the invocation cwd validates the right path.
        if (
          !fs.existsSync(cssGlobalAbsPath) ||
          !fs.statSync(cssGlobalAbsPath).isFile()
        ) {
          throw new Error(
            `[hono-preact] css.global points at '${opts.cssGlobal}', which is not a file. ` +
              `Pass a project-relative path to your global stylesheet, e.g. 'src/styles/root.css'.`
          );
        }
        // A path outside root (e.g. '../shared/root.css') produces a dev
        // <link> URL like /../shared.css: the dev server resolves URLs
        // against root, so it never serves a path that escapes it (a 404 at
        // dev time, working only once the build's own CSS pipeline takes
        // over). Rejecting here keeps prod/dev URL semantics identical
        // instead of adding /@fs/ mapping just for this one case.
        const rel = path.relative(config.root, cssGlobalAbsPath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error(
            `[hono-preact] css.global must live under the project root; found '${cssGlobalAbsPath}' outside '${config.root}'.`
          );
        }
      }
      isBuild = config.command === 'build';
    },
    resolveId(id) {
      if (id === VIRTUAL_CLIENT_ENTRY_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return generateClientEntrySource({
        routesAbsPath,
        // Build-time only: see GenerateClientEntrySourceOptions.cssGlobalAbsPath.
        cssGlobalAbsPath:
          isBuild && cssGlobalAbsPath ? cssGlobalAbsPath : undefined,
      });
    },
  };
}
