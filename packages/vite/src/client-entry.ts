import * as path from 'node:path';
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

export function generateClientEntrySource(
  opts: GenerateClientEntrySourceOptions
): string {
  return (
    (opts.cssGlobalAbsPath ? `import '${opts.cssGlobalAbsPath}';\n` : '') +
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
      if (opts.cssGlobal) {
        cssGlobalAbsPath = path.isAbsolute(opts.cssGlobal)
          ? opts.cssGlobal
          : path.resolve(config.root, opts.cssGlobal);
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
