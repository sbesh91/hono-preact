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
    expect(tail).toBe(
      `export { default } from "/p/node_modules/.vite/hono-preact/core-app.tsx";\n`
    );
  });

  it('exposes a vitePlugins function', () => {
    expect(typeof cloudflareAdapter().vitePlugins).toBe('function');
  });
});
