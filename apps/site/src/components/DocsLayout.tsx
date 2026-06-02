import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Pin, PinOff } from 'lucide-preact';
import { ThemeToggle } from './ThemeToggle.js';
import { nav, type NavArea } from '../pages/docs/nav.js';

interface Props {
  children: ComponentChildren;
}

const COLLAPSED_W = 56;
const EXPANDED_W = 240;
const HOVER_CLOSE_DELAY_MS = 500;

// lucide-preact removed brand marks, so the GitHub glyph is inline SVG.
function GithubMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.71-4.04-1.58-4.04-1.58-.55-1.37-1.34-1.74-1.34-1.74-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.21 1.84 1.21 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.21a11.6 11.6 0 0 1 6 0c2.29-1.53 3.3-1.21 3.3-1.21.66 1.65.24 2.87.12 3.17.77.83 1.24 1.88 1.24 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.28 0 .31.21.68.83.56A12.01 12.01 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z" />
    </svg>
  );
}

export function DocsLayout({ children }: Props) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { path } = useLocation();

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [path]);

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

  const activeAreaId = path.startsWith('/docs/components')
    ? 'components'
    : 'guide';
  const activeArea = nav.find((a) => a.id === activeAreaId) ?? nav[0];

  const allEntries = activeArea.sections.flatMap((s) => s.entries);
  const idx = allEntries.findIndex((e) => e.route === path);
  const prev = idx > 0 ? allEntries[idx - 1] : null;
  const next =
    idx !== -1 && idx < allEntries.length - 1 ? allEntries[idx + 1] : null;

  const renderNav = (area: NavArea, showText: boolean) => (
    <div class="flex flex-col gap-4">
      {area.sections.map((section) => {
        const Icon = section.icon;
        const sectionActive = section.entries.some((e) => e.route === path);
        if (!showText) {
          const first = section.entries[0];
          return (
            <a
              key={section.heading}
              href={first.route}
              aria-label={section.heading}
              class={`flex items-center justify-center h-9 rounded ${
                sectionActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted hover:text-foreground hover:bg-foreground/10'
              }`}
            >
              <Icon size={18} class="shrink-0" />
            </a>
          );
        }
        return (
          <div key={section.heading} class="flex flex-col gap-0.5">
            <div class="flex items-center gap-2 text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted mb-1.5 px-3">
              <Icon size={14} class="shrink-0 opacity-80" />
              <span class="whitespace-nowrap">{section.heading}</span>
            </div>
            {section.entries.map((entry) => {
              const active = entry.route === path;
              return (
                <a
                  key={entry.route}
                  href={entry.route}
                  class={`flex items-center h-9 rounded text-sm no-underline whitespace-nowrap pl-9 pr-3 ${
                    active
                      ? 'bg-accent/10 text-accent font-semibold'
                      : 'text-muted hover:text-foreground hover:bg-foreground/10'
                  }`}
                >
                  <span>{entry.title}</span>
                </a>
              );
            })}
          </div>
        );
      })}
    </div>
  );

  return (
    <div class="min-h-screen flex flex-col">
      {/* Docs top bar */}
      <header class="docs-topbar sticky top-0 z-40 flex items-center gap-3 h-12 px-3 md:px-4 bg-surface-subtle border-b border-border">
        <button
          type="button"
          class="md:hidden flex items-center justify-center h-8 w-8 rounded text-muted hover:text-foreground hover:bg-foreground/10"
          aria-label="Open docs menu"
          onClick={() => setMobileOpen(true)}
        >
          ☰
        </button>
        <a
          href="/docs"
          class="font-bold text-[0.95rem] text-foreground no-underline hover:text-accent whitespace-nowrap"
        >
          hono-preact
        </a>
        <nav class="flex items-center gap-1" aria-label="Docs areas">
          {nav.map((area) => {
            const TabIcon = area.icon;
            const isActive = area.id === activeAreaId;
            return (
              <a
                key={area.id}
                href={area.basePath}
                aria-current={isActive ? 'true' : undefined}
                class={`flex items-center gap-1.5 h-8 px-3 rounded-md text-sm no-underline ${
                  isActive
                    ? 'bg-accent/10 text-accent font-semibold'
                    : 'text-muted hover:text-foreground hover:bg-foreground/10'
                }`}
              >
                <TabIcon size={16} class="shrink-0" />
                <span>{area.label}</span>
              </a>
            );
          })}
        </nav>
        <span class="flex-1" />
        <span class="hidden sm:inline text-xs text-muted whitespace-nowrap">
          v{__HONO_PREACT_VERSION__}
        </span>
        <a
          href="https://github.com/sbesh91/hono-preact"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="hono-preact on GitHub"
          class="flex items-center justify-center h-8 w-8 rounded text-muted hover:text-foreground hover:bg-foreground/10"
        >
          <GithubMark />
        </a>
        <ThemeToggle />
      </header>

      <div
        class="flex-1 grid"
        style={{
          gridTemplateColumns: pinned
            ? `${EXPANDED_W}px 1fr`
            : `${COLLAPSED_W}px 1fr`,
          transition: `grid-template-columns var(--spring-duration) var(--spring-soft)`,
        }}
      >
        {/* Desktop rail */}
        <aside
          aria-label="Docs navigation"
          class="hidden md:block md:sticky md:top-12 md:h-[calc(100vh-3rem)] relative"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div
            class="docs-sidebar absolute top-0 left-0 h-full bg-surface-subtle border-r border-border overflow-hidden flex flex-col z-20 shadow-sm"
            style={{
              width: expanded ? `${EXPANDED_W}px` : `${COLLAPSED_W}px`,
              transition: `width var(--spring-duration) var(--spring-soft)`,
            }}
          >
            <div
              class={`flex-1 overflow-y-auto overflow-x-hidden py-3 ${expanded ? 'px-2' : 'px-1.5'}`}
            >
              {renderNav(activeArea, expanded)}
            </div>
            <div
              class={`shrink-0 border-t border-border py-2 ${expanded ? 'px-2' : 'px-1.5'}`}
            >
              <button
                type="button"
                aria-pressed={pinned}
                aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
                onClick={() => setPinned((p) => !p)}
                class={`flex items-center gap-3 h-9 w-full rounded text-sm text-muted hover:text-foreground hover:bg-foreground/10 ${
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

        {/* Mobile backdrop */}
        <div
          class={`fixed inset-0 bg-black/35 z-30 md:hidden ${mobileOpen ? 'block' : 'hidden'}`}
          onClick={() => setMobileOpen(false)}
        />

        {/* Mobile drawer */}
        <aside
          aria-label="Docs navigation menu"
          aria-hidden={!mobileOpen}
          inert={!mobileOpen || undefined}
          class="fixed top-0 bottom-0 left-0 w-65 bg-surface-subtle border-r border-border z-50 flex flex-col md:hidden"
          style={{
            transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: `transform var(--spring-duration) var(--spring-soft)`,
          }}
        >
          <div class="flex justify-between items-center px-4 py-3 border-b border-border font-bold text-[0.9rem] text-foreground">
            {activeArea.label}
            <button
              type="button"
              class="bg-transparent border-none text-[1.1rem] text-muted cursor-pointer leading-none p-1 hover:text-foreground"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>
          <div class="p-3 overflow-y-auto flex-1">
            {renderNav(activeArea, true)}
          </div>
        </aside>

        {/* Main content */}
        <main class="col-span-full md:col-auto max-w-[65ch] py-8 px-6">
          {children}
          <nav
            aria-label="Page navigation"
            class="flex justify-between mt-12 pt-6 border-t border-border text-sm"
          >
            <span>
              {prev && (
                <a
                  href={prev.route}
                  class="text-accent no-underline hover:underline"
                >
                  ← {prev.title}
                </a>
              )}
            </span>
            <span>
              {next && (
                <a
                  href={next.route}
                  class="text-accent no-underline hover:underline"
                >
                  {next.title} →
                </a>
              )}
            </span>
          </nav>
        </main>
      </div>
    </div>
  );
}
