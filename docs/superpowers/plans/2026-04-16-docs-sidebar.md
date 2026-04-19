# Docs Sidebar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sticky left sidebar with grouped navigation, prev/next footer links, and a mobile hamburger drawer to all `/docs/*` pages.

**Architecture:** A static `nav.ts` config defines page groups and order. A new `DocsLayout` Preact component reads that config to render the sidebar, mobile bar, and drawer. The existing MDX lazy wrapper in `iso.tsx` is updated to use `DocsLayout` instead of a bare `<article>`. All styles live in `root.css`.

**Tech Stack:** Preact, preact-iso (`useRoute`), Tailwind CSS v4 (`root.css`), MDX

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/pages/docs/nav.ts` | Typed sidebar nav config — sections and page entries |
| Create | `src/components/DocsLayout.tsx` | Sidebar, mobile bar, drawer, prev/next footer |
| Modify | `src/styles/root.css` | Layout CSS for all DocsLayout elements |
| Modify | `src/iso.tsx` | Swap MDX `<article>` wrapper for `<DocsLayout>` |

---

### Task 1: Create `nav.ts` — sidebar navigation config

**Files:**
- Create: `src/pages/docs/nav.ts`

- [ ] **Step 1: Create the file**

```ts
// src/pages/docs/nav.ts
export type NavEntry = { title: string; route: string };
export type NavSection = { heading: string; entries: NavEntry[] };

export const nav: NavSection[] = [
  {
    heading: 'Getting Started',
    entries: [
      { title: 'Overview', route: '/docs' },
      { title: 'Project Structure', route: '/docs/structure' },
    ],
  },
  {
    heading: 'Guides',
    entries: [
      { title: 'Adding Pages', route: '/docs/pages' },
      { title: 'Server Loaders', route: '/docs/loaders' },
      { title: 'Build & Deploy', route: '/docs/deployment' },
    ],
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/docs/nav.ts
git commit -m "feat: add docs nav config"
```

---

### Task 2: Add DocsLayout CSS to `root.css`

**Files:**
- Modify: `src/styles/root.css`

- [ ] **Step 1: Remove `max-width` and `padding` from `.mdx-content`**

In `root.css`, find the `.mdx-content` block (lines 4–8) and remove these two lines:
```css
  max-width: 65ch;
  padding: 1.5rem;
```

The block should become:
```css
.mdx-content {
  line-height: 1.75;
}
```

All other `.mdx-content` rules (typography, code, tables, etc.) remain untouched.

- [ ] **Step 2: Append DocsLayout styles at the end of `root.css`** (after the `@keyframes` blocks)

```css
/* ── Docs layout ─────────────────────────────────────────── */

.docs-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}

/* Sidebar */
.docs-sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  background: #f8fafc;
  border-right: 1px solid #e2e8f0;
  padding: 1.5rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.docs-sidebar-brand {
  font-weight: 700;
  font-size: 0.95rem;
  color: #0f172a;
  text-decoration: none;
}

.docs-sidebar-brand:hover {
  color: #1d4ed8;
}

.docs-nav-section {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.docs-nav-heading {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #94a3b8;
  margin-bottom: 0.375rem;
  padding: 0 0.375rem;
}

.docs-nav-link {
  display: block;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  color: #475569;
  text-decoration: none;
  font-size: 0.875rem;
}

.docs-nav-link:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.docs-nav-link.active {
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 600;
}

/* Content */
.docs-content {
  max-width: 65ch;
  padding: 2rem 1.5rem;
}

/* Prev/Next footer */
.docs-prevnext {
  display: flex;
  justify-content: space-between;
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e2e8f0;
  font-size: 0.875rem;
}

.docs-prevnext a {
  color: #2563eb;
  text-decoration: none;
}

.docs-prevnext a:hover {
  text-decoration: underline;
}

/* Mobile top bar — hidden on desktop */
.mobile-bar {
  display: none;
}

/* Drawer + overlay — hidden by default */
.drawer-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 40;
}

.drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 260px;
  background: #f8fafc;
  border-right: 1px solid #e2e8f0;
  z-index: 50;
  transform: translateX(-100%);
  transition: transform 0.2s ease;
  display: flex;
  flex-direction: column;
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  font-weight: 700;
  font-size: 0.9rem;
  color: #0f172a;
}

