# Docs Navigation Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the docs site into two switchable areas (Guide / Components) behind a docs-only top bar, with section-header-only icons and a tri-state theme toggle, so navigation scales as the native-components reference grows.

**Architecture:** `nav.ts` becomes an array of areas (each with sections → entries); `DocsRoute.tsx`'s MDX glob goes recursive so component pages can live under `/docs/components/*`; `DocsLayout.tsx` gains a sticky top bar (logo, Guide/Components switcher, version, GitHub, theme toggle) and renders only the active area's nav in the existing hover-peek rail; a `data-theme` override layer plus a pre-paint init script back the theme toggle.

**Tech Stack:** Preact, preact-iso router, hono-preact (`<Head>`, `lazy`), Vite `import.meta.glob`, Tailwind v4 CSS tokens, lucide-preact, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-docs-nav-restructure-design.md`

---

## File Structure

**Modified**
- `apps/site/src/components/DocsRoute.tsx` — recursive MDX glob; exported `docsSlug` helper for slug derivation.
- `apps/site/src/pages/docs/nav.ts` — reshaped to `NavArea[]`; icons move from entries to sections.
- `apps/site/src/components/DocsLayout.tsx` — top bar + area switcher; area-scoped rail, pager, and mobile drawer; section-header icons only.
- `apps/site/src/Layout.tsx` — pre-paint theme-init `<script>` in `<head>`.
- `apps/site/src/styles/root.css` — `data-theme` override layer alongside the `prefers-color-scheme` default.
- `apps/site/src/pages/docs/__tests__/nav.test.ts` — assert new area/section/entry shape.
- `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts` — recursive MDX discovery; area-flattened nav slugs.
- `.claude/skills/add-docs-page.md` — two-area instructions, component-page location, section-icon model.
- `.claude/skills/keep-docs-fresh.md` — nav-structure reference.

**Created**
- `apps/site/src/pages/docs/__tests__/docs-slug.test.ts` — unit tests for `docsSlug`.
- `apps/site/src/pages/docs/components/index.mdx` — Components area overview (route `/docs/components`).
- `apps/site/src/components/ThemeToggle.tsx` — tri-state System/Light/Dark control.

**Test command:** all Vitest runs are from the repo root (`apps/site` has no local `test` script). `pnpm test <filter>` runs `vitest run` filtered by filename substring.

---

## Task 1: Recursive MDX discovery + `docsSlug` helper

Make MDX route discovery recurse into subdirectories and extract the slug derivation into a tested pure function. No nested files exist yet, so behavior is preserved and all existing tests stay green.

**Files:**
- Modify: `apps/site/src/components/DocsRoute.tsx`
- Create: `apps/site/src/pages/docs/__tests__/docs-slug.test.ts`
- Modify: `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`

- [ ] **Step 1: Write the failing unit test for `docsSlug`**

Create `apps/site/src/pages/docs/__tests__/docs-slug.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { docsSlug } from '../../../components/DocsRoute.js';

