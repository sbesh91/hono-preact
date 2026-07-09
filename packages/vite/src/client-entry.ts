import * as path from 'node:path';
import type { Plugin } from 'vite';
import { VIRTUAL_CLIENT_ID } from '@hono-preact/iso/internal/runtime';

export const VIRTUAL_CLIENT_ENTRY_ID = VIRTUAL_CLIENT_ID;
const RESOLVED_ID = '\0' + VIRTUAL_CLIENT_ENTRY_ID;

export interface GenerateClientEntrySourceOptions {
  routesAbsPath: string;
}

export function generateClientEntrySource(
  opts: GenerateClientEntrySourceOptions
): string {
  return (
    `import { h, hydrate } from 'preact';\n` +
    `import { LocationProvider } from 'preact-iso';\n` +
    `import { Routes, bootClient } from 'hono-preact';\n` +
    `import routes from '${opts.routesAbsPath}';\n` +
    `\n` +
    // bootClient() installs the client runtime services (history shim,
    // nav-transition scheduler for view transitions, stream registry) before
    // hydrate, so the very first navigation already has direction tracking,
    // transitions, and live-loader stream wiring. It is the same public call
    // a custom clientEntry is expected to make (the clientEntry contract).
    `bootClient();\n` +
    `\n` +
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
