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
    `import { __dispatchRouteChange, installStreamRegistry, installHistoryShim } from 'hono-preact/internal';\n` +
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
    // Seed lastPath with the initial pathname so the FIRST client navigation
    // reports a defined `from`. preact-iso doesn't fire onRouteChange on the
    // initial hydration mount, so without this the first nav's `from` would be
    // undefined and any direction logic keyed on it (e.g. up-navigation slides)
    // would be skipped for that one navigation.
    `let lastPath = typeof location !== 'undefined' ? location.pathname : undefined;\n` +
    `function onRouteChange(path) {\n` +
    `  const from = lastPath;\n` +
    `  lastPath = path;\n` +
    `  __dispatchRouteChange(path, from);\n` +
    `}\n` +
    `\n` +
    `hydrate(\n` +
    `  h(LocationProvider, null,\n` +
    `    h(Routes, { routes, onRouteChange })\n` +
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
