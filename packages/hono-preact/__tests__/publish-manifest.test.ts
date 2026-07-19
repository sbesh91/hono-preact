import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { stripUnpublishedDevDeps } from '../scripts/publish-manifest.mjs';

describe('stripUnpublishedDevDeps', () => {
  const manifest = () => ({
    name: 'hono-preact',
    version: '0.11.1',
    devDependencies: {
      '@cloudflare/workers-types': '^4.20260515.0',
      '@hono-preact/iso': 'workspace:*',
      '@hono-preact/server': 'workspace:*',
      '@hono-preact/vite': 'workspace:*',
      typescript: '*',
    },
  });

  it('removes the three workspace-private devDependencies', () => {
    const result = stripUnpublishedDevDeps(manifest());
    expect(result.devDependencies).not.toHaveProperty('@hono-preact/iso');
    expect(result.devDependencies).not.toHaveProperty('@hono-preact/server');
    expect(result.devDependencies).not.toHaveProperty('@hono-preact/vite');
  });

  it('preserves the publishable devDependencies', () => {
    const result = stripUnpublishedDevDeps(manifest());
    expect(result.devDependencies).toEqual({
      '@cloudflare/workers-types': '^4.20260515.0',
      typescript: '*',
    });
  });

  it('preserves every other top-level field', () => {
    const result = stripUnpublishedDevDeps(manifest());
    expect(result.name).toBe('hono-preact');
    expect(result.version).toBe('0.11.1');
  });

  it('strips by key regardless of the spec form', () => {
    const pinned = manifest();
    pinned.devDependencies['@hono-preact/iso'] = '1.2.3';
    pinned.devDependencies['@hono-preact/server'] = 'file:../server';
    const result = stripUnpublishedDevDeps(pinned);
    expect(result.devDependencies).toEqual({
      '@cloudflare/workers-types': '^4.20260515.0',
      typescript: '*',
    });
  });

  it('does not mutate its argument or the nested devDependencies object', () => {
    const input = manifest();
    const before = structuredClone(input);
    const result = stripUnpublishedDevDeps(input);
    expect(input).toEqual(before);
    expect(result.devDependencies).not.toBe(input.devDependencies);
  });

  it('tolerates a manifest with no devDependencies', () => {
    const result = stripUnpublishedDevDeps({ name: 'x', version: '1.0.0' });
    expect(result).toEqual({ name: 'x', version: '1.0.0' });
  });
});

// Guards the packaging wiring nothing else asserts: the source-map exclusion
// (#279) and the pack lifecycle hooks (#281). A refactor could drop either with
// every other test still green, so pin them to the real manifest here.
describe('published package.json wiring', () => {
  const pkg = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../package.json', import.meta.url)),
      'utf8'
    )
  );

  it('excludes source maps immediately after dist in files', () => {
    const distIndex = pkg.files.indexOf('dist');
    expect(distIndex).toBeGreaterThanOrEqual(0);
    expect(pkg.files[distIndex + 1]).toBe('!dist/**/*.map');
  });

  it('wires prepack and postpack through publish-manifest.mjs', () => {
    expect(pkg.scripts.prepack).toContain('publish-manifest.mjs');
    expect(pkg.scripts.postpack).toContain('publish-manifest.mjs');
  });
});
