import { describe, it, expect } from 'vitest';
import { bundleSize } from '../measure-client-size.mjs';

describe('bundleSize', () => {
  it('returns positive gzip/brotli sizes for a real iso module', async () => {
    // Re-export a small iso dist module by namespace so sideEffects:false
    // tree-shaking cannot drop it (entry-point exports are always kept).
    const entry = `export * as m from './packages/iso/dist/is-browser.js';`;
    const size = await bundleSize(entry, process.cwd());
    expect(size.gzip).toBeGreaterThan(0);
    expect(size.brotli).toBeGreaterThan(0);
    expect(size.raw).toBeGreaterThanOrEqual(size.gzip);
  });

  it('excludes peers (external) from the measured bytes', async () => {
    const withPreact = `export * as h from 'preact';`;
    const size = await bundleSize(withPreact, process.cwd());
    // preact is external, so the bundle is just a re-export shim: tiny.
    expect(size.raw).toBeLessThan(200);
  });
});
