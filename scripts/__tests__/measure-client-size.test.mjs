import { describe, it, expect } from 'vitest';
import { bundleSize, measureSectionA } from '../measure-client-size.mjs';

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

describe('measureSectionA', () => {
  it('returns core plus every feature bucket with non-negative marginals', async () => {
    const a = await measureSectionA();
    expect(Object.keys(a)).toContain('core');
    expect(a.core.total.gzip).toBeGreaterThan(0);
    for (const bucket of ['loaders', 'actions', 'transitions', 'prefetch', 'streaming', 'guards', 'head', 'persist', 'middleware']) {
      expect(a[bucket].total.gzip).toBeGreaterThan(0);
      expect(a[bucket].marginalOverCore.gzip).toBeGreaterThanOrEqual(0);
    }
  });
});
