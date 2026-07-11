// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import * as hp from 'hono-preact';
import { TableOfContents } from '../TableOfContents.js';
import type { DocHeading } from '../../../llms/generate-docs-index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

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

  it('writes the section hash on a plain left-click without arming the framework skip', () => {
    // Hash-only URL changes are outside the view-transition machinery (the
    // framework classifies navigations by pathname + search), so the TOC never
    // calls skipNextNavTransition.
    const skipSpy = vi.spyOn(hp, 'skipNextNavTransition');
    // Stub scrollHeight so the scroll-spy's "at bottom" fallback (which reads
    // happy-dom's all-zero layout metrics as "scrolled to the end") doesn't
    // force activeId to the last heading; activeId settles on headings[0]
    // ('how-it-works'), making the 'Options' click a real section change.
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      10000
    );

    const { getByRole } = render(<TableOfContents headings={headings} />);

    const target = document.createElement('h3');
    target.id = 'options';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    fireEvent.click(getByRole('link', { name: 'Options' }), { button: 0 });

    expect(location.hash).toBe('#options');
    expect(skipSpy).not.toHaveBeenCalled();
    target.remove();
  });

  it('still writes the hash when clicking the already-active section', () => {
    // Regression guard for the deferred-flash defect: the write is
    // unconditional on the active section, and no arming accompanies it.
    const skipSpy = vi.spyOn(hp, 'skipNextNavTransition');

    const { getByRole } = render(<TableOfContents headings={headings} />);

    const target = document.createElement('h2');
    target.id = 'how-it-works';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    fireEvent.click(getByRole('link', { name: 'How it works' }), {
      button: 0,
    });

    expect(location.hash).toBe('#how-it-works');
    expect(skipSpy).not.toHaveBeenCalled();
    target.remove();
  });

  it('holds the highlight on the clicked target during the smooth scroll', () => {
    // Run the scroll-spy's rAF callback synchronously so a scroll tick resolves
    // within the test.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const a = document.createElement('h2');
    a.id = 'how-it-works';
    a.scrollIntoView = vi.fn();
    document.body.appendChild(a);
    const b = document.createElement('h3');
    b.id = 'options';
    document.body.appendChild(b);

    const { getByRole } = render(<TableOfContents headings={headings} />);
    // Click the first heading, then fire a scroll tick: while the click-scroll
    // is locked, the scroll-spy must not move the highlight off it.
    fireEvent.click(getByRole('link', { name: 'How it works' }));
    fireEvent.scroll(window);
    expect(
      getByRole('link', { name: 'How it works' }).getAttribute('aria-current')
    ).toBe('true');
    a.remove();
    b.remove();
  });
});
