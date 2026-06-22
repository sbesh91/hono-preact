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
      // A Hono app's default export is already a valid Workers fetch handler, so
      // the worker's `default` is the core app module's default. On top of that
      // the Cloudflare tail wires up rooms:
      //
      //   1. Re-export the Durable Object class as `HonoPreactRealtimeDO`. The
      //      generated wrangler.jsonc binds `class_name: "HonoPreactRealtimeDO"`,
      //      which wrangler resolves against THIS worker module's exports, so the
      //      class must be a named export of the entry. It is re-exported as a
      //      thin subclass (not `export { HonoPreactRealtimeDO }`) so the name
      //      and identity are owned here without aliasing the framework symbol.
      //   2. Install the room registry getter at module top level. The Durable
      //      Object runs in its own isolate and never sees request-time wiring,
      //      so it resolves room defs from `buildRoomRegistry(serverImports)` via
      //      the installed getter. `serverImports` is the core module's
      //      re-exported lazy `.server` loader array.
      //   3. Install the forward connector so socketsHandler, after guarding and
      //      resolving a room upgrade at the edge, forwards it to the topic's
      //      Durable Object (`idFromName(topic)`) via the HONO_PREACT_REALTIME
      //      binding. No unauthorized connection reaches the DO: the connector is
      //      invoked only after the edge guard chain allows the upgrade.
      //
      // The DO class, the connector factory, the registry installer, and
      // buildRoomRegistry all live behind hono-preact/server/internal/cloudflare,
      // a Cloudflare-ONLY door kept separate from .../internal/runtime because
      // the DO module value-imports `cloudflare:workers`, which resolves only in
      // workerd. installRealtimeConnector is on the platform-free iso runtime
      // door (hono-preact/internal/runtime). Only this generated CF entry imports
      // the Cloudflare door; the Node entry never does.
      return (
        `import coreApp, { serverImports as __hpServerImports } from ${JSON.stringify(
          ctx.coreAppModuleId
        )};\n` +
        `import {\n` +
        `  HonoPreactRealtimeDO as __HonoPreactRealtimeDO,\n` +
        `  makeCfForwardConnector,\n` +
        `  installRoomRegistry,\n` +
        `  buildRoomRegistry,\n` +
        `} from 'hono-preact/server/internal/cloudflare';\n` +
        `import { installRealtimeConnector } from 'hono-preact/internal/runtime';\n` +
        `\n` +
        `installRoomRegistry(() => buildRoomRegistry(__hpServerImports));\n` +
        `// The DO binding lives on the worker env. In the generated entry the\n` +
        `// Hono Context env is untyped (no project-supplied Bindings generic),\n` +
        `// so this reads the binding at the untyped-env boundary; the connector\n` +
        `// throws a clear configuration error if the binding is missing.\n` +
        `installRealtimeConnector(\n` +
        `  makeCfForwardConnector((c) => c.env?.HONO_PREACT_REALTIME)\n` +
        `);\n` +
        `\n` +
        `// Re-export the Durable Object class under the name wrangler.jsonc binds.\n` +
        `export class HonoPreactRealtimeDO extends __HonoPreactRealtimeDO {}\n` +
        `\n` +
        `export default coreApp;\n`
      );
    },
  };
}
