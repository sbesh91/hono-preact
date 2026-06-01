import { describe, it, expect } from 'vitest';
import { bundleSize, measureSectionA, measureSectionB, historyRow } from '../measure-client-size.mjs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('measureSectionB', () => {
  it('gzip-sizes files and sums them into buckets + total', () => {
    const dir = mkdtempSync(join(tmpdir(), 'size-'));
    const staticDir = join(dir, 'client', 'static');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'guard-AAA.js'), 'a'.repeat(500));
    writeFileSync(join(staticDir, 'router-BBB.js'), 'b'.repeat(500));
    writeFileSync(join(staticDir, 'home-CCC.js'), 'c'.repeat(500));

    const section = measureSectionB(dir);
    expect(section.buckets.guards).toBeGreaterThan(0);
    expect(section.buckets.core).toBeGreaterThan(0);
    expect(section.buckets.app).toBeGreaterThan(0);
    expect(section.total).toBe(
      section.buckets.guards + section.buckets.core + section.buckets.app
    );
  });
});

describe('historyRow', () => {
  it('produces a gzip-only row stamped with the passed sha/date', () => {
    const report = {
      sectionA: {
        core: { total: { gzip: 100 }, marginalOverCore: { gzip: 100 } },
        actions: { total: { gzip: 80 }, marginalOverCore: { gzip: 30 } },
      },
      sectionB: { buckets: { core: 200, app: 50 }, total: 250 },
    };
    const row = historyRow(report, 'abc123', '2026-06-01T00:00:00Z');
    expect(row).toEqual({
      sha: 'abc123',
      date: '2026-06-01T00:00:00Z',
      sectionA: { core: 100, actions: 30 },
      sectionB: { buckets: { core: 200, app: 50 }, total: 250 },
    });
  });
});
