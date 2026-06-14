import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const agentsMd = readFileSync(resolve(here, '..', 'templates', 'agents', 'AGENTS.md'), 'utf8');
const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, 'packages/hono-preact/package.json'), 'utf8')
);

function publicSubpaths(): string[] {
  return Object.keys(pkg.exports)
    .filter((k) => !k.startsWith('./internal'))
    .map((k) => (k === '.' ? 'hono-preact' : `hono-preact/${k.slice('./'.length)}`));
}

describe('AGENTS.md public entry-point appendix', () => {
  it('lists every public subpath as a code span', () => {
    for (const subpath of publicSubpaths()) {
      expect(agentsMd, `missing \`${subpath}\``).toContain(`\`${subpath}\``);
    }
  });

  it('does not reference a non-existent subpath', () => {
    const allowed = new Set(publicSubpaths());
    const referenced = [...agentsMd.matchAll(/`(hono-preact(?:\/[a-z-]+)?)`/g)].map((m) => m[1]);
    for (const ref of referenced) {
      expect(allowed.has(ref), `unknown subpath \`${ref}\``).toBe(true);
    }
  });
});
