declare module 'virtual:docs-index' {
  import type { DocPage } from './llms/generate-docs-index.js';
  const pages: DocPage[];
  export default pages;
}
