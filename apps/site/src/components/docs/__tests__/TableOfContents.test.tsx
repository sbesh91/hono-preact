// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { TableOfContents } from '../TableOfContents.js';
import type { DocHeading } from '../../../llms/generate-docs-index.js';

beforeAll(() => {
  // happy-dom lacks IntersectionObserver; stub a no-op.
  (
    globalThis as unknown as { IntersectionObserver: unknown }
  ).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
});
afterEach(cleanup);

const headings: DocHeading[] = [
  { text: 'How it works', id: 'how-it-works', depth: 2 },
  { text: 'Options', id: 'options', depth: 3 },
];

describe('TableOfContents', () => {
  it('renders a link per heading with hash hrefs', () => {
    const { getByRole } = render(<TableOfContents headings={headings} />);
    const link = getByRole('link', { name: 'Options' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#options');
  });

  it('renders nothing when there are fewer than two headings', () => {
    const { container } = render(<TableOfContents headings={[headings[0]]} />);
    expect(container.querySelector('nav')).toBeNull();
  });
});