describe('docsSlug', () => {
  it('maps a top-level file to its bare slug', () => {
    expect(docsSlug('../pages/docs/quick-start.mdx')).toBe('quick-start');
  });

  it('maps the root index to the empty slug', () => {
    expect(docsSlug('../pages/docs/index.mdx')).toBe('');
  });

  it('keeps subdirectory segments for nested files', () => {
    expect(docsSlug('../pages/docs/components/dialog.mdx')).toBe(
      'components/dialog'
    );
  });

  it('maps a nested index to its directory slug', () => {
    expect(docsSlug('../pages/docs/components/index.mdx')).toBe('components');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test docs-slug`
Expected: FAIL — `docsSlug` is not exported from `DocsRoute`.

- [ ] **Step 3: Add the `docsSlug` helper and use a recursive glob in `DocsRoute.tsx`**

Replace the top of `apps/site/src/components/DocsRoute.tsx` (the `mdxModules`/`mdxRoutes` block, lines 13-34) with:

```tsx
// Derive a docs route slug from an `import.meta.glob` key:
//   '../pages/docs/index.mdx'            -> ''                (serves /docs)
//   '../pages/docs/quick-start.mdx'      -> 'quick-start'     (serves /docs/quick-start)
//   '../pages/docs/components/index.mdx' -> 'components'      (serves /docs/components)
//   '../pages/docs/components/dialog.mdx'-> 'components/dialog'(serves /docs/components/dialog)
export function docsSlug(globKey: string): string {
  return globKey
    .replace('../pages/docs/', '')
    .replace(/\.mdx$/, '')
    .replace(/(^|\/)index$/, '');
}

// Recursive glob so component pages can live under pages/docs/components/.
const mdxModules = import.meta.glob('../pages/docs/**/*.mdx');
const mdxRoutes = Object.entries(mdxModules).map(([file, load]) => {
  const relative = docsSlug(file);
  const Component = lazy(async () => {
    const mod = await (load as () => Promise<{ default: ComponentType }>)();
    const MDX = mod.default;
    const SingleRoot: ComponentType = (props) => (
      <article class="mdx-content">
        <MDX {...props} />
      </article>
    );
    return { default: SingleRoot };
  });
  return { relative, Component };
});
```

Leave the rest of the file (`DocsNotFound`, `DocsRoute`, the inner `<Router>`) unchanged. The inner `<Route path={relative}>` already matches multi-segment static paths: preact-iso's `exec` splits both the rest path and the route on `/` and compares segment by segment.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm test docs-slug`
Expected: PASS (4 tests).

- [ ] **Step 5: Make `mdx-routes.test.ts` discovery recursive**

In `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`, replace `discoverMdxSlugs` (lines 25-37) with a recursive walk that mirrors `docsSlug`:

```ts
function discoverMdxSlugs(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(resolve(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.mdx')) {
        const base = entry.name.replace(/\.mdx$/, '');
        const rel = prefix ? `${prefix}/${base}` : base;
        out.push(rel.replace(/(^|\/)index$/, ''));
      }
    }
  };
  walk(docsDir, '');
  return out.sort();
}
```

- [ ] **Step 6: Run the route-discovery and full docs test suites to verify green**

Run: `pnpm test docs/__tests__`
Expected: PASS — `nav.test.ts` and `mdx-routes.test.ts` both pass (no nested files yet, so discovery output is unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/components/DocsRoute.tsx apps/site/src/pages/docs/__tests__/docs-slug.test.ts apps/site/src/pages/docs/__tests__/mdx-routes.test.ts
git commit -m "feat(site): recursive MDX docs discovery + tested docsSlug helper"
```

---

## Task 2: Two-area nav + Components overview + top-bar layout

Reshape `nav.ts` into Guide/Components areas with section-header icons, add the Components overview page, and rewrite `DocsLayout.tsx` to render a sticky top bar with the area switcher and an area-scoped rail/pager. Lands green and navigable (Components reachable via the switcher and `/docs/components`). The theme toggle is added in Task 3.

**Files:**
- Modify: `apps/site/src/pages/docs/nav.ts`
- Create: `apps/site/src/pages/docs/components/index.mdx`
- Modify: `apps/site/src/pages/docs/__tests__/nav.test.ts`
- Modify: `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`
- Modify: `apps/site/src/components/DocsLayout.tsx`

- [ ] **Step 1: Update `nav.test.ts` for the area/section/entry shape (failing)**

Replace the entire body of `apps/site/src/pages/docs/__tests__/nav.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { nav } from '../nav.js';

describe('docs nav', () => {
  it('every area has an id, label, icon component, and /docs basePath', () => {
    for (const area of nav) {
      expect(area.id).toBeTruthy();
      expect(area.label).toBeTruthy();
      expect(typeof area.icon).toBe('function');
      expect(area.basePath).toMatch(/^\/docs/);
    }
  });

  it('every section has a heading and an icon component', () => {
    for (const area of nav) {
      for (const section of area.sections) {
        expect(section.heading).toBeTruthy();
        expect(typeof section.icon).toBe('function');
      }
    }
  });

  it('every entry has a title and a /docs route', () => {
    for (const area of nav) {
      for (const section of area.sections) {
        for (const entry of section.entries) {
          expect(entry.title).toBeTruthy();
          expect(entry.route).toMatch(/^\/docs/);
        }
      }
    }
  });

  it('component-area routes live under /docs/components', () => {
    const components = nav.find((a) => a.id === 'components');
    expect(components).toBeTruthy();
    for (const section of components!.sections) {
      for (const entry of section.entries) {
        expect(
          entry.route === '/docs/components' ||
            entry.route.startsWith('/docs/components/')
        ).toBe(true);
      }
    }
  });

  it('routes are unique across all areas', () => {
    const routes = nav.flatMap((a) =>
      a.sections.flatMap((s) => s.entries.map((e) => e.route))
    );
    expect(new Set(routes).size).toBe(routes.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test docs/__tests__/nav`
Expected: FAIL — current `nav.ts` exports `NavSection[]`, so `area.sections` is undefined.

- [ ] **Step 3: Reshape `nav.ts` into areas**

Replace the entire contents of `apps/site/src/pages/docs/nav.ts` with:

```ts
import {
  BookOpen,
  Boxes,
  Compass,
  Database,
  Map as MapIcon,
  Send,
  Server,
  Shield,
  Wand2,
  type LucideIcon,
} from 'lucide-preact';

export type NavEntry = { title: string; route: string };
export type NavSection = {
  heading: string;
  icon: LucideIcon;
  entries: NavEntry[];
};
export type NavArea = {
  id: 'guide' | 'components';
  label: string;
  icon: LucideIcon;
  basePath: string;
  sections: NavSection[];
};

export const nav: NavArea[] = [
  {
    id: 'guide',
    label: 'Guide',
    icon: BookOpen,
    basePath: '/docs',
    sections: [
      {
        heading: 'Introduction',
        icon: BookOpen,
        entries: [
          { title: 'Overview', route: '/docs' },
          { title: 'Quick Start', route: '/docs/quick-start' },
        ],
      },
      {
        heading: 'Pages & Routing',
        icon: MapIcon,
        entries: [
          { title: 'The Route Table', route: '/docs/routes' },
          { title: 'Layouts & Nesting', route: '/docs/layouts' },
          { title: 'Adding Pages', route: '/docs/pages' },
        ],
      },
      {
        heading: 'Data',
        icon: Database,
        entries: [
          { title: 'Server Loaders', route: '/docs/loaders' },
          { title: 'Loading States', route: '/docs/loading-states' },
          { title: 'Reloading Data', route: '/docs/reloading' },
          { title: 'Prefetching', route: '/docs/prefetch' },
          { title: 'Streaming', route: '/docs/streaming' },
        ],
      },
      {
        heading: 'Mutations',
        icon: Send,
        entries: [
          { title: 'Server Actions', route: '/docs/actions' },
          { title: 'Optimistic UI', route: '/docs/optimistic-ui' },
        ],
      },
      {
        heading: 'View Transitions',
        icon: Wand2,
        entries: [
          { title: 'View Transitions', route: '/docs/view-transitions' },
        ],
      },
      {
        heading: 'Access Control',
        icon: Shield,
        entries: [
          { title: 'Middleware', route: '/docs/middleware' },
          { title: 'CSRF Protection', route: '/docs/csrf' },
        ],
      },
      {
        heading: 'Infrastructure',
        icon: Server,
        entries: [
          { title: 'Vite Config', route: '/docs/vite-config' },
          { title: 'Project Structure', route: '/docs/structure' },
          { title: 'Composing Hono Middleware', route: '/docs/hono-middleware' },
          { title: 'WebSockets', route: '/docs/websockets' },
          { title: 'renderPage', route: '/docs/render-page' },
          { title: 'Link Prefetch', route: '/docs/link-prefetch' },
          { title: 'Build & Deploy', route: '/docs/deployment' },
        ],
      },
    ],
  },
  {
    id: 'components',
    label: 'Components',
    icon: Boxes,
    basePath: '/docs/components',
    sections: [
      {
        heading: 'Getting started',
        icon: Compass,
        entries: [{ title: 'Overview', route: '/docs/components' }],
      },
    ],
  },
];
```

Component sections (Overlays / Collections / Foundations) are added later, one entry at a time, as each page ships, per the updated `add-docs-page` skill. The nav must never list a route whose MDX file does not exist (the contract test enforces this).

- [ ] **Step 4: Create the Components overview page**

Create `apps/site/src/pages/docs/components/index.mdx`:

```mdx
# Components

hono-preact ships a set of headless, accessible UI primitives that lean on the
platform: the native `<dialog>` element and top layer, `@floating-ui/dom` for
positioning, and a thin ARIA, keyboard, and collection layer on top. Every
primitive works on all current browser versions; newer platform features such
as the Popover API and CSS anchor positioning are used only as progressive
enhancement.

## What's here

The reference is grouped as the library grows:

- **Overlays** — Dialog, Popover, Tooltip.
- **Collections** — Menu, Select, Combobox.
- **Foundations** — the shared machinery (LayerHost, FocusScope, and the
  collection and keyboard-navigation primitives) the components build on.

Pages appear here as each component ships.
```

- [ ] **Step 5: Flatten nav slugs by area in `mdx-routes.test.ts`**

In `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts`, replace `navSlugs` (lines 39-45) with:

```ts
function navSlugs(): string[] {
  return nav
    .flatMap((area) => area.sections.flatMap((s) => s.entries.map((e) => e.route)))
    .filter((route) => route === '/docs' || route.startsWith('/docs/'))
    .map((route) => (route === '/docs' ? '' : route.replace('/docs/', '')))
    .sort();
}
```

- [ ] **Step 6: Run the docs test suites to verify parity is green**

Run: `pnpm test docs/__tests__`
Expected: PASS — `nav.test.ts` (5 tests) passes; `mdx-routes.test.ts` passes, with `components` discovered from `components/index.mdx` matched by the nav `/docs/components` entry.

- [ ] **Step 7: Rewrite `DocsLayout.tsx` with the top bar and area-scoped rail**

Replace the entire contents of `apps/site/src/components/DocsLayout.tsx` with:

```tsx
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Pin, PinOff } from 'lucide-preact';
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
    closeTimer.current = setTimeout(() => setHovered(false), HOVER_CLOSE_DELAY_MS);
  };

  const expanded = pinned || hovered;

  const activeAreaId = path.startsWith('/docs/components') ? 'components' : 'guide';
  const activeArea = nav.find((a) => a.id === activeAreaId) ?? nav[0];

  const allEntries = activeArea.sections.flatMap((s) => s.entries);
  const idx = allEntries.findIndex((e) => e.route === path);
  const prev = idx > 0 ? allEntries[idx - 1] : null;
  const next = idx !== -1 && idx < allEntries.length - 1 ? allEntries[idx + 1] : null;

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
      <header class="sticky top-0 z-40 flex items-center gap-3 h-12 px-3 md:px-4 bg-surface-subtle border-b border-border">
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
                aria-current={isActive ? 'page' : undefined}
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
        {/* ThemeToggle is inserted here in Task 3. */}
      </header>

      <div
        class="flex-1 grid"
        style={{
          gridTemplateColumns: pinned ? `${EXPANDED_W}px 1fr` : `${COLLAPSED_W}px 1fr`,
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
            <div class={`flex-1 overflow-y-auto overflow-x-hidden py-3 ${expanded ? 'px-2' : 'px-1.5'}`}>
              {renderNav(activeArea, expanded)}
            </div>
            <div class={`shrink-0 border-t border-border py-2 ${expanded ? 'px-2' : 'px-1.5'}`}>
              <button
                type="button"
                aria-pressed={pinned}
                aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
                onClick={() => setPinned((p) => !p)}
                class={`flex items-center gap-3 h-9 w-full rounded text-sm text-muted hover:text-foreground hover:bg-foreground/10 ${
                  expanded ? 'px-3' : 'justify-center px-0'
                }`}
              >
                {pinned ? <PinOff size={18} class="shrink-0" /> : <Pin size={18} class="shrink-0" />}
                {expanded && <span>{pinned ? 'Unpin sidebar' : 'Pin sidebar'}</span>}
              </button>
            </div>
          </div>
        </aside>

        {/* Mobile backdrop */}
        <div
          class={`fixed inset-0 bg-black/35 z-40 md:hidden ${mobileOpen ? 'block' : 'hidden'}`}
          onClick={() => setMobileOpen(false)}
        />

        {/* Mobile drawer */}
        <aside
          aria-label="Docs navigation menu"
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
          <div class="p-3 overflow-y-auto flex-1">{renderNav(activeArea, true)}</div>
        </aside>

        {/* Main content */}
        <main class="col-span-full md:col-auto max-w-[65ch] py-8 px-6">
          {children}
          <nav class="flex justify-between mt-12 pt-6 border-t border-border text-sm">
            <span>
              {prev && (
                <a href={prev.route} class="text-accent no-underline hover:underline">
                  ← {prev.title}
                </a>
              )}
            </span>
            <span>
              {next && (
                <a href={next.route} class="text-accent no-underline hover:underline">
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
```

Notes: the collapsed rail now shows section icons (each links to its first entry); expanded shows the section header + text entries. This replaces the previous per-entry grid-rows heading animation; the width transition remains. `__HONO_PREACT_VERSION__` is the existing Vite define (declared in `apps/site/src/env.d.ts`, used by `home.tsx`).

- [ ] **Step 8: Typecheck and run the full site build's type pass**

Run: `pnpm typecheck`
Expected: PASS — no type errors in `DocsLayout.tsx` or `nav.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/site/src/pages/docs/nav.ts apps/site/src/pages/docs/components/index.mdx apps/site/src/pages/docs/__tests__/nav.test.ts apps/site/src/pages/docs/__tests__/mdx-routes.test.ts apps/site/src/components/DocsLayout.tsx
git commit -m "feat(site): two-area docs nav with switcher top bar"
```

---

## Task 3: Tri-state theme toggle + `data-theme` override

Add a System/Light/Dark control to the top bar, a `data-theme` override layer in the CSS, and a pre-paint init script. No stored choice → the `prefers-color-scheme` default keeps governing and reacting to OS changes.

**Files:**
- Modify: `apps/site/src/styles/root.css`
- Modify: `apps/site/src/Layout.tsx`
- Create: `apps/site/src/components/ThemeToggle.tsx`
- Modify: `apps/site/src/components/DocsLayout.tsx`

- [ ] **Step 1: Scope the OS-dark default to "no explicit choice"**

In `apps/site/src/styles/root.css`, change the dark media-query selector so it only applies when no `data-theme` is set. Replace:

```css
@media (prefers-color-scheme: dark) {
  :root {
```

with:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
```

- [ ] **Step 2: Add the explicit-dark override block**

In `apps/site/src/styles/root.css`, immediately after the closing `}` of the `@media (prefers-color-scheme: dark)` block (just before `@media (prefers-reduced-motion: reduce) {`), insert:

```css
/* Explicit dark override (theme toggle). Keep these token values in sync with
   the prefers-color-scheme: dark block above. Explicit light needs no block:
   setting any data-theme disables the media default, so the base :root (light)
   applies. */
:root[data-theme='dark'] {
  --background: #1b1d1e;
  --foreground: #e9eae8;
  --muted: #bbbcbc;
  --surface: #25282a;
  --surface-subtle: #2f3234;
  --border-color: rgba(255, 255, 255, 0.12);
  --accent: #ff5fbf;
  --accent-foreground: #1b1d1e;
  --accent-hover: #ff8ad2;
  --ring: #ec008c;
  --danger: #f87171;
  --badge-success-surface: #14532d;
  --badge-success-foreground: #bbf7d0;
  --badge-neutral-surface: #374151;
  --badge-neutral-foreground: #e5e7eb;
  --shadow-card:
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 6px 16px rgba(0, 0, 0, 0.45);
}
```

- [ ] **Step 3: Add the pre-paint theme-init script to the document head**

Replace the contents of `apps/site/src/Layout.tsx` with:

```tsx
import { ClientScript, Head } from 'hono-preact';
import root from '@/styles/root.css?url';
import type { ComponentChildren } from 'preact';

// Runs synchronously before first paint so a stored Light/Dark choice applies
// without a flash. No stored choice leaves data-theme unset, so the
// prefers-color-scheme default governs. Lives in <head>, outside #app, so it
// does not participate in hydration.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function Layout({ children }: { children: ComponentChildren }) {
  return (
    <html>
      <Head defaultTitle="hono-preact">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="stylesheet" href={root} />
      </Head>
      <body class="bg-background text-foreground font-sans antialiased isolate">
        <main id="app">{children}</main>
        <ClientScript />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Create the `ThemeToggle` component**

Create `apps/site/src/components/ThemeToggle.tsx`:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { Monitor, Moon, Sun } from 'lucide-preact';

type ThemeChoice = 'system' | 'light' | 'dark';

const ORDER: ThemeChoice[] = ['system', 'light', 'dark'];
const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const LABELS = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
} as const;

function readStored(): ThemeChoice {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const el = document.documentElement;
  try {
    if (choice === 'system') {
      el.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    } else {
      el.setAttribute('data-theme', choice);
      localStorage.setItem('theme', choice);
    }
  } catch {
    /* storage unavailable; the attribute change alone still applies */
    if (choice === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', choice);
  }
}

export function ThemeToggle() {
  // Server can't know the user's choice, so start at 'system' and sync on mount.
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    setChoice(readStored());
  }, []);

  const cycle = () => {
    const nextChoice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
    apply(nextChoice);
    setChoice(nextChoice);
  };

  const Icon = ICONS[choice];
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${LABELS[choice]} (click to change)`}
      title={LABELS[choice]}
      class="flex items-center justify-center h-8 w-8 rounded text-muted hover:text-foreground hover:bg-foreground/10"
    >
      <Icon size={18} />
    </button>
  );
}
```

- [ ] **Step 5: Mount `ThemeToggle` in the top bar**

In `apps/site/src/components/DocsLayout.tsx`, add the import near the other lucide import:

```tsx
import { ThemeToggle } from './ThemeToggle.js';
```

Then replace the placeholder comment in the top bar:

```tsx
        {/* ThemeToggle is inserted here in Task 3. */}
```

with:

```tsx
        <ThemeToggle />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Manually verify no-flash theming**

Run: `pnpm --filter site dev`, open `/docs`. With OS in dark mode and no stored choice, the page is dark. Click the toggle to cycle System → Light → Dark; reload after picking Light or Dark and confirm there is no flash of the wrong theme on load. Pick System again and confirm it returns to following the OS.
Expected: behaves as described; `localStorage.theme` is `light`/`dark` when overridden and absent when System.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/styles/root.css apps/site/src/Layout.tsx apps/site/src/components/ThemeToggle.tsx apps/site/src/components/DocsLayout.tsx
git commit -m "feat(site): tri-state System/Light/Dark theme toggle"
```

---

## Task 4: Update the local docs skills

Bring the two `.claude/skills/` docs into line with the two-area structure, the component-page location, and the section-icon model.

**Files:**
- Modify: `.claude/skills/add-docs-page.md`
- Modify: `.claude/skills/keep-docs-fresh.md`

- [ ] **Step 1: Rewrite the body of `add-docs-page.md`**

Replace everything in `.claude/skills/add-docs-page.md` below the frontmatter and the `# Adding a Docs Page` heading with:

````markdown
Two files must be updated when adding a new docs page. The route is auto-registered — no router changes needed.

## 1. Create the MDX file

- **Guide page:** `apps/site/src/pages/docs/<slug>.mdx` → route `/docs/<slug>`.
- **Component / Components-area page:** `apps/site/src/pages/docs/components/<slug>.mdx` → route `/docs/components/<slug>`.

The glob in `apps/site/src/components/DocsRoute.tsx` is recursive (`../pages/docs/**/*.mdx`), and `docsSlug` derives the route from the path (a nested `index.mdx` serves the directory root, e.g. `components/index.mdx` → `/docs/components`).

Follow the style of existing docs pages:
- Use `#` for the page title, `##` for sections
- Lead with a one-paragraph explanation of what the feature does and why it exists
- Show code examples for the common case before edge cases
- Keep examples realistic — use the project's actual import paths (`@hono-preact/iso`, `@hono-preact/server`)
- Do NOT include a `[← docs](/docs)` back-link — navigation is handled by the sidebar

## 2. Add to nav.ts

`apps/site/src/pages/docs/nav.ts` exports `nav: NavArea[]`. Each area has `sections`, each section has a `heading`, an `icon` (a `lucide-preact` component — **icons live on sections, not entries**), and `entries: { title, route }[]`.

Add an entry `{ title: 'Page Title', route: '/docs/<slug>' }` to the right section, in reading order (foundational before advanced).

**Guide area sections:**

| Section | Content |
|---|---|
| Introduction | Overview, Quick Start |
| Pages & Routing | Page creation, routing conventions |
| Data | Loaders, loading states, reloading, prefetching, streaming |
| Mutations | Actions, optimistic UI |
| View Transitions | View Transitions |
| Access Control | Middleware, CSRF |
| Infrastructure | Vite config, structure, Hono middleware, WebSockets, renderPage, link prefetch, deployment |

**Components area sections** (under `basePath` `/docs/components`): `Getting started`, then add `Overlays` (Dialog, Popover, Tooltip), `Collections` (Menu, Select, Combobox), and `Foundations` (LayerHost, FocusScope, collection/nav machinery) as those pages are created. When adding the first page of a not-yet-present section, create the section with an appropriate `lucide-preact` icon.

## Checklist

- [ ] MDX file created in the correct directory (`docs/` for guide, `docs/components/` for components)
- [ ] Entry added to the correct area/section in `apps/site/src/pages/docs/nav.ts`
- [ ] `pnpm test docs/__tests__` passes (route ↔ nav parity)
````

- [ ] **Step 2: Fix the nav-structure reference in `keep-docs-fresh.md`**

Open `.claude/skills/keep-docs-fresh.md`, find the line near line 42 that reads `Nav structure (6 sections) is in:` and change it to:

```
Nav structure (two areas — Guide and Components — each with sections) is in:
```

Leave the `apps/site/src/pages/docs/nav.ts` path line beneath it unchanged.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/add-docs-page.md .claude/skills/keep-docs-fresh.md
git commit -m "docs(skills): update docs-page skills for two-area nav"
```

---

## Task 5: Full verification

Run the CI sequence and the manual checks before opening a PR.

**Files:** none (verification only).

- [ ] **Step 1: Build the framework dist (CI step 1)**

Run: `pnpm --filter '@hono-preact/*' --filter hono-preact build`
Expected: success (apps/site type resolution depends on a current dist).

- [ ] **Step 2: Format check (CI step 2)**

Run: `pnpm format:check`
Expected: PASS. If it fails, run `pnpm format`, review, and amend the relevant commit.

- [ ] **Step 3: Typecheck (CI step 3)**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Unit tests (CI step 4)**

Run: `pnpm test`
Expected: PASS — including `nav.test.ts`, `mdx-routes.test.ts`, and `docs-slug.test.ts`.

- [ ] **Step 5: Integration tests (CI step 5)**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 6: Site build (CI step 6)**

Run: `pnpm --filter site build`
Expected: success.

- [ ] **Step 7: Manual nav + routing checks**

Run `pnpm --filter site dev` and confirm:
- `/docs` shows the Guide tab active and the Guide sections in the rail.
- Clicking the Components tab navigates to `/docs/components` and the rail swaps to the Components sections; the Components tab is active.
- Collapsed rail (unpinned, not hovering): clicking a section icon navigates to that section's first page; hovering expands to the full text tree.
- Prev/next pager only links within the active area (no Guide → Components spillover).
- The landing page (`/`) still shows the full-bleed hero with no top bar.
- Mobile width: the ☰ button opens the drawer listing the active area's sections.

- [ ] **Step 8: Final commit if formatting changed anything**

```bash
git add -A
git commit -m "chore(site): formatting after docs nav restructure" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Two areas (Guide/Components) → Task 2 (`nav.ts` `NavArea[]`, `DocsLayout` active-area detection).
- Area switcher in a docs-only top bar → Task 2 (`<header>` in `DocsLayout`; landing page untouched, verified Task 5 Step 7).
- Icons on section headers only → Task 2 (`NavSection.icon`, `NavEntry` has no icon; `renderNav`).
- Components nested under `/docs/components/*` → Task 1 (recursive glob + `docsSlug`) + Task 2 (overview page, nav basePath).
- Scoped pager → Task 2 (`allEntries` from `activeArea`).
- Tri-state theme, default = OS → Task 3 (`data-theme` layer, init script, `ThemeToggle`).
- Version badge + GitHub link → Task 2 (`__HONO_PREACT_VERSION__`, inline `GithubMark`).
- Replacement-parity touchpoints (tests + skills) → Tasks 1, 2 (tests), Task 4 (skills).
- Search deferred / no empty stub pages → honored (only the overview page is created).

**Placeholder scan:** none — every step has concrete code or an exact command. The one cross-task placeholder (`{/* ThemeToggle is inserted here in Task 3. */}`) is introduced in Task 2 and explicitly replaced in Task 3 Step 5.

**Type consistency:** `NavArea` / `NavSection` / `NavEntry` are defined in Task 2 Step 3 and consumed identically in `DocsLayout` (Task 2 Step 7) and the tests (Task 2 Steps 1, 5). `docsSlug` signature `(globKey: string): string` matches its tests (Task 1) and call site (Task 1 Step 3). `ThemeChoice` is internal to `ThemeToggle`. `__HONO_PREACT_VERSION__` is an existing global.
