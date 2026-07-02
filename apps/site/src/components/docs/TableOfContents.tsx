import { useEffect, useRef, useState } from 'preact/hooks';
import { skipNextNavTransition } from 'hono-preact';
import type { DocHeading } from '../../llms/docs-index.js';

// Right-rail "On this page" nav. Reads the current route's headings (passed in
// from the build-time index) and scroll-spies the active section. The active
// section is always defined: the last heading scrolled past the top offset, the
// first heading when above them all, the last when scrolled to the bottom.
export function TableOfContents({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(
    headings[0]?.id ?? null
  );
  // While a click-initiated smooth scroll is animating, hold the highlight on
  // the clicked target so the scroll-spy doesn't flicker it through the
  // intermediate sections the scroll passes over.
  const scrollLock = useRef(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    if (headings.length === 0) return;
    const ids = headings.map((h) => h.id);
    // Just below the 3rem sticky top bar, with a little breathing room.
    const OFFSET = 96;

    const computeActive = () => {
      if (scrollLock.current) return; // hold the clicked target mid-scroll
      let current = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - OFFSET <= 0) current = id;
        else break; // headings are in document order; the rest are lower
      }
      // At the very bottom the last section is current even if its heading never
      // reached the offset (short trailing sections like "See also").
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (atBottom) current = ids[ids.length - 1] ?? current;
      setActiveId(current);
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        computeActive();
        ticking = false;
      });
    };

    computeActive();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (lockTimer.current !== undefined) clearTimeout(lockTimer.current);
    };
  }, [headings]);

  // Smooth-scroll in-page AND put `#section` in the URL so it is shareable.
  // The framework starts a view transition whenever location.href changes, which
  // would flash the whole page; skipNextNavTransition() suppresses it for this
  // one URL write. Honors modifier-clicks so "open in new tab" still works.
  const onLinkClick = (event: MouseEvent, id: string) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    setActiveId(id);
    // Lock the highlight to the clicked target until the smooth scroll settles.
    scrollLock.current = true;
    if (lockTimer.current !== undefined) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => {
      scrollLock.current = false;
    }, 700);
    skipNextNavTransition();
    history.pushState(null, '', `#${id}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (headings.length < 2) return null;

  // Fall back to the first heading if the stored active id is not on this page.
  // On a cross-page navigation the same TOC instance keeps the previous page's
  // activeId until the effect recomputes; this keeps a valid item highlighted
  // for that paint instead of flashing no/!stale selection.
  const activeOnPage = headings.some((h) => h.id === activeId)
    ? activeId
    : (headings[0]?.id ?? null);

  return (
    <nav aria-label="On this page" class="text-sm">
      <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted mb-2">
        On this page
      </div>
      <ul class="flex flex-col gap-1 list-none m-0 p-0">
        {headings.map((h) => {
          const active = activeOnPage === h.id;
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                onClick={(e) => onLinkClick(e, h.id)}
                aria-current={active ? 'true' : undefined}
                class={`block border-l-2 no-underline leading-snug py-0.5 transition-colors duration-150 ease-out ${
                  h.depth === 3 ? 'pl-6' : 'pl-3'
                } ${
                  active
                    ? 'border-accent text-accent font-medium'
                    : 'border-transparent text-muted hover:text-foreground hover:border-border'
                }`}
              >
                {h.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default TableOfContents;
