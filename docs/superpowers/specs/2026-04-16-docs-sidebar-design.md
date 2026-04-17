# Docs Sidebar Design

**Date:** 2026-04-16  
**Status:** Approved

## Problem

The `/docs` pages have no navigation structure. Each page only has a plain backlink (`← docs`). There is no sidebar, no way to see all available pages, and no sense of visual hierarchy or document structure.

## Goal

Add a sticky left sidebar to all `/docs/*` pages with grouped section navigation, active-page highlighting, prev/next footer links, and a mobile hamburger drawer. ("Sticky" meaning `position: sticky` in a CSS grid column — the sidebar stays in document flow while the content scrolls.)

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Layout | Sticky left sidebar in CSS grid | Classic, familiar dev-docs pattern |
| Sidebar color | Light (slate-50 bg, border-right) | Matches existing page tone; softer than dark |
| Nav structure | Grouped sections with section headers | Scales as docs grow; explicit organization |
| Nav config | Static `nav.ts` file | Explicit ordering/grouping; no magic; easy to update |
| Mobile | Hamburger drawer with overlay | Full nav accessible on small screens |

## Architecture

### New files

**`src/pages/docs/nav.ts`**  
Static navigation config. Exports a typed array of sections, each containing page entries.

```ts
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

**`src/components/DocsLayout.tsx`**  
Preact component that wraps all docs MDX content. Renders the sidebar and content area side by side on desktop; renders a top bar + slide-in drawer on mobile.

Props:
- `children: ComponentChildren` — the MDX page content

Internal state:
- `drawerOpen: boolean` — controls mobile drawer visibility (default `false`)

**Active route:** Read via `const { path } = useRoute()` from `preact-iso`. Use `path` (not `url`) for pathname-only matching — `url` includes query strings. Match against `nav.ts` entries to determine active highlight and compute prev/next links.

**SSR / hydration:** `drawerOpen` initializes to `false` on both server and client — this is correct and intentional. The drawer's visibility is toggled via a CSS class (`drawer-open` on the root element) driven by the boolean state value, not by conditional JSX (`{drawerOpen && <div>...}`). This means the drawer DOM is always present and SSR/hydration see identical markup. No `window`-derived initial state is needed or appropriate.

### Modified files

**`src/iso.tsx`**  
This change is scoped to the docs-only glob (`./pages/docs/*.mdx`). All MDX files in `src/pages/docs/` — including `hello.mdx` — will receive `DocsLayout`. Pages absent from `nav.ts` (e.g. `hello.mdx`) render the full sidebar chrome but with no active highlight and no prev/next links. This is intentional.

The MDX lazy wrapper currently renders:
```tsx
<article class="mdx-content"><MDX {...props} /></article>
```
Change to:
```tsx
<DocsLayout><MDX {...props} /></DocsLayout>
```
`DocsLayout` owns the `<article class="mdx-content">` wrapper internally.

**`src/styles/root.css`**  
Remove `max-width` and `padding` from `.mdx-content` — those properties will be applied to the content column in `DocsLayout` instead (so the sidebar grid layout controls widths, not the article). All other `.mdx-content` prose rules (typography, code blocks, tables, etc.) remain.

Exact diff for `.mdx-content`:
```css
/* REMOVE these two lines from .mdx-content: */
max-width: 65ch;
padding: 1.5rem;

/* ADD to the content column class .docs-content in root.css: */
.docs-content {
  max-width: 65ch;
  padding: 2rem 1.5rem;
}
```

## Component Structure

```
DocsLayout  (root: class="docs-layout" + "drawer-open" when open)
├── <aside class="docs-sidebar">  (desktop: visible | mobile: hidden via CSS)
│   ├── Brand link → /docs
│   └── NavSection[]
│       ├── Section heading (uppercase label)
│       └── NavEntry[] (anchor tags, active = blue highlight via path match)
├── <div class="mobile-bar">  (mobile only: top bar, hidden on desktop)
│   ├── <button class="menu-btn"> ☰ Menu → sets drawerOpen=true
│   └── Current page title (derived from nav.ts match, or empty)
├── <div class="drawer-overlay">  (visible only when .drawer-open on root)
│   └── onClick → sets drawerOpen=false
├── <div class="drawer">  (slides in from left when .drawer-open on root)
│   ├── Header: "Docs" + ✕ close button → sets drawerOpen=false
│   └── Same NavSection[] as sidebar (same active highlight logic)
└── <main class="docs-content">
    ├── <article class="mdx-content">
    │   └── {children}
    └── Prev/Next footer
        ├── ← Prev page link (or empty span)
        └── Next page link → (or empty span)
```

## Styling

All layout styles written in `src/styles/root.css`. No new CSS files.

Key layout rules:
- Desktop: `display: grid; grid-template-columns: 220px 1fr` on `.docs-layout`
- Sidebar: `position: sticky; top: 0; height: 100vh; overflow-y: auto; background: #f8fafc; border-right: 1px solid #e2e8f0`
- Mobile (`@media (max-width: 768px)`): `.docs-layout` becomes single column; `.docs-sidebar` is `display: none`; `.mobile-bar` is shown
- Drawer: `position: fixed; top: 0; bottom: 0; left: 0; width: 260px; transform: translateX(-100%); transition: transform 0.2s ease` — `.drawer-open .drawer { transform: translateX(0) }`
- Overlay: `position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: none` — `.drawer-open .drawer-overlay { display: block }`

Active link: `background: #dbeafe; color: #1d4ed8; font-weight: 600; border-radius: 4px`  
Section heading: `font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8`

## Prev/Next Navigation

Computed from the flat ordered list of all `NavEntry` items across all sections. The `path` from `useRoute()` determines position.

```ts
const { path } = useRoute();
const allEntries = nav.flatMap(s => s.entries);
const idx = allEntries.findIndex(e => e.route === path);
const prev = allEntries[idx - 1] ?? null;
const next = allEntries[idx + 1] ?? null;
```

If `idx === -1` (page not in nav, e.g. `hello.mdx`), both `prev` and `next` are `null` and the footer renders nothing.

## Error Handling

No special error handling needed. Pages absent from `nav.ts` render correctly with the sidebar present but no active state and no prev/next links.

## Testing

Manual browser verification:
1. Desktop: sidebar visible, active page highlighted, prev/next links correct on each page
2. Mobile: sidebar hidden, ☰ Menu button visible, drawer opens/closes on button click, overlay tap closes drawer
3. Navigation: clicking a sidebar link navigates correctly with view transition
4. `hello.mdx`: sidebar renders with no active item and no prev/next footer
5. New page: adding a new entry to `nav.ts` appears in the sidebar without other code changes

No automated tests required — this is pure UI layout with no logic worth unit testing.
