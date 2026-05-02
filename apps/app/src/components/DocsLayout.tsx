import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { Pin, PinOff } from 'lucide-preact';
import { nav } from '../pages/docs/nav.js';

interface Props {
  children: ComponentChildren;
}

const COLLAPSED_W = 56;
const EXPANDED_W = 240;
const HOVER_CLOSE_DELAY_MS = 120;

// Module-scoped so pin state survives DocsLayout remounts as the user
// navigates between docs pages (each page wraps its own DocsLayout).
// Client-only mutation; server renders always start at false.
let pinnedShared = false;

export function DocsLayout({ children }: Props) {
  const [pinned, setPinnedLocal] = useState(() => pinnedShared);
  const setPinned = (updater: (prev: boolean) => boolean) => {
    setPinnedLocal((prev) => {
      const next = updater(prev);
      pinnedShared = next;
      return next;
    });
  };
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { path } = useRoute();

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  const handleMouseEnter = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setHovered(true);
  };

  const handleMouseLeave = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(
      () => setHovered(false),
      HOVER_CLOSE_DELAY_MS
    );
  };

  const expanded = pinned || hovered;

  const allEntries = nav.flatMap((s) => s.entries);
  const idx = allEntries.findIndex((e) => e.route === path);
  const prev = idx > 0 ? allEntries[idx - 1] : null;
  const next =
    idx !== -1 && idx < allEntries.length - 1 ? allEntries[idx + 1] : null;
  const currentTitle = idx !== -1 ? allEntries[idx].title : '';

  const renderNav = (showText: boolean) => (
    <div class="flex flex-col gap-4">
      {nav.map((section) => (
        <div key={section.heading} class="flex flex-col gap-0.5">
          <div
            aria-hidden={!showText}
            style={{
              display: 'grid',
              gridTemplateRows: showText ? '1fr' : '0fr',
              opacity: showText ? 1 : 0,
              transition:
                'grid-template-rows var(--spring-duration) var(--spring-soft), opacity var(--spring-duration) var(--spring-soft)',
            }}
          >
            <div class="overflow-hidden">
              <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5 px-3 whitespace-nowrap">
                {section.heading}
              </div>
            </div>
          </div>
          {section.entries.map((entry) => {
            const Icon = entry.icon;
            const active = entry.route === path;
            return (
              <a
                key={entry.route}
                href={entry.route}
                aria-label={showText ? undefined : entry.title}
                class={`flex items-center gap-3 h-9 rounded text-sm no-underline whitespace-nowrap ${
                  showText ? 'px-3' : 'justify-center px-0'
                } ${
                  active
                    ? 'bg-blue-100 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                }`}
              >
                <Icon size={18} class="shrink-0" />
                {showText && <span>{entry.title}</span>}
              </a>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div
      class="min-h-screen grid"
      style={{
        gridTemplateColumns: pinned
          ? `${EXPANDED_W}px 1fr`
          : `${COLLAPSED_W}px 1fr`,
        transition: `grid-template-columns var(--spring-duration) var(--spring-soft)`,
      }}
    >
      {/* Desktop rail wrapper (sticky cell) */}
      <aside
        aria-label="Docs navigation"
        class="hidden md:block md:sticky md:top-0 md:h-screen relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Inner panel: absolute so hover-peek floats over content */}
        <div
          class="absolute top-0 left-0 h-full bg-slate-50 border-r border-slate-200 overflow-hidden flex flex-col z-20 shadow-sm"
          style={{
            width: expanded ? `${EXPANDED_W}px` : `${COLLAPSED_W}px`,
            transition: `width var(--spring-duration) var(--spring-soft)`,
          }}
        >
          <a
            href="/docs"
            aria-label="hono-preact docs"
            class={`flex whitespace-nowrap overflow-hidden text-ellipsis items-center h-12 shrink-0 font-bold text-[0.95rem] text-slate-900 no-underline hover:text-blue-700 ${
              expanded ? 'px-3' : 'justify-center px-0'
            }`}
          >
            {expanded ? 'hono-preact docs' : <span class="text-lg">📚</span>}
          </a>
          <div
            class={`flex-1 overflow-y-auto overflow-x-hidden py-2 ${expanded ? 'px-2' : 'px-1.5'}`}
          >
            {renderNav(expanded)}
          </div>
          <div
            class={`shrink-0 border-t border-slate-200 py-2 ${expanded ? 'px-2' : 'px-1.5'}`}
          >
            <button
              type="button"
              aria-pressed={pinned}
              aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
              onClick={() => setPinned((p) => !p)}
              class={`flex items-center gap-3 h-9 w-full rounded text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-200 ${
                expanded ? 'px-3' : 'justify-center px-0'
              }`}
            >
              {pinned ? (
                <PinOff size={18} class="shrink-0" />
              ) : (
                <Pin size={18} class="shrink-0" />
              )}
              {expanded && (
                <span>{pinned ? 'Unpin sidebar' : 'Pin sidebar'}</span>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div class="flex items-center gap-3 bg-slate-50 border-b border-slate-200 py-2.5 px-3 sticky top-0 z-30 md:hidden col-span-full">
        <button
          type="button"
          class="flex items-center gap-1 bg-white border border-slate-200 rounded-md py-1 px-2.5 text-[0.8rem] font-semibold text-slate-600 cursor-pointer shadow-sm shrink-0 hover:bg-slate-100"
          onClick={() => setMobileOpen(true)}
        >
          ☰ Menu
        </button>
        {currentTitle && (
          <span class="text-[0.85rem] font-semibold text-slate-900 whitespace-nowrap overflow-hidden text-ellipsis">
            {currentTitle}
          </span>
        )}
      </div>

      {/* Mobile backdrop */}
      <div
        class={`fixed inset-0 bg-black/35 z-40 md:hidden ${mobileOpen ? 'block' : 'hidden'}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Mobile drawer */}
      <aside
        aria-label="Docs navigation menu"
        class="fixed top-0 bottom-0 left-0 w-65 bg-slate-50 border-r border-slate-200 z-50 flex flex-col md:hidden"
        style={{
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: `transform var(--spring-duration) var(--spring-soft)`,
        }}
      >
        <div class="flex justify-between items-center px-4 py-3 border-b border-slate-200 font-bold text-[0.9rem] text-slate-900">
          Docs
          <button
            type="button"
            class="bg-transparent border-none text-[1.1rem] text-slate-500 cursor-pointer leading-none p-1 hover:text-slate-900"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <div class="p-3 overflow-y-auto flex-1">{renderNav(true)}</div>
      </aside>

      {/* Main content */}
      <main class="col-span-full md:col-auto max-w-[65ch] py-8 px-6">
        <article class="mdx-content">{children}</article>
        <nav class="flex justify-between mt-12 pt-6 border-t border-slate-200 text-sm">
          <span>
            {prev && (
              <a
                href={prev.route}
                class="text-blue-600 no-underline hover:underline"
              >
                ← {prev.title}
              </a>
            )}
          </span>
          <span>
            {next && (
              <a
                href={next.route}
                class="text-blue-600 no-underline hover:underline"
              >
                {next.title} →
              </a>
            )}
          </span>
        </nav>
      </main>
    </div>
  );
}