.drawer-close {
  background: none;
  border: none;
  font-size: 1.1rem;
  color: #64748b;
  cursor: pointer;
  line-height: 1;
  padding: 0.25rem;
}

.drawer-close:hover {
  color: #0f172a;
}

.drawer-nav {
  padding: 0.75rem 0.75rem;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* drawer-open state — toggled on .docs-layout root */
.drawer-open .drawer-overlay {
  display: block;
}

.drawer-open .drawer {
  transform: translateX(0);
}

/* Mobile breakpoint */
@media (max-width: 768px) {
  .docs-layout {
    grid-template-columns: 1fr;
  }

  .docs-sidebar {
    display: none;
  }

  .mobile-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 0.6rem 0.75rem;
    position: sticky;
    top: 0;
    z-index: 30;
  }

  .menu-btn {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: #475569;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    flex-shrink: 0;
  }

  .menu-btn:hover {
    background: #f1f5f9;
  }

  .mobile-bar-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles/root.css
git commit -m "feat: add docs layout CSS"
```

---

### Task 3: Create `DocsLayout.tsx`

**Files:**
- Create: `src/components/DocsLayout.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/DocsLayout.tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/DocsLayout.tsx
git commit -m "feat: add DocsLayout component"
```

---

### Task 4: Wire `DocsLayout` into `iso.tsx`

**Files:**
- Modify: `src/iso.tsx`

- [ ] **Step 1: Import DocsLayout**

Add this import near the top of `src/iso.tsx` (after existing imports):

```tsx
import { DocsLayout } from './components/DocsLayout.js';
```

- [ ] **Step 2: Swap the MDX wrapper**

Find this block inside the `mdxRoutes` map (around line 23–27):

```tsx
    const Wrapped: ComponentType = (props) => <article class="mdx-content"><MDX {...props} /></article>;
```

Replace with:

```tsx
    const Wrapped: ComponentType = (props) => <DocsLayout><MDX {...props} /></DocsLayout>;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/iso.tsx
git commit -m "feat: wrap docs MDX pages in DocsLayout"
```

---

### Task 5: Manual browser verification

The dev server should already be running (`npm run dev` at `http://localhost:5173`).

- [ ] **Step 1: Desktop — sidebar and active state**

Open `http://localhost:5173/docs`. Verify:
- Sidebar is visible on the left with "Getting Started" and "Guides" sections
- "Overview" is highlighted blue (active)
- No prev link, "Project Structure →" next link in footer

- [ ] **Step 2: Desktop — navigation between pages**

Click "Project Structure" in the sidebar. Verify:
- Page navigates with the fade view transition
- "Project Structure" is now highlighted in the sidebar
- "← Overview" prev link and "Adding Pages →" next link appear in footer

- [ ] **Step 3: Desktop — all pages reachable**

Click through each sidebar link (Adding Pages, Server Loaders, Build & Deploy). Verify each navigates correctly and the sidebar highlight updates.

- [ ] **Step 4: Mobile — hamburger button visible**

Resize browser to ≤768px (or use DevTools responsive mode). Verify:
- Desktop sidebar is hidden
- A "☰ Menu" button appears in the sticky top bar
- Current page title appears next to it

- [ ] **Step 5: Mobile — drawer opens and closes**

Tap "☰ Menu". Verify:
- Drawer slides in from the left
- Dark overlay appears behind the drawer
- Nav sections and links are visible with active highlight

Tap the overlay. Verify drawer closes.
Tap "☰ Menu" again, then tap "✕". Verify drawer closes.

- [ ] **Step 6: Mobile — drawer navigation**

Open the drawer and click a different page link. Verify:
- Page navigates correctly
- Drawer is closed after navigation (because the component remounts on route change)

- [ ] **Step 7: `hello.mdx` — no active state**

Navigate to `http://localhost:5173/docs/hello`. Verify:
- Sidebar renders with no active highlighted item
- No prev/next footer links

- [ ] **Step 8: Final commit check**

Run: `git log --oneline -5`
Expected: 4 commits for this feature (nav.ts, CSS, DocsLayout, iso.tsx wiring)
