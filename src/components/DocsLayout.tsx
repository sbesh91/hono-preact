import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { nav } from '../pages/docs/nav.js';

interface Props {
  children: ComponentChildren;
}

export function DocsLayout({ children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { path } = useRoute();

  const allEntries = nav.flatMap((s) => s.entries);
  const idx = allEntries.findIndex((e) => e.route === path);
  const prev = idx > 0 ? allEntries[idx - 1] : null;
  const next = idx !== -1 && idx < allEntries.length - 1 ? allEntries[idx + 1] : null;
  const currentTitle = idx !== -1 ? allEntries[idx].title : '';

  const navSections = nav.map((section) => (
    <div class="docs-nav-section">
      <div class="docs-nav-heading">{section.heading}</div>
      {section.entries.map((entry) => (
        <a
          href={entry.route}
          class={`docs-nav-link${entry.route === path ? ' active' : ''}`}
        >
          {entry.title}
        </a>
      ))}
    </div>
  ));

  return (
    <div class={`docs-layout${drawerOpen ? ' drawer-open' : ''}`}>
      {/* Desktop sidebar */}
      <aside class="docs-sidebar">
        <a href="/docs" class="docs-sidebar-brand">hono-preact docs</a>
        {navSections}
      </aside>

      {/* Mobile top bar */}
      <div class="mobile-bar">
        <button class="menu-btn" onClick={() => setDrawerOpen(true)}>
          ☰ Menu
        </button>
        {currentTitle && <span class="mobile-bar-title">{currentTitle}</span>}
      </div>

      {/* Mobile drawer overlay */}
      <div class="drawer-overlay" onClick={() => setDrawerOpen(false)} />

      {/* Mobile drawer */}
      <div class="drawer">
        <div class="drawer-header">
          Docs
          <button class="drawer-close" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        <div class="drawer-nav">
          {navSections}
        </div>
      </div>

      {/* Main content */}
      <main class="docs-content">
        <article class="mdx-content">
          {children}
        </article>
        <nav class="docs-prevnext">
          <span>
            {prev && <a href={prev.route}>← {prev.title}</a>}
          </span>
          <span>
            {next && <a href={next.route}>{next.title} →</a>}
          </span>
        </nav>
      </main>
    </div>
  );
}
