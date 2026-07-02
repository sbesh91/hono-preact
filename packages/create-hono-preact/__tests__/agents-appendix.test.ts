import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from 'hono-preact';
import * as page from 'hono-preact/page';
import * as server from 'hono-preact/server';
import * as viteApi from 'hono-preact/vite';
import * as cloudflare from 'hono-preact/adapter-cloudflare';
import * as node from 'hono-preact/adapter-node';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const agentsMd = readFileSync(
  resolve(here, '..', 'templates', 'agents', 'AGENTS.md'),
  'utf8'
);
const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, 'packages/hono-preact/package.json'), 'utf8')
);

function publicSubpaths(): string[] {
  return Object.keys(pkg.exports)
    .filter((k) => !k.includes('/internal'))
    .map((k) =>
      k === '.' ? 'hono-preact' : `hono-preact/${k.slice('./'.length)}`
    );
}

// The real runtime export surface of each documentable subpath, keyed by the
// subpath string as it appears in AGENTS.md. Resolved through the vitest
// aliases in the root config (same mechanism as exports-coverage), so this is
// the live barrel, not a hand-maintained list.
const BARRELS: Record<string, Record<string, unknown>> = {
  'hono-preact': root,
  'hono-preact/page': page,
  'hono-preact/server': server,
  'hono-preact/vite': viteApi,
  'hono-preact/adapter-cloudflare': cloudflare,
  'hono-preact/adapter-node': node,
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// Parse the "Public entry points" section into (subpath, cited export names).
// Contract: in that section each subpath bullet cites its exports as bare
// identifier code spans (`defineLoader`). The subpath spans themselves carry a
// hyphen/slash and usage examples carry punctuation, so neither matches
// IDENTIFIER; only genuine export citations are collected. Names cited as bare
// identifiers here MUST be real runtime exports of that subpath's barrel.
function citedExportsBySubpath(): Array<{ subpath: string; names: string[] }> {
  const section = agentsMd
    .slice(agentsMd.indexOf('## Public entry points'))
    .split(/\n## /)[0];
  // Group each subpath bullet with its (indented) continuation lines. A new
  // list item (`- `) ends the current bullet; anything else is continuation.
  const out: Array<{ subpath: string; lines: string[] }> = [];
  let current: { subpath: string; lines: string[] } | undefined;
  for (const line of section.split('\n')) {
    const bullet = line.match(/^- `(hono-preact(?:\/[a-z-]+)?)`/);
    if (bullet) {
      current = { subpath: bullet[1], lines: [line] };
      out.push(current);
    } else if (line.startsWith('- ')) {
      current = undefined; // a non-subpath list item closes the group
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out.map(({ subpath, lines }) => ({
    subpath,
    names: [...lines.join('\n').matchAll(/`([^`]+)`/g)]
      .map((s) => s[1])
      .filter((s) => IDENTIFIER.test(s)),
  }));
}

describe('AGENTS.md public entry-point appendix', () => {
  it('lists every public subpath as a code span', () => {
    for (const subpath of publicSubpaths()) {
      expect(agentsMd, `missing \`${subpath}\``).toContain(`\`${subpath}\``);
    }
  });

  it('does not reference a non-existent subpath', () => {
    const allowed = new Set(publicSubpaths());
    const referenced = [
      ...agentsMd.matchAll(/`(hono-preact(?:\/[a-z-]+)?)`/g),
    ].map((m) => m[1]);
    for (const ref of referenced) {
      expect(allowed.has(ref), `unknown subpath \`${ref}\``).toBe(true);
    }
  });

  it('cites only real exports under each subpath', () => {
    const cited = citedExportsBySubpath();
    // Guard against a silently-empty parse (a heading rename, a bullet whose
    // continuation lines got dropped): every entry-point subpath bullet cites
    // at least one export, so a zero here means the parser, not the doc, broke.
    expect(cited.map((c) => c.subpath).sort()).toEqual(
      Object.keys(BARRELS).sort()
    );
    for (const { subpath, names } of cited) {
      expect(
        names.length,
        `no exports parsed for \`${subpath}\``
      ).toBeGreaterThan(0);
    }

    for (const { subpath, names } of cited) {
      const barrel = BARRELS[subpath];
      expect(barrel, `no barrel wired for \`${subpath}\``).toBeDefined();
      const real = new Set(Object.keys(barrel).filter((k) => k !== 'default'));
      for (const name of names) {
        expect(
          real.has(name),
          `AGENTS.md cites \`${name}\` under \`${subpath}\`, which does not export it`
        ).toBe(true);
      }
    }
  });
});
