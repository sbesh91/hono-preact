// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { TableOfContents } from '../TableOfContents.js';
import type { DocHeading } from '../../../llms/generate-docs-index.js';

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

  it('always marks exactly one entry active (scroll-spy)', async () => {
    const { container } = render(<TableOfContents headings={headings} />);
    await waitFor(() =>
      expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(
        1
      )
    );
  });

  it('smooth-scrolls in-page on click instead of a hard jump', () => {
    // The target heading must exist for the in-page scroll to engage.
    const target = document.createElement('h2');
    target.id = 'options';
    const scrollSpy = vi.fn();
    target.scrollIntoView = scrollSpy;
    document.body.appendChild(target);

    const { getByRole } = render(<TableOfContents headings={headings} />);
    const notPrevented = fireEvent.click(
      getByRole('link', { name: 'Options' })
    );

    expect(notPrevented).toBe(false); // preventDefault: no hard jump / router
    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    target.remove();
  });
});
