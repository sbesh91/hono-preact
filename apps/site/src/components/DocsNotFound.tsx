import { definePage } from 'hono-preact';
import { MdxArticle } from './MdxArticle.js';

function DocsNotFound() {
  return (
    <MdxArticle>
      <h1>Page not found</h1>
      <p>
        There's no docs page at this address. It may have moved as the docs
        grew.
      </p>
      <p>
        Start from the <a href="/docs">docs overview</a>, or press{' '}
        <code>⌘K</code> to search.
      </p>
    </MdxArticle>
  );
}
DocsNotFound.displayName = 'DocsNotFound';

export default definePage(DocsNotFound);
