import * as path from 'node:path';
import type { Plugin } from 'vite';
import { VIRTUAL_CLIENT_ID } from '@hono-preact/iso/internal';

export const VIRTUAL_CLIENT_ENTRY_ID = VIRTUAL_CLIENT_ID;
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
    `import { installNavTransitionScheduler, installStreamRegistry, installHistoryShim } from 'hono-preact/internal';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
    `\n` +
    `installHistoryShim();\n` +
    `installNavTransitionScheduler();\n` +
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
