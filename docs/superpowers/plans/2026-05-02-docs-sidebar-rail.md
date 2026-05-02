# Docs Sidebar Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `DocsLayout` with a three-state icon rail (collapsed / hover-peek / pinned) using `lucide-preact` icons and a CSS `linear()` spring curve, while preserving the existing mobile slide-in drawer.

**Architecture:** Single `<aside>` component, viewport-branched via Tailwind `md:` prefix. Desktop uses a wrapper-cell whose width tracks `pinned`, with an inner panel whose width tracks `pinned || hovered`. The inner panel is `absolute` inside the sticky wrapper so the unpinned-hovered state floats over content without pushing layout. Mobile keeps current overlay drawer behavior, sharing the same nav rendering and icons. No persistence.

**Tech Stack:** Preact, preact-iso, Tailwind v4, lucide-preact, vitest (Node env).

**Commits:** This project requires explicit user approval before any `git commit`. The plan includes commit steps; the executor must confirm with the user before running each one.

**Reference spec:** `docs/superpowers/specs/2026-05-02-docs-sidebar-rail-design.md`.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `apps/app/package.json` | modify | add `lucide-preact` dep |
| `apps/app/src/pages/docs/nav.ts` | modify | add `icon: LucideIcon` to `NavEntry`; populate per entry |
| `apps/app/src/pages/docs/__tests__/nav.test.ts` | create | unit test: every entry has a valid icon |
| `apps/app/src/styles/root.css` | modify | add `--spring-soft`, `--spring-duration`, reduced-motion override |
| `apps/app/src/components/DocsLayout.tsx` | rewrite | three-state rail, pin button, mobile drawer, animation hookup |

---

## Task 1: Install lucide-preact

**Files:**
- Modify: `apps/app/package.json`

- [ ] **Step 1: Add lucide-preact dependency**

Run from repo root:

```bash
pnpm --filter app add lucide-preact
```

Expected: `apps/app/package.json` gains `"lucide-preact": "^x.y.z"` under `dependencies`. `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify install resolves and the icon set imports**

Run:

```bash
pnpm --filter app exec node -e "import('lucide-preact').then(m => console.log(typeof m.BookOpen, typeof m.Pin))"
```

Expected output: `function function`

If the import fails or the named exports are undefined, fall back to lucide-react: `pnpm --filter app remove lucide-preact && pnpm --filter app add lucide-react` and use `lucide-react` everywhere `lucide-preact` is referenced in subsequent tasks. The project's `react` → `@preact/compat` alias makes lucide-react render via Preact.

- [ ] **Step 3: Commit (confirm with user first)**

```bash
git add apps/app/package.json pnpm-lock.yaml
git commit -m "chore(app): add lucide-preact for docs sidebar icons"
```

---

## Task 2: Add icons to nav data with a data integrity test

**Files:**
- Modify: `apps/app/src/pages/docs/nav.ts`
- Create: `apps/app/src/pages/docs/__tests__/nav.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/pages/docs/__tests__/nav.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nav } from '../nav.js';

