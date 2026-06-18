import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = resolve(here, '../components');

// Every live demo on a component page must show its source. This catches a demo
// that ships without a Code tab (an <Example> missing the `code` prop).
describe('component-page demos expose their source', () => {
  const files = readdirSync(componentsDir).filter((f) => f.endsWith('.mdx'));

  for (const file of files) {
    it(`${file}: every <Example> passes code`, () => {
      const src = readFileSync(resolve(componentsDir, file), 'utf8');
      // Match each opening <Example ...> tag and require a `code` attribute.
      const openTags = src.match(/<Example(\s[^>]*?)?>/g) ?? [];
      for (const tag of openTags) {
        expect(tag, `${file}: ${tag}`).toMatch(/\bcode=/);
      }
    });
  }
});
