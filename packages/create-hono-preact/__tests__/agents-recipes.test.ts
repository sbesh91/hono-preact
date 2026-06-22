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
