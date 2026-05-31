import * as path from 'node:path';
import type { Plugin } from 'vite';

export const VIRTUAL_CLIENT_ENTRY_ID = 'virtual:hono-preact/client';
const RESOLVED_ID = '\0' + VIRTUAL_CLIENT_ENTRY_ID;

export interface GenerateClientEntrySourceOptions {
  routesAbsPath: string;
}

export function generateClientEntrySource(
  opts: GenerateClientEntrySourceOptions
): string {
  return (
    `import { h, hydrate, render as renderPreact } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes, PersistHost } from 'hono-preact';\n` +
    `import { __wrapNavigation, installStreamRegistry, installHistoryShim } from 'hono-preact/internal';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
    `\n` +
    `installHistoryShim();\n` +
    `installStreamRegistry();\n` +
    `\n` +
    `let persistHost = document.getElementById('__hp_persist_root');\n` +
    `if (!persistHost) {\n` +
    `  persistHost = document.createElement('div');\n` +
    `  persistHost.id = '__hp_persist_root';\n` +
    `  document.body.appendChild(persistHost);\n` +
    `}\n` +
    `renderPreact(h(PersistHost, null), persistHost);\n` +
    `\n` +
    // Wrap every navigation in a view transition that starts BEFORE the route
    // re-renders, so the browser captures the outgoing route as the old snapshot
    // before the new one swaps in (this is what lets shared-element morphs and
    // directional slides animate old->new). The coordinator runs the commit
    // inside the transition and, for navigations to suspending routes, waits for
    // the content via the Router's wrapUpdate.
    `hydrate(\n` +
    `  h(LocationProvider, { wrapNavigation: __wrapNavigation },\n` +
    `    h(Routes, { routes })\n` +
    `  ),\n` +
    `  document.getElementById('app')\n` +
    `);\n`
  );
}

export interface ClientEntryPluginOptions {
  routes: string; // project-relative or absolute
}

export function clientEntryPlugin(opts: ClientEntryPluginOptions): Plugin {
  let routesAbsPath = '';

  return {
    name: 'hono-preact:client-entry',
    enforce: 'pre',
    configResolved(config) {
      routesAbsPath = path.isAbsolute(opts.routes)
        ? opts.routes
        : path.resolve(config.root, opts.routes);
    },
    resolveId(id) {
      if (id === VIRTUAL_CLIENT_ENTRY_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;
      return generateClientEntrySource({ routesAbsPath });
    },
  };
}
