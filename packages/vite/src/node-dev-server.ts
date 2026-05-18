import type { Plugin } from 'vite';
import type { HonoPreactAdapterContext } from './adapter.js';

export function nodeBuildPlugin(_ctx: HonoPreactAdapterContext): Plugin {
  return { name: 'hono-preact:node-build' };
}

export function nodeDevServerPlugin(_ctx: HonoPreactAdapterContext): Plugin {
  return { name: 'hono-preact:node-dev-server' };
}
