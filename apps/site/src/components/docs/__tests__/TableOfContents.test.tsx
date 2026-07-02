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

  it('writes the section hash to the URL on a plain left-click of a different section', () => {
    const skipSpy = vi.spyOn(hp, 'skipNextNavTransition');
    // The scroll-spy's mount effect runs synchronously during render(). Its
    // "at bottom" fallback treats happy-dom's all-zero layout metrics as
    // "scrolled to the end of the page" and would force activeId to the last
    // heading; stub scrollHeight so that fallback doesn't fire and activeId
    // settles on headings[0] ('how-it-works'), same as fresh-mount state.
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      10000
    );

    const { getByRole } = render(<TableOfContents headings={headings} />);

    // Only add the clicked target's element after the mount effect has
    // settled, so it can't feed back into that initial computeActive() pass.
    const target = document.createElement('h3');
    target.id = 'options';
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    // headings[0] ('how-it-works') is the settled active section, so clicking
    // 'Options' is a real section change: setActiveId will re-render, so the
    // one-shot skip is armed.
    fireEvent.click(getByRole('link', { name: 'Options' }), { button: 0 });

    expect(location.hash).toBe('#options');
    expect(skipSpy).toHaveBeenCalled();
    target.remove();
  });

  it('does not strand the skip flag when clicking the already-active section', () => {
    // Regression guard: activeId defaults to headings[0].id, so clicking that
    // same section's link is a no-op setActiveId. If the skip were armed here
    // anyway, no render flush would consume it and it would silently suppress
    // the *next* real navigation's view transition instead.
    const skipSpy = vi.spyOn(hp, 'skipNextNavTransition');
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      10000
    );

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
