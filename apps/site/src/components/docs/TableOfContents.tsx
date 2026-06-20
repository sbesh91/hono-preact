import { useEffect, useState } from 'preact/hooks';
import type { DocHeading } from '../../llms/docs-index.js';

// Right-rail "On this page" nav. Reads the current route's headings (passed in
// from the build-time index) and scroll-spies the active section.
export function TableOfContents({ headings }: { headings: DocHeading[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el != null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
        );
        setActiveId(visible[0].target.id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length < 2) return null;

  return (
    <nav aria-label="On this page" class="text-sm">
      <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted mb-2">
        On this page
      </div>
      <ul class="flex flex-col gap-1.5 list-none m-0 p-0">
        {headings.map((h) => (
          <li key={h.id} class={h.depth === 3 ? 'pl-3' : ''}>
            <a
              href={`#${h.id}`}
              aria-current={activeId === h.id ? 'true' : undefined}
              class={`no-underline block ${
                activeId === h.id
                  ? 'text-accent font-medium'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default TableOfContents;
