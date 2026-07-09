#!/usr/bin/env node
// Measures the docs-site's always-loaded client JS from the real vite build:
// the entry chunk plus its transitive STATIC-import closure. That closure is the
// framework runtime + preact/preact-iso vendor + site entry wiring that EVERY
// route downloads; dynamically-imported route chunks are lazy, so they are
// correctly excluded. This is the shipped-reality number the isolated framework
// probe cannot show (it measures features in isolation, never the co-located
// entry chunk). The value is in the head-vs-base delta on a framework PR: the
// site's own code is constant between the refs, so a delta is a framework change.
//
// Usage:
//   node scripts/measure-site-chunks.mjs                       # default dist -> stdout
//   node scripts/measure-site-chunks.mjs --static-dir DIR --out FILE
// --static-dir lets this HEAD script measure another ref's build (e.g. a base
// worktree) so the delta needs no committed baseline, mirroring the framework probe.

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STATIC_DIR = join(ROOT, 'apps/site/dist/client/static');

// Static import specifiers ("./x.js") in a built chunk. The vite client build
// emits `import"./x.js"` / `from"./x.js"` for static edges; lazy route chunks
// are reached via `import("./x.js")`, which this pattern intentionally skips so
// the closure stays "what every route eagerly loads".
const STATIC_IMPORT_RE = /(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g;

function staticImports(src) {
  const out = new Set();
  for (const [, spec] of src.matchAll(STATIC_IMPORT_RE)) {
    out.add(spec.replace(/^\.\//, ''));
  }
  return out;
}

// The generated client entry (client-entry.ts) hydrates into #app; that call is
// unique to it, so it identifies the always-loaded entry chunk regardless of its
// content hash. Exactly one match is expected; anything else means the entry
// template changed and this script must be revisited, so it fails loudly.
// The quote may be ", ', or ` depending on the minifier's choice.
const ENTRY_SIGNATURE = /getElementById\(\s*['"`]app['"`]\s*\)/;

export function findEntryChunk(staticDir) {
  const matches = readdirSync(staticDir).filter(
    (f) =>
      f.endsWith('.js') &&
      ENTRY_SIGNATURE.test(readFileSync(join(staticDir, f), 'utf8'))
  );
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one entry chunk (hydrates #app) in ${staticDir}, found ${matches.length}${matches.length ? `: ${matches.join(', ')}` : ''}`
    );
  }
  return matches[0];
}

// Transitive static-import closure from the entry chunk.
export function entryClosure(staticDir, entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur) || !existsSync(join(staticDir, cur))) continue;
    seen.add(cur);
    stack.push(...staticImports(readFileSync(join(staticDir, cur), 'utf8')));
  }
  return seen;
}

// The always-loaded baseline: gzip (summed per-chunk, since each chunk is a
// separate file the CDN gzips independently) + raw + chunk count. Returns null
// when the dist is absent so a partial CI run degrades gracefully. Uses zlib's
// default gzip level, matching measure-framework-size.mjs so the two comment
// sections share one gzip convention.
export function measureSiteBaseline(staticDir) {
  if (!existsSync(staticDir)) return null;
  const closure = entryClosure(staticDir, findEntryChunk(staticDir));
  let raw = 0;
  let gzip = 0;
  for (const f of closure) {
    const buf = readFileSync(join(staticDir, f));
    raw += buf.length;
    gzip += gzipSync(buf).length;
  }
  return { baseline: { gzip, raw, chunks: closure.size } };
}

// Written by the vite client build next to `static/` (see
// packages/vite/src/preload-manifest.ts). Its `routeCss` map gives, per route
// pattern, the CSS asset URLs (`/static/<file>.css`) that route's chain
// imports; the entry's own eagerly-loaded sheet (the global stylesheet linked
// by the Layout, e.g. root-*.css) is deliberately excluded from every route's
// list there, so it is identified below as the CSS asset no route references.
const PRELOAD_MANIFEST_FILE = '__hp-preload.json';

function gzipMeasure(buf) {
  return { raw: buf.length, gzip: gzipSync(buf).length };
}

function sumGzipMeasure(measures) {
  return measures.reduce(
    (acc, m) => ({ raw: acc.raw + m.raw, gzip: acc.gzip + m.gzip }),
    { raw: 0, gzip: 0 }
  );
}

// The always-loaded global CSS (gzip + raw + file count) plus a per-route
// breakdown of route-scoped CSS, read from the client build's routeCss map.
// Returns null when the dist or its preload manifest is absent, mirroring
// measureSiteBaseline's graceful degradation for a partial CI run.
export function measureSiteCss(staticDir) {
  const manifestPath = join(dirname(staticDir), PRELOAD_MANIFEST_FILE);
  if (!existsSync(staticDir) || !existsSync(manifestPath)) return null;

  const { routeCss = {} } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const cssFile = (url) => url.replace(/^\/static\//, '');

  const referenced = new Set();
  const routes = {};
  for (const [pattern, urls] of Object.entries(routeCss)) {
    const measures = urls.map((url) => {
      referenced.add(cssFile(url));
      return gzipMeasure(readFileSync(join(staticDir, cssFile(url))));
    });
    routes[pattern] = sumGzipMeasure(measures);
  }

  const globalFiles = readdirSync(staticDir).filter(
    (f) => f.endsWith('.css') && !referenced.has(f)
  );
  const global = sumGzipMeasure(
    globalFiles.map((f) => gzipMeasure(readFileSync(join(staticDir, f))))
  );

  return { global: { ...global, files: globalFiles.length }, routes };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? undefined : v;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const staticDir = resolve(arg('static-dir') ?? DEFAULT_STATIC_DIR);
  const css = measureSiteCss(staticDir);
  const report = {
    ...(measureSiteBaseline(staticDir) ?? {}),
    ...(css ? { css } : {}),
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  const out = arg('out');
  if (out) {
    writeFileSync(out, json);
    console.log(`Wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
}