describe('docs nav', () => {
  it('every entry has a title, route, and icon component', () => {
    for (const section of nav) {
      expect(section.heading).toBeTruthy();
      for (const entry of section.entries) {
        expect(entry.title).toBeTruthy();
        expect(entry.route).toMatch(/^\/docs/);
        expect(typeof entry.icon).toBe('function');
      }
    }
  });

  it('routes are unique', () => {
    const routes = nav.flatMap((s) => s.entries.map((e) => e.route));
    expect(new Set(routes).size).toBe(routes.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from repo root:

```bash
pnpm test apps/app/src/pages/docs/__tests__/nav.test.ts
```

Expected: FAIL. `entry.icon` is undefined; `typeof undefined === 'undefined'`, not `'function'`.

- [ ] **Step 3: Update nav.ts type and entries**

Replace the contents of `apps/app/src/pages/docs/nav.ts`:

```ts
import {
  BookOpen,
  Rocket,
  FileText,
  Database,
  Loader,
  RefreshCw,
  Zap,
  Send,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  FolderTree,
  Layers,
  Settings,
  Cloud,
  type LucideIcon,
} from 'lucide-preact';

export type NavEntry = { title: string; route: string; icon: LucideIcon };
export type NavSection = { heading: string; entries: NavEntry[] };

export const nav: NavSection[] = [
  {
    heading: 'Introduction',
    entries: [
      { title: 'Overview', route: '/docs', icon: BookOpen },
      { title: 'Quick Start', route: '/docs/quick-start', icon: Rocket },
    ],
  },
  {
    heading: 'Pages & Routing',
    entries: [
      { title: 'Adding Pages', route: '/docs/pages', icon: FileText },
    ],
  },
  {
    heading: 'Data',
    entries: [
      { title: 'Server Loaders', route: '/docs/loaders', icon: Database },
      { title: 'Loading States', route: '/docs/loading-states', icon: Loader },
      { title: 'Reloading Data', route: '/docs/reloading', icon: RefreshCw },
      { title: 'Prefetching', route: '/docs/prefetch', icon: Zap },
    ],
  },
  {
    heading: 'Mutations',
    entries: [
      { title: 'Server Actions', route: '/docs/actions', icon: Send },
      { title: 'Action Guards', route: '/docs/action-guards', icon: ShieldAlert },
      { title: 'Optimistic UI', route: '/docs/optimistic-ui', icon: Sparkles },
    ],
  },
  {
    heading: 'Access Control',
    entries: [
      { title: 'Route Guards', route: '/docs/guards', icon: ShieldCheck },
    ],
  },
  {
    heading: 'Infrastructure',
    entries: [
      { title: 'Vite Config', route: '/docs/vite-config', icon: Settings },
      { title: 'Project Structure', route: '/docs/structure', icon: FolderTree },
      { title: 'renderPage', route: '/docs/render-page', icon: Layers },
      { title: 'Build & Deploy', route: '/docs/deployment', icon: Cloud },
    ],
  },
];
```

(If you fell back to `lucide-react` in Task 1, change the import path accordingly. The named exports are identical.)

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm test apps/app/src/pages/docs/__tests__/nav.test.ts
```

Expected: PASS, both `it` blocks green.

- [ ] **Step 5: Run full test suite to confirm no regressions**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit (confirm with user first)**

```bash
git add apps/app/src/pages/docs/nav.ts apps/app/src/pages/docs/__tests__/nav.test.ts
git commit -m "feat(docs): add per-entry icons to nav data"
```

---

## Task 3: Add spring CSS variables to root.css

**Files:**
- Modify: `apps/app/src/styles/root.css`

- [ ] **Step 1: Add the variables and reduced-motion override**

Insert at the top of `apps/app/src/styles/root.css`, immediately after `@import 'tailwindcss';`:

```css
:root {
  --spring-soft: linear(
    0,
    0.5 7.5%,
    0.85 14%,
    1.02 21%,
    1.04 28%,
    1.01 38%,
    0.998 50%,
    1.001 70%,
    1
  );
  --spring-duration: 280ms;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --spring-duration: 0ms;
  }
}
```

- [ ] **Step 2: Verify the dev server still starts and applies styles**

Run:

```bash
pnpm --filter app dev
```

Open `http://localhost:5173` (or whichever port Vite reports). Expected: page renders normally; no console errors. Inspect `<html>` in devtools and confirm `getComputedStyle(document.documentElement).getPropertyValue('--spring-duration')` returns `'280ms'`.

Stop the dev server (`Ctrl+C`).

- [ ] **Step 3: Commit (confirm with user first)**

```bash
git add apps/app/src/styles/root.css
git commit -m "feat(app): add linear() spring CSS variables"
```

---

## Task 4: Rewrite DocsLayout with the three-state rail

This task is split into four sub-steps so each browser-verifiable change is small. Commit after the whole task; do not commit between sub-steps.

**Files:**
- Modify: `apps/app/src/components/DocsLayout.tsx`

### Task 4a: Replace the layout skeleton with the unified rail structure

- [ ] **Step 1: Rewrite DocsLayout.tsx with collapsed-rail desktop and current mobile**

Replace the contents of `apps/app/src/components/DocsLayout.tsx`:

```tsx
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

export function DocsLayout({ children }: Props) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { path } = useRoute();

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

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

  const allEntries = nav.flatMap((s) => s.entries);
  const idx = allEntries.findIndex((e) => e.route === path);
  const prev = idx > 0 ? allEntries[idx - 1] : null;
  const next =
    idx !== -1 && idx < allEntries.length - 1 ? allEntries[idx + 1] : null;
  const currentTitle = idx !== -1 ? allEntries[idx].title : '';

  const renderNav = (showText: boolean) => (
    <div class="flex flex-col gap-4">
      {nav.map((section) => (
        <div class="flex flex-col gap-0.5">
          {showText && (
            <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5 px-3">
              {section.heading}
            </div>
          )}
          {section.entries.map((entry) => {
            const Icon = entry.icon;
            const active = entry.route === path;
            return (
              <a
                href={entry.route}
                aria-label={entry.title}
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
        gridTemplateColumns: pinned ? `${EXPANDED_W}px 1fr` : `${COLLAPSED_W}px 1fr`,
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
            class={`flex items-center h-12 shrink-0 font-bold text-[0.95rem] text-slate-900 no-underline hover:text-blue-700 ${
              expanded ? 'px-3' : 'justify-center px-0'
            }`}
          >
            {expanded ? 'hono-preact docs' : <span class="text-lg">📚</span>}
          </a>
          <div class={`flex-1 overflow-y-auto overflow-x-hidden py-2 ${expanded ? 'px-2' : 'px-1.5'}`}>
            {renderNav(expanded)}
          </div>
          <div class={`shrink-0 border-t border-slate-200 py-2 ${expanded ? 'px-2' : 'px-1.5'}`}>
            <button
              type="button"
              aria-pressed={pinned}
              aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
              onClick={() => setPinned((p) => !p)}
              class={`flex items-center gap-3 h-9 w-full rounded text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-200 ${
                expanded ? 'px-3' : 'justify-center px-0'
              }`}
            >
              {pinned ? <PinOff size={18} class="shrink-0" /> : <Pin size={18} class="shrink-0" />}
              {expanded && <span>{pinned ? 'Unpin sidebar' : 'Pin sidebar'}</span>}
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
        aria-label="Docs navigation"
        class="fixed top-0 bottom-0 left-0 w-[260px] bg-slate-50 border-r border-slate-200 z-50 flex flex-col md:hidden"
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
      <main class="max-w-[65ch] py-8 px-6">
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:

```bash
pnpm --filter app exec tsc --noEmit
```

Expected: no errors. If `LucideIcon` import or `Icon` JSX usage errors, the most likely cause is the lucide build target; try `import { type ComponentType } from 'preact'` and type the `icon` field as `ComponentType<{ size?: number | string; class?: string }>` in `nav.ts`.

### Task 4b: Verify desktop collapsed + hover-peek

- [ ] **Step 1: Run the dev server and navigate to /docs**

```bash
pnpm --filter app dev
```

Open `http://localhost:5173/docs` in a desktop-width browser window.

Expected:
- 56px-wide rail on the left.
- Each nav row shows just an icon, centered. Section headings are hidden.
- The active route's icon row has a blue tint.
- Mousing over the rail expands it smoothly to 240px without shifting the main content (the article stays put). Section headings appear; titles fade in next to icons.
- Mousing out collapses it back after a brief delay (~120ms).
- The pin button at the bottom shows a pin icon when collapsed, expanded shows "Pin sidebar".

If main content moves when hovering, the float-over is broken; check that the rail's inner panel is `position: absolute` and the wrapper width is governed by `pinned`, not `expanded`.

### Task 4c: Verify pin behavior

- [ ] **Step 1: Click the pin button while hovered**

Expected:
- Pin icon swaps to "PinOff", label becomes "Unpin sidebar".
- Main content shifts right ~184px as the grid column grows from 56px to 240px (animated by the spring curve).
- Mousing away does NOT collapse the rail (because pinned wins).
- Click "Unpin sidebar". Rail snaps back to 240px-while-hovered, content shifts back to 56px column. Mousing away then collapses the rail.

### Task 4d: Verify mobile drawer

- [ ] **Step 1: Resize the window below the `md` breakpoint (768px)**

Expected:
- Desktop rail disappears; the `☰ Menu` top bar appears.
- Tapping `☰ Menu` slides in the 260px drawer with the same icon + title rendering as the desktop expanded state.
- Tapping the backdrop or `✕` closes it.
- Tapping a nav link navigates and closes the drawer? (Note: current implementation does not auto-close on navigation; this matches the existing behavior.)

- [ ] **Step 2: Confirm reduced-motion**

In devtools, emulate `prefers-reduced-motion: reduce`. Toggle pin, hover, mobile drawer. Expected: state changes are instantaneous (no animation).

- [ ] **Step 3: Stop the dev server**

`Ctrl+C`.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Run a production build to catch any build-time issues**

```bash
pnpm --filter app build
```

Expected: build succeeds without errors. If lucide-preact triggers SSR issues, the most likely fix is to ensure icons are imported as named exports (already the case in this plan).

- [ ] **Step 6: Commit (confirm with user first)**

```bash
git add apps/app/src/components/DocsLayout.tsx
git commit -m "feat(app): three-state docs sidebar rail"
```

---

## Spec Coverage Self-Check

| Spec requirement | Task |
|---|---|
| Three states: collapsed / hover-peek / pinned | Task 4 (4b, 4c) |
| Hover floats over content; pinned reserves layout | Task 4a (grid col tied to `pinned`, inner panel `absolute`) |
| Pin button at bottom of rail | Task 4a |
| No localStorage persistence | Task 4a (state local to component) |
| Mobile preserves slide-in drawer | Task 4a, 4d |
| Mobile and desktop share nav rendering and icons | Task 4a (`renderNav(showText)`) |
| Per-entry icons added to `nav.ts` | Task 2 |
| `lucide-preact` (with lucide-react fallback) | Task 1 |
| `linear()` spring curve in `root.css` | Task 3 |
| `prefers-reduced-motion` override | Task 3 |
| 56px collapsed, 240px expanded, 280ms duration, 120ms hover-close | Task 4a (constants + CSS vars) |
| Accessibility: aria-label on aside, aria-pressed on pin, aria-label on icon-only links | Task 4a |
| Reduced-motion behavior | Task 3 + Task 4d Step 2 |
