// packages/vite/src/adapter.ts
import type { Plugin } from 'vite';

/**
 * Context the framework hands an adapter. `command` and `outDir` are
 * intentionally absent: they are not known when honoPreact() builds its
 * plugin array. Adapters that need them read them from their own plugin
 * hooks (config / configResolved).
 *
 * All three path fields are lazily resolved and only hold correct values
 * once a `config` hook has run. Read them from inside a plugin hook
 * (`vitePlugins()`'s returned plugins, or `wrapEntry()`, which the framework
 * calls from its own `config` hook), never from the body of `vitePlugins()`
 * itself.
 *
 * `assetNames` is the one field exempt from that rule: it is derived
 * synchronously from the options object honoPreact() was called with, so it
 * holds its final value from the moment the context is built and is safe to
 * read anywhere, including the body of `vitePlugins()`.
 */
export interface HonoPreactAdapterContext {
  /** The resolved Vite project root. */
  root: string;
  /** Absolute path of the framework-generated core Hono app module. */
  coreAppModuleId: string;
  /** Absolute path where the adapter's wrapEntry() output is written. */
  entryWrapperId: string;
  /** Absolute path of the user's api module, if it exists. Used by adapters
   *  that need to reach api-module exports (e.g. the Node adapter's
   *  WebSocket `injectWebSocket`). Undefined when the project has no api.ts. */
  apiModuleId?: string;
  /**
   * Output file names declared via `honoPreact({ assets })`, relative to the
   * client out dir (e.g. `['llms.txt']`). Empty when the app declared none.
   *
   * Adapters whose runtime does not serve the client output directory at the
   * root (the Node adapter) use this to serve exactly these names and nothing
   * else. Adapters that already serve the whole client output at the root
   * (Cloudflare, via the ASSETS binding) can ignore it.
   */
  assetNames: readonly string[];
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
