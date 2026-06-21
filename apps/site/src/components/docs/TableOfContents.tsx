import { useEffect, useState } from 'preact/hooks';
import type { DocHeading } from '../../llms/docs-index.js';

// Right-rail "On this page" nav. Reads the current route's headings (passed in
// from the build-time index) and scroll-spies the active section. The active
// section is always defined: the last heading scrolled past the top offset, the
// first heading when above them all, the last when scrolled to the bottom.
export function TableOfContents({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(
    headings[0]?.id ?? null
  );

  useEffect(() => {
    if (headings.length === 0) return;
    const ids = headings.map((h) => h.id);
    // Just below the 3rem sticky top bar, with a little breathing room.
    const OFFSET = 96;

    const computeActive = () => {
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
    };
  }, [headings]);

  // Smooth-scroll in-page instead of letting the anchor do a hard jump (and to
  // sidestep the router/view-transition entirely). Honors modifier-clicks so
  // "open in new tab" still works. Updates the hash without a history entry so
  // it stays shareable without a popstate round-trip.
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
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setActiveId(id);
  };

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" class="text-sm">
      <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted mb-2">
        On this page
      </div>
      <ul class="flex flex-col gap-1 list-none m-0 p-0">
        {headings.map((h) => {
          const active = activeId === h.id;
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
