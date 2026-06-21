import { describe, it, expect } from 'vitest';
import { emitProbe, emitAllProbes } from '../emit-size-probes.mjs';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  it('emits a framework probe per core+feature entry and a ui probe per component', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probes-'));
    const written = await emitAllProbes(dir);
    expect(existsSync(join(dir, 'framework', 'core.js'))).toBe(true);
    expect(existsSync(join(dir, 'framework', 'loaders.js'))).toBe(true);
    expect(existsSync(join(dir, 'framework', 'actions.js'))).toBe(true);
    // packages/ui/dist is built in CI before tests, so ui probes are emitted.
    expect(existsSync(join(dir, 'ui', 'core.js'))).toBe(true);
    expect(existsSync(join(dir, 'ui', 'dialog.js'))).toBe(true);
    expect(written.length).toBeGreaterThan(10);
    for (const p of written) expect(statSync(p).size).toBeGreaterThan(0);
  });
});
