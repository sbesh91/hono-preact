import { describe, it, expect } from 'vitest';
import { cloudflareAdapter } from '../adapter-cloudflare.js';

const ctx = {
  root: '/p',
  coreAppModuleId: '/p/node_modules/.vite/hono-preact/core-app.tsx',
  entryWrapperId: '/p/node_modules/.vite/hono-preact/server-entry.tsx',
};

describe('cloudflareAdapter', () => {
  it('is named "cloudflare"', () => {
    expect(cloudflareAdapter().name).toBe('cloudflare');
  });

  it('wrapEntry re-exports the core app module default', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    // The worker's default export is the core Hono app (a valid Workers fetch
    // handler); the core module is imported by its absolute path.
    expect(tail).toContain(
      `import coreApp, { serverImports as __hpServerImports } from "/p/node_modules/.vite/hono-preact/core-app.tsx";`
    );
    expect(tail).toContain('return coreApp.fetch(request, env, ctx);');
  });

  it('wrapEntry re-exports the Durable Object class under the wrangler-bound name', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    // wrangler.jsonc binds `class_name: "HonoPreactRealtimeDO"`, resolved
    // against this worker module's exports, so the class must be a named export.
    expect(tail).toContain(
      'export class HonoPreactRealtimeDO extends __HonoPreactRealtimeDO {}'
    );
  });

  it('wrapEntry imports the DO/connector/registry from the Cloudflare-only server door', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    // The Cloudflare-only door is SEPARATE from .../internal/runtime because the
    // DO module value-imports `cloudflare:workers` (workerd-only). The Node
    // entry must never load it.
    expect(tail).toContain(`from 'hono-preact/server/internal/cloudflare'`);
    expect(tail).toContain('HonoPreactRealtimeDO as __HonoPreactRealtimeDO');
    expect(tail).toContain('makeCfForwardConnector');
    expect(tail).toContain('installRoomRegistry');
    expect(tail).toContain('buildRoomRegistry');
  });

  it('wrapEntry installs the room registry from the core module serverImports', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    expect(tail).toContain(
      'installRoomRegistry(() => buildRoomRegistry(__hpServerImports));'
    );
  });

  it('wrapEntry installs the forward connector off the HONO_PREACT_REALTIME binding', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    // installRealtimeConnector is on the platform-free iso runtime door,
    // now imported alongside installPubSubBackend in a multi-name block.
    expect(tail).toContain(`from 'hono-preact/internal/runtime';`);
    expect(tail).toContain('installRealtimeConnector');
    // The binding is read as a bracketed string access so any binding name is
    // safe; the same name is passed through so the missing-binding error names
    // the developer's actual env key.
    expect(tail).toContain(
      'makeCfForwardConnector((c) => c.env?.["HONO_PREACT_REALTIME"], "HONO_PREACT_REALTIME")'
    );
    expect(tail).toContain('installRealtimeConnector(');
  });

  it('wrapEntry honors custom realtimeBinding and realtimeClass names', () => {
    const tail = cloudflareAdapter({
      realtimeBinding: 'MY_REALTIME',
      realtimeClass: 'MyRealtimeDO',
    }).wrapEntry(ctx);
    // Binding name flows into both the env access and the error-naming arg.
    expect(tail).toContain(
      'makeCfForwardConnector((c) => c.env?.["MY_REALTIME"], "MY_REALTIME")'
    );
    // Class name flows into the re-export declaration wrangler binds against.
    expect(tail).toContain(
      'export class MyRealtimeDO extends __HonoPreactRealtimeDO {}'
    );
    // The default names must NOT appear when overridden.
    expect(tail).not.toContain('HONO_PREACT_REALTIME');
    expect(tail).not.toContain(
      'export class HonoPreactRealtimeDO extends __HonoPreactRealtimeDO'
    );
  });

  it('rejects a realtimeClass that is not a valid JS identifier', () => {
    // Emitted as a `class` declaration name, so a non-identifier would produce
    // a syntactically broken entry; fail loud at config time instead.
    expect(() => cloudflareAdapter({ realtimeClass: 'has space' })).toThrow(
      /realtimeClass must be a valid JavaScript identifier/
    );
    expect(() => cloudflareAdapter({ realtimeClass: '1bad' })).toThrow(
      /realtimeClass must be a valid JavaScript identifier/
    );
  });

  it('wrapEntry installs the CF pub/sub backend off the captured runtime', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    // installPubSubBackend is on the platform-free iso runtime door, imported
    // alongside installRealtimeConnector in a multi-name block.
    expect(tail).toContain(`from 'hono-preact/internal/runtime';`);
    expect(tail).toContain('installPubSubBackend');
    expect(tail).toContain('captureRealtimeRuntime');
    expect(tail).toContain('getRealtimeRuntime');
    // The install is emitted across lines (installPubSubBackend(\n  make...\n));
    // assert the call name and the contiguous inner call separately, matching
    // how the existing makeCfForwardConnector assertion is written.
    expect(tail).toContain('installPubSubBackend(');
    expect(tail).toContain(
      'makeCfPubSubBackend(getRealtimeRuntime, "HONO_PREACT_REALTIME")'
    );
  });

  it('wrapEntry wraps the default export to capture { env, ctx } at the fetch boundary', () => {
    const tail = cloudflareAdapter().wrapEntry(ctx);
    expect(tail).toContain('captureRealtimeRuntime(env, ctx);');
    expect(tail).toContain('return coreApp.fetch(request, env, ctx);');
    // The bare `export default coreApp;` is replaced by the wrapper.
    expect(tail).not.toContain('export default coreApp;');
  });

  it('wrapEntry threads a custom binding into the pub/sub backend too', () => {
    const tail = cloudflareAdapter({ realtimeBinding: 'MY_REALTIME' }).wrapEntry(ctx);
    expect(tail).toContain(
      'makeCfPubSubBackend(getRealtimeRuntime, "MY_REALTIME")'
    );
  });

  it('exposes a vitePlugins function', () => {
    expect(typeof cloudflareAdapter().vitePlugins).toBe('function');
  });
});
