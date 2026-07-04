import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findEntryChunk,
  entryClosure,
  measureSiteBaseline,
} from '../measure-site-chunks.mjs';

// A synthetic client build: an entry chunk that hydrates #app and statically
// imports a vendor chunk (which transitively imports a shared chunk), plus a
// route chunk that is only dynamically imported. The always-loaded closure is
// entry + vendor + shared; the lazy route chunk must be excluded.
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'site-chunks-'));
  writeFileSync(
    join(dir, 'entry-AAA.js'),
    'import"./vendor-BBB.js";document.getElementById("app");import("./route-CCC.js")'
  );
  writeFileSync(
    join(dir, 'vendor-BBB.js'),
    'import"./shared-DDD.js";export const v=1'
  );
  writeFileSync(join(dir, 'shared-DDD.js'), 'export const s=1');
  writeFileSync(join(dir, 'route-CCC.js'), 'export const r=1');
  return dir;
}

describe('measure-site-chunks', () => {
  it('finds the entry chunk by its #app hydrate signature', () => {
    expect(findEntryChunk(makeFixture())).toBe('entry-AAA.js');
  });

  it('throws when there is not exactly one entry chunk', () => {
    const empty = mkdtempSync(join(tmpdir(), 'site-chunks-empty-'));
    expect(() => findEntryChunk(empty)).toThrow(/exactly one entry/i);
  });

  it('closes over static imports only, excluding lazy route chunks', () => {
    const dir = makeFixture();
    const closure = entryClosure(dir, 'entry-AAA.js');
    expect([...closure].sort()).toEqual([
      'entry-AAA.js',
      'shared-DDD.js',
      'vendor-BBB.js',
    ]);
    expect(closure.has('route-CCC.js')).toBe(false);
  });

  it('measures the always-loaded baseline (gzip + raw + chunk count)', () => {
    const r = measureSiteBaseline(makeFixture());
    expect(r.baseline.chunks).toBe(3);
    expect(r.baseline.gzip).toBeGreaterThan(0);
    expect(r.baseline.raw).toBeGreaterThan(0);
  });

  it('returns null when the dist directory is absent', () => {
    expect(measureSiteBaseline('/no/such/static/dir')).toBe(null);
  });
});
