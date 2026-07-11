import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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
// always-loaded residual global sheet (root-*.css) plus a route-scoped sheet,
// and a sibling `__hp-preload.json` whose `routeCss` map points a route
// pattern at that route sheet's URL and whose `globalCss` field explicitly
// lists the residual sheet's URL, mirroring the real css-auto-split artifact
// (dist/client/__hp-preload.json next to dist/client/static/).
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
      globalCss: ['/static/root-AAA.css'],
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

  it('skips manifest CSS URLs whose file is missing instead of throwing', () => {
    // A stale/partial base-ref build (client-size CI job) or an asset outside
    // /static/ must degrade to skipping that file, not fail the whole job.
    const staticDir = makeCssFixture();
    const manifestPath = join(dirname(staticDir), '__hp-preload.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.routeCss['/'].push('/static/gone-EEE.css');
    manifest.routeCss['/demo'] = ['/assets/outside-FFF.css'];
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const r = measureSiteCss(staticDir);
    // '/' still measures its present sheet; the missing one contributes 0.
    expect(r.routes['/'].gzip).toBeGreaterThan(0);
    // A route whose only sheet is unresolvable measures as 0 bytes.
    expect(r.routes['/demo']).toEqual({ raw: 0, gzip: 0 });
  });

  it('excludes route-scoped sheets from the global measurement', () => {
    const r = measureSiteCss(makeCssFixture());
    // root-AAA.css is the manifest's own globalCss entry and the only sheet
    // not referenced by routeCss, so it alone makes up the global bytes; a
    // route sheet leaking in would inflate this.
    expect(r.global.files).toBe(1);
  });

  it('counts a globalCss-listed file exactly once even if routeCss also references it', () => {
    // Defensive case: the real artifact never lists a sheet in both maps, but
    // the measurement must still be exact (not double-counted) if it ever did,
    // proving `globalCss` is unioned with the heuristic rather than replacing
    // it or being additively summed.
    const dir = mkdtempSync(join(tmpdir(), 'site-css-dup-'));
    const staticDir = join(dir, 'static');
    mkdirSync(staticDir);
    writeFileSync(join(staticDir, 'root-AAA.css'), 'body{margin:0}'.repeat(20));
    writeFileSync(
      join(dir, '__hp-preload.json'),
      JSON.stringify({
        closure: [],
        routes: {},
        routeCss: { '/': ['/static/root-AAA.css'] },
        globalCss: ['/static/root-AAA.css'],
      })
    );

    const r = measureSiteCss(staticDir);
    expect(r.global.files).toBe(1);
    expect(r.routes['/'].gzip).toBeGreaterThan(0);
  });

  it('includes a globalCss-listed file even when nothing marks it unreferenced', () => {
    // If a future change causes a residual sheet to also show up in some
    // route's routeCss list (so the unreferenced-file heuristic alone would
    // miss it), the explicit globalCss field must still surface it as global.
    const dir = mkdtempSync(join(tmpdir(), 'site-css-explicit-'));
    const staticDir = join(dir, 'static');
    mkdirSync(staticDir);
    writeFileSync(join(staticDir, 'root-AAA.css'), 'body{margin:0}'.repeat(20));
    writeFileSync(
      join(staticDir, 'home-BBB.css'),
      '.home{color:red}'.repeat(20)
    );
    writeFileSync(
      join(dir, '__hp-preload.json'),
      JSON.stringify({
        closure: [],
        routes: {},
        // root-AAA.css is (unrealistically) also referenced here; only the
        // explicit globalCss field, not the heuristic, would still catch it.
        routeCss: { '/': ['/static/home-BBB.css', '/static/root-AAA.css'] },
        globalCss: ['/static/root-AAA.css'],
      })
    );

    const r = measureSiteCss(staticDir);
    expect(r.global.files).toBe(1);
  });

  it('counts only globalCss files present on disk, and bytes match that set', () => {
    // Stale/partial base-ref build (client-size CI job): a globalCss entry
    // whose file is absent must be skipped from BOTH the byte sums and the
    // file count, so `files` never over-reports what was actually measured.
    const dir = mkdtempSync(join(tmpdir(), 'site-css-missing-global-'));
    const staticDir = join(dir, 'static');
    mkdirSync(staticDir);
    const present = 'body{margin:0}'.repeat(20);
    writeFileSync(join(staticDir, 'global-AAA.css'), present);
    writeFileSync(
      join(dir, '__hp-preload.json'),
      JSON.stringify({
        closure: [],
        routes: {},
        routeCss: {},
        globalCss: ['/static/global-AAA.css', '/static/gone-BBB.css'],
      })
    );

    const r = measureSiteCss(staticDir);
    expect(r.global.files).toBe(1);
    expect(r.global.raw).toBe(present.length);
    expect(r.global.gzip).toBeGreaterThan(0);
  });

  it('returns null when the preload manifest is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-css-nomanifest-'));
    const staticDir = join(dir, 'static');
    mkdirSync(staticDir);
    expect(measureSiteCss(staticDir)).toBe(null);
  });
});
