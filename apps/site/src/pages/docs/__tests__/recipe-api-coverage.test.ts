import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from 'hono-preact';
import * as page from 'hono-preact/page';
import * as server from 'hono-preact/server';
import * as viteApi from 'hono-preact/vite';
import * as cloudflare from 'hono-preact/adapter-cloudflare';
import * as node from 'hono-preact/adapter-node';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../../../..');
const skillsDir = resolve(
  repoRoot,
  'packages/create-hono-preact/templates/agents/skills'
);

const names = (m: Record<string, unknown>) =>
  Object.keys(m).filter((k) => k !== 'default');
const allExports = new Set<string>([
  ...names(root),
  ...names(page),
  ...names(server),
  ...names(viteApi),
  ...names(cloudflare),
  ...names(node),
]);

// Value (non-type) named imports from `hono-preact*` specifiers inside fenced
// code blocks. Type-only imports and non-hono-preact modules are ignored: the
// `import * as` namespaces above expose runtime exports only.
function honoValueImports(md: string): string[] {
  const found: string[] = [];
  const fences = md.match(/```[\s\S]*?```/g) ?? [];
  const importRe =
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(hono-preact(?:\/[a-z-]+)?)'/g;
  for (const block of fences) {
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(block))) {
      if (m[1]) continue; // whole `import type { ... }`
      for (const raw of m[2].split(',')) {
        const part = raw.trim();
        if (!part || part.startsWith('type ')) continue; // inline `type X`
        found.push(part.split(/\s+as\s+/)[0].trim());
      }
    }
  }
  return found;
}

const recipes = readdirSync(skillsDir).filter((f) => f.endsWith('.md'));

describe('recipe hono-preact imports are real exports', () => {
  expect(recipes.length).toBeGreaterThan(0);
  for (const file of recipes) {
    const md = readFileSync(resolve(skillsDir, file), 'utf8');
    for (const name of honoValueImports(md)) {
      it(`${file}: ${name} is a public hono-preact export`, () => {
        expect(
          allExports.has(name),
          `${name} (in ${file}) is not exported`
        ).toBe(true);
      });
    }
  }
});
