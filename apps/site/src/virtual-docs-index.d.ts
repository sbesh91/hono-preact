declare module 'virtual:docs-index' {
  import type { DocPage } from './llms/docs-index.js';
  const pages: DocPage[];
  export default pages;
}
