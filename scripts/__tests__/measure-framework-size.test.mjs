import { describe, it, expect } from 'vitest';
import {
  bundleSize,
  measureSectionA,
  measureSectionC,
} from '../measure-framework-size.mjs';
import { resolve } from 'node:path';

const ISO = resolve('packages/iso/dist');
const UI = resolve('packages/ui/dist');

describe('bundleSize', () => {
  it('returns positive gzip for a real iso module', async () => {
    const entry = `export * as m from '${resolve('packages/iso/dist/is-browser.js')}';`;
    expect(await bundleSize(entry, process.cwd())).toBeGreaterThan(0);
  });

  it('excludes peers (external) so a preact-only entry is a tiny shim', async () => {
    expect(await bundleSize(`export * as h from 'preact';`, process.cwd())).toBeLessThan(200);
  });
});

describe('measureSectionA', () => {
  it('returns core plus every feature with non-negative marginal', async () => {
    const a = await measureSectionA(ISO);
    expect(a.core.total).toBeGreaterThan(0);
    expect(a.core.marginal).toBe(a.core.total);
    for (const bucket of ['loaders', 'actions', 'transitions', 'prefetch', 'streaming', 'head', 'middleware']) {
      expect(a[bucket].total).toBeGreaterThan(0);
      expect(a[bucket].marginal).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('measureSectionC', () => {
  it('returns ui-core plus components with non-negative marginal', async () => {
    const c = await measureSectionC(UI);
    expect(c['ui-core'].total).toBeGreaterThan(0);
    expect(c.dialog.total).toBeGreaterThan(0);
    expect(c.dialog.marginal).toBeGreaterThanOrEqual(0);
  });

  it('returns {} when the ui dist is absent', async () => {
    expect(await measureSectionC(resolve('packages/ui/does-not-exist'))).toEqual({});
  });
});
