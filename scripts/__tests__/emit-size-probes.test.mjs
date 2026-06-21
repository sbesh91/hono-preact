import { describe, it, expect } from 'vitest';
import { emitProbe, emitAllProbes } from '../emit-size-probes.mjs';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiDistPresent = existsSync(
  fileURLToPath(new URL('../../packages/ui/dist', import.meta.url))
);

describe('emitProbe', () => {
  it('writes a non-empty minified bundle for a real iso module', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const out = join(dir, 'core.js');
    await emitProbe(
      `export * as m from './packages/iso/dist/is-browser.js';`,
      out
    );
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it('excludes peers (external) so a preact-only entry is a tiny shim', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const out = join(dir, 'peer.js');
    await emitProbe(`export * as h from 'preact';`, out);
    // preact is external, so the bundle is just a re-export shim.
    expect(statSync(out).size).toBeLessThan(200);
  });
});

describe('emitAllProbes', () => {
  it('emits one framework probe per core+feature entry (always)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probes-'));
    const written = await emitAllProbes(dir);
    expect(existsSync(join(dir, 'framework', 'core.js'))).toBe(true);
    expect(existsSync(join(dir, 'framework', 'loaders.js'))).toBe(true);
    expect(existsSync(join(dir, 'framework', 'actions.js'))).toBe(true);
    // core + 7 feature entries = 8 framework probes
    const frameworkProbes = written.filter((p) => p.includes('/framework/'));
    expect(frameworkProbes).toHaveLength(8);
    for (const p of frameworkProbes) expect(statSync(p).size).toBeGreaterThan(0);
  });

  it.skipIf(!uiDistPresent)(
    'emits ui probes per component when packages/ui/dist is present',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'probes-ui-'));
      const written = await emitAllProbes(dir);
      expect(existsSync(join(dir, 'ui', 'core.js'))).toBe(true);
      expect(existsSync(join(dir, 'ui', 'dialog.js'))).toBe(true);
      // framework (8) + at least a few ui probes
      expect(written.length).toBeGreaterThan(10);
      const uiProbes = written.filter((p) => p.includes('/ui/'));
      for (const p of uiProbes) expect(statSync(p).size).toBeGreaterThan(0);
    }
  );
});
