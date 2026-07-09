import { describe, it, expect } from 'vitest';
import {
  bundleSize,
  measureSectionA,
  measureSectionC,
} from '../measure-framework-size.mjs';
import { FEATURE_MODULES } from '../size-probe-config.mjs';
import { resolve, join } from 'node:path';
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

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
    for (const bucket of Object.keys(FEATURE_MODULES)) {
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

describe('a manifest module absent from the measured dist', () => {
  // Reproduces the CI crash this guards against: a PR adds a module to a
  // FEATURE_MODULES bucket (this repo added boot-client.js to `runtime`), and
  // the CI size job then measures the BASE ref's dist, which predates that
  // addition and does not contain the file. Without filtering the bucket's
  // module list against the dist being measured, esbuild fails to resolve the
  // missing path and the whole measurement throws.
  it('measures the bucket without it instead of throwing', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'iso-dist-missing-module-'));
    try {
      cpSync(ISO, tmp, { recursive: true });
      rmSync(join(tmp, 'boot-client.js'));
      expect(existsSync(join(tmp, 'boot-client.js'))).toBe(false);

      const a = await measureSectionA(tmp);
      expect(a.runtime.total).toBeGreaterThan(0);
      expect(a.runtime.marginal).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
