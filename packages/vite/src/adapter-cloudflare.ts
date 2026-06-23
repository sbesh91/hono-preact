// packages/vite/src/adapter-cloudflare.ts
//
// Standalone module. NOT re-exported by index.ts: importing `hono-preact/vite`
// must never pull in `@cloudflare/vite-plugin`. Only importing
// `hono-preact/adapter-cloudflare` loads this file.
import { cloudflare } from '@cloudflare/vite-plugin';
import type { Plugin } from 'vite';
import type { HonoPreactAdapter } from './adapter.js';

/**
 * Options for {@link cloudflareAdapter}. Both names default to the framework's
 * built-in values; override them to fit an existing `wrangler.jsonc` or a
 * naming convention. Whatever you pick must agree with `wrangler.jsonc` across
 * the binding `name`, the binding `class_name`, and the `new_sqlite_classes`
 * migration tag (see the rooms docs, "Cloudflare setup").
 */
export interface CloudflareAdapterOptions {
  /**
   * The Durable Object binding name the generated worker entry reads off
   * `c.env` to forward room upgrades. Must equal the `name` of your
   * `durable_objects.bindings` entry.
   * @default 'HONO_PREACT_REALTIME'
   */
  realtimeBinding?: string;
  /**
   * The Durable Object class name the generated entry re-exports (the name
   * wrangler resolves `class_name` against). Must equal both the `class_name`
   * of your `durable_objects.bindings` entry and the `new_sqlite_classes`
   * migration tag. Must be a valid JavaScript identifier: it is emitted as a
   * `class` declaration in the generated entry.
   * @default 'HonoPreactRealtimeDO'
   */
  realtimeClass?: string;
}

// A DO class name is emitted verbatim as a `class` declaration name in the
// generated entry, so it must be a bare JS identifier. The binding name is
// emitted as a bracketed string access (`c.env?.["..."]`), so it carries no
// such restriction.
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function cloudflareAdapter(
  options: CloudflareAdapterOptions = {}
): HonoPreactAdapter {
  const realtimeBinding = options.realtimeBinding ?? 'HONO_PREACT_REALTIME';
  const realtimeClass = options.realtimeClass ?? 'HonoPreactRealtimeDO';
  if (!IDENTIFIER_RE.test(realtimeClass)) {
    throw new Error(
      `hono-preact: cloudflareAdapter realtimeClass must be a valid ` +
        `JavaScript identifier (got ${JSON.stringify(realtimeClass)}); it is ` +
        `emitted as a class declaration in the generated worker entry.`
    );
  }
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
      //   1. Re-export the Durable Object class under `realtimeClass` (default
      //      `HonoPreactRealtimeDO`). wrangler binds `class_name` against THIS
      //      worker module's exports, so the class must be a named export of the
      //      entry. It is re-exported as a thin subclass (not a bare
      //      `export { ... }`) so the name and identity are owned here without
      //      aliasing the framework symbol.
      //   2. Install the room registry getter at module top level. The Durable
      //      Object runs in its own isolate and never sees request-time wiring,
      //      so it resolves room defs from `buildRoomRegistry(serverImports)` via
      //      the installed getter. `serverImports` is the core module's
      //      re-exported lazy `.server` loader array.
      //   3. Install the forward connector so socketsHandler, after guarding and
      //      resolving a room upgrade at the edge, forwards it to the topic's
      //      Durable Object (`idFromName(topic)`) via the `realtimeBinding`
      //      binding (default HONO_PREACT_REALTIME). No unauthorized connection
      //      reaches the DO: the connector is invoked only after the edge guard
      //      chain allows the upgrade.
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
        `  makeCfPubSubBackend,\n` +
        `  runWithRealtimeRuntime,\n` +
        `  getRealtimeRuntime,\n` +
        `  installRoomRegistry,\n` +
        `  buildRoomRegistry,\n` +
        `  installSocketRegistry,\n` +
        `  buildSocketRegistry,\n` +
        `} from 'hono-preact/server/internal/cloudflare';\n` +
        `import {\n` +
        `  installRealtimeConnector,\n` +
        `  installPubSubBackend,\n` +
        `} from 'hono-preact/internal/runtime';\n` +
        `\n` +
        `installRoomRegistry(() => buildRoomRegistry(__hpServerImports));\n` +
        `installSocketRegistry(() => buildSocketRegistry(__hpServerImports));\n` +
        `installRealtimeConnector(\n` +
        `  makeCfForwardConnector((c) => c.env?.[${JSON.stringify(
          realtimeBinding
        )}], ${JSON.stringify(realtimeBinding)})\n` +
        `);\n` +
        `// Cross-isolate pub/sub for live loaders + publish() rides the same DO\n` +
        `// binding (read-only topic subscriptions + a publish fan-out POST).\n` +
        `installPubSubBackend(\n` +
        `  makeCfPubSubBackend(getRealtimeRuntime, ${JSON.stringify(
          realtimeBinding
        )})\n` +
        `);\n` +
        `\n` +
        `// Re-export the Durable Object class under the name wrangler.jsonc binds.\n` +
        `export class ${realtimeClass} extends __HonoPreactRealtimeDO {}\n` +
        `\n` +
        `// Run each request inside its { env, ctx } so the CF pub/sub backend can\n` +
        `// reach the DO binding (env) and keep a publish fan-out alive past the\n` +
        `// response (ctx.waitUntil). AsyncLocalStorage (not a module global)\n` +
        `// because one workerd isolate multiplexes concurrent requests: a global\n` +
        `// would let a later request overwrite an earlier one's runtime between\n` +
        `// its capture and its publish().\n` +
        `export default {\n` +
        `  fetch(request, env, ctx) {\n` +
        `    return runWithRealtimeRuntime(env, ctx, () =>\n` +
        `      coreApp.fetch(request, env, ctx)\n` +
        `    );\n` +
        `  },\n` +
        `};\n`
      );
    },
  };
}
