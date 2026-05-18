// packages/vite/src/adapter-cloudflare.ts
//
// Standalone module. NOT re-exported by index.ts: importing `hono-preact/vite`
// must never pull in `@cloudflare/vite-plugin`. Only importing
// `hono-preact/adapter-cloudflare` loads this file.
import { cloudflare } from '@cloudflare/vite-plugin';
import type { Plugin } from 'vite';
import type { HonoPreactAdapter } from './adapter.js';

export function cloudflareAdapter(): HonoPreactAdapter {
  return {
    name: 'cloudflare',
    vitePlugins() {
      // `@cloudflare/vite-plugin` drives both workerd dev and the build via
      // the Environment API, and reads the worker entry from wrangler.jsonc
      // `main`. It needs no entry argument from the framework.
      // `cloudflare()` may return a single plugin or an array; normalize so
      // the HonoPreactAdapter contract (a flat Plugin[]) holds either way.
      const produced = cloudflare() as Plugin | Plugin[];
      return Array.isArray(produced) ? produced : [produced];
    },
    wrapEntry(ctx) {
      // A Hono app's default export is already a valid Workers fetch handler,
      // so the platform tail is a bare re-export of the core app module.
      return `export { default } from ${JSON.stringify(ctx.coreAppModuleId)};\n`;
    },
  };
}
