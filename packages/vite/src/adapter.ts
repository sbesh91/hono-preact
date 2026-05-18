// packages/vite/src/adapter.ts
import type { Plugin } from 'vite';

/**
 * Static context the framework hands an adapter. `command` and `outDir`
 * are intentionally absent: they are not known when honoPreact() builds its
 * plugin array. Adapters that need them read them from their own plugin
 * hooks (config / configResolved).
 */
export interface HonoPreactAdapterContext {
  /** Vite project root (process.cwd() when honoPreact() is called). */
  root: string;
  /** Absolute path of the framework-generated core Hono app module. */
  coreAppModuleId: string;
  /** Absolute path where the adapter's wrapEntry() output is written. */
  entryWrapperId: string;
}

/**
 * A deployment target. `vitePlugins()` contributes the terminal build/dev
 * plugins; `wrapEntry()` returns the platform tail that imports the core
 * Hono app module and adapts it to the runtime.
 */
export interface HonoPreactAdapter {
  name: string;
  vitePlugins(ctx: HonoPreactAdapterContext): Plugin[];
  wrapEntry(ctx: HonoPreactAdapterContext): string;
}
