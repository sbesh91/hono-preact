import type { Plugin } from 'vite';
import type { NavArea } from '../pages/docs/nav.js';
import { generateDocsIndex } from './generate-docs-index.js';

const VIRTUAL_ID = 'virtual:docs-index';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/**
 * Serves the docs heading index (Task 2) to the client as `virtual:docs-index`.
 * The TOC and the Cmd+K palette import it. On a docs MDX edit in dev it
 * invalidates the module and full-reloads so headings stay current.
 */
export function docsIndexPlugin(nav: NavArea[], docsDir: string): Plugin {
  return {
    name: 'docs-index',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return undefined;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export default ${JSON.stringify(generateDocsIndex(nav, docsDir))};`;
      }
      return undefined;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.includes('/pages/docs/') && ctx.file.endsWith('.mdx')) {
        const mod = ctx.server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) ctx.server.moduleGraph.invalidateModule(mod);
        ctx.server.ws.send({ type: 'full-reload' });
      }
    },
  };
}
