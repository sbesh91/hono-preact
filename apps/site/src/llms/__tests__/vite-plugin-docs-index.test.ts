import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsIndexPlugin } from '../vite-plugin-docs-index.js';
import { nav } from '../../pages/docs/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, '../../pages/docs');

describe('docsIndexPlugin', () => {
  const plugin = docsIndexPlugin(nav, docsDir);

  it('resolves the virtual id', () => {
    const resolved = (plugin.resolveId as Function).call(
      {},
      'virtual:docs-index'
    );
    expect(resolved).toBe('\0virtual:docs-index');
    expect((plugin.resolveId as Function).call({}, 'other')).toBeUndefined();
  });

  it('loads an es module exporting the page index', () => {
    const code = (plugin.load as Function).call({}, '\0virtual:docs-index') as string;
    expect(code.startsWith('export default ')).toBe(true);
    expect(code).toContain('/docs/loaders');
  });
});
