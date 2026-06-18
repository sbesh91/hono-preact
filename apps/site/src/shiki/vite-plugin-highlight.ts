import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';
import { highlightCode } from './highlight.js';

const QUERY = '?highlighted';

// Resolves `import html from './FooDemo.tsx?highlighted'` to the file's source,
// Shiki-highlighted at build time, exported as an HTML string. No runtime
// highlighter is shipped to the client.
export function highlightPlugin(): Plugin {
  return {
    name: 'docs-highlight',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(QUERY)) return null;
      const base = source.slice(0, -QUERY.length);
      const resolved = await this.resolve(base, importer, { skipSelf: true });
      return resolved ? resolved.id + QUERY : null;
    },
    async load(id) {
      if (!id.endsWith(QUERY)) return null;
      const file = id.slice(0, -QUERY.length);
      // Track the source so edits trigger HMR / rebuild (we read it directly
      // rather than importing it, so Vite would not otherwise watch it).
      this.addWatchFile(file);
      const code = await readFile(file, 'utf8');
      // Demo files are .tsx; fall back to the raw extension for anything else.
      const lang = file.split('.').pop() ?? 'txt';
      const html = await highlightCode(code, lang);
      return `export default ${JSON.stringify(html)};`;
    },
  };
}
