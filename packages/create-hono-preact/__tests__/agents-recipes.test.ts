import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(here, '..', 'templates', 'agents');

const skillsDir = resolve(agentsDir, 'skills');
const agentsMd = readFileSync(resolve(agentsDir, 'AGENTS.md'), 'utf8');
const skillFiles = readdirSync(skillsDir).filter((f) => f.endsWith('.md'));
const linked = [...agentsMd.matchAll(/agents\/skills\/([a-z0-9-]+\.md)/g)].map(
  (m) => m[1]
);

describe('AGENTS.md recipe index', () => {
  it('links every recipe file', () => {
    for (const f of skillFiles) {
      expect(linked, `recipe ${f} is not linked from AGENTS.md`).toContain(f);
    }
  });
  it('every recipe link resolves to a real file', () => {
    expect(linked.length).toBeGreaterThan(0);
    for (const name of linked) {
      expect(
        existsSync(resolve(skillsDir, name)),
        `dangling recipe link ${name}`
      ).toBe(true);
    }
  });
});

describe('bundled docs corpus', () => {
  it('is present and non-trivial (run `pnpm gen:agents-corpus`)', () => {
    const corpus = resolve(agentsDir, 'llms-full.txt');
    expect(existsSync(corpus), `${corpus} missing`).toBe(true);
    expect(readFileSync(corpus, 'utf8').length).toBeGreaterThan(1000);
  });
});

describe('recipes teach current idioms', () => {
  // Explicit `server:` wiring is an advanced override since auto-discovery;
  // recipes must not present it as the normal path.
  it('no recipe wires server: by hand', () => {
    for (const f of skillFiles) {
      const body = readFileSync(resolve(skillsDir, f), 'utf8');
      expect(body, `${f} still shows explicit server: wiring`).not.toMatch(
        /server:\s*\(\)\s*=>\s*import/
      );
    }
  });

  // redirect/deny are exported from the hono-preact root (the recipes import
  // them there); AGENTS.md must not imply they live only on hono-preact/page.
  it('AGENTS.md lists redirect and deny on the root entry point', () => {
    // The root bullet wraps across lines; slice from its start to the
    // hono-preact/page bullet and assert within that span.
    const start = agentsMd.indexOf('- `hono-preact` -');
    const end = agentsMd.indexOf('- `hono-preact/page`');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const rootBullet = agentsMd.slice(start, end);
    expect(rootBullet).toContain('`redirect`');
    expect(rootBullet).toContain('`deny`');
  });
});
