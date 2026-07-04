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
function citedExportsBySubpath(
  md: string = agentsMd
): Array<{ subpath: string; names: string[] }> {
  const section = md
    .slice(md.indexOf('## Public entry points'))
    .split(/\n## /)[0];
  // Group each subpath bullet with its INDENTED continuation lines. A new list
  // item (`- `), a blank line, or unindented prose ends the current bullet, so
  // trailing section prose is never glued onto the last subpath's citations.
  const out: Array<{ subpath: string; lines: string[] }> = [];
  let current: { subpath: string; lines: string[] } | undefined;
  for (const line of section.split('\n')) {
    const bullet = line.match(/^- `(hono-preact(?:\/[a-z-]+)?)`/);
    if (bullet) {
      current = { subpath: bullet[1], lines: [line] };
      out.push(current);
    } else if (line.startsWith('- ')) {
      current = undefined; // a non-subpath list item closes the group
    } else if (current && /^\s/.test(line)) {
      current.lines.push(line); // an indented continuation of the current bullet
    } else {
      current = undefined; // a blank line or unindented prose closes the group
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

  // Regression (#222 item 20): the section's trailing prose paragraph (today the
  // "UI component library is a separate package" note) is NOT a bullet and is
  // unindented, so it must not be glued onto the last subpath bullet. Only a
  // subpath bullet's own line and its INDENTED continuation lines are its
  // citations. Without the indent boundary, a future backticked identifier in
  // that prose (e.g. `Dialog`) would be mis-cited as an export of the last
  // subpath and wrongly fail (or, worse, wrongly pass) the gate above.
  it('does not attribute a backticked identifier in trailing prose to the last subpath', () => {
    const synthetic = [
      '## Public entry points',
      '',
      '- `hono-preact` - routing',
      '  (`defineRoutes`, `useParams`).',
      '- `hono-preact/adapter-node` - `nodeAdapter` for Node.',
      '',
      'The UI component library is a separate package, `hono-preact-ui` (`Dialog`).',
      '',
      '## Recipes',
    ].join('\n');
    const parsed = citedExportsBySubpath(synthetic);
    const rootNames =
      parsed.find((c) => c.subpath === 'hono-preact')?.names ?? [];
    const nodeNames =
      parsed.find((c) => c.subpath === 'hono-preact/adapter-node')?.names ?? [];

    // An indented continuation line IS part of its bullet's citations.
    expect(rootNames).toEqual(
      expect.arrayContaining(['defineRoutes', 'useParams'])
    );
    // The bullet's own line IS part of its citations.
    expect(nodeNames).toContain('nodeAdapter');
    // The unindented trailing prose is NOT glued onto the last bullet.
    expect(nodeNames).not.toContain('Dialog');
  });
});
