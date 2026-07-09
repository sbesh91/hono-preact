import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findEntryChunk,
  entryClosure,
  measureSiteBaseline,
  measureSiteCss,
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

// A synthetic client build for the CSS measurement: a `static/` dir holding the
// always-loaded global sheet (root-*.css, not referenced by any route) plus a
// route-scoped sheet, and a sibling `__hp-preload.json` whose `routeCss` map
// points a route pattern at that route sheet's URL. Mirrors the real build's
// layout (dist/client/__hp-preload.json next to dist/client/static/).
function makeCssFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'site-css-'));
  const staticDir = join(dir, 'static');
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, 'root-AAA.css'), 'body{margin:0}'.repeat(20));
  writeFileSync(join(staticDir, 'home-BBB.css'), '.home{color:red}'.repeat(20));
  writeFileSync(
    join(staticDir, 'DocsLayout-CCC.css'),
    '.docs{color:blue}'.repeat(20)
  );
  writeFileSync(
    join(dir, '__hp-preload.json'),
    JSON.stringify({
      closure: [],
      routes: {},
      routeCss: {
        '/': ['/static/home-BBB.css'],
        '/docs/actions': ['/static/DocsLayout-CCC.css'],
      },
    })
  );
  return staticDir;
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

  it('measures the global stylesheet and per-route CSS gzip bytes', () => {
    const r = measureSiteCss(makeCssFixture());
    expect(r.global.gzip).toBeGreaterThan(0);
    expect(r.global.raw).toBeGreaterThan(0);
    expect(r.routes['/'].gzip).toBeGreaterThan(0);
    expect(r.routes['/'].raw).toBeGreaterThan(0);
    expect(r.routes['/docs/actions'].gzip).toBeGreaterThan(0);
  });

  it('excludes route-scoped sheets from the global measurement', () => {
    const r = measureSiteCss(makeCssFixture());
    // root-AAA.css is the only sheet not referenced by routeCss, so it alone
    // makes up the global bytes; a route sheet leaking in would inflate this.
    expect(r.global.files).toBe(1);
  });

  it('returns null when the preload manifest is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-css-nomanifest-'));
    const staticDir = join(dir, 'static');
    mkdirSync(staticDir);
    expect(measureSiteCss(staticDir)).toBe(null);
  });
});
