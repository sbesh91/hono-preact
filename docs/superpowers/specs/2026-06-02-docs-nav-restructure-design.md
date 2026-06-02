# Docs navigation restructure: two areas + top bar

- **Date:** 2026-06-02
- **Status:** Approved design, pre-implementation
- **Topic:** Restructure the docs site navigation so it scales to the incoming native-components reference, without the sidebar growing unmanageable.

## Problem

The docs sidebar (`apps/site/src/pages/docs/nav.ts`, rendered by `apps/site/src/components/DocsLayout.tsx`) is a single flat, always-expanded list: 7 sections, ~20 pages, each row carrying its own icon. The hover-peek icon rail (56px collapsed, 240px expanded) shows one icon per page when collapsed.

The native headless-components effort (see `docs/superpowers/specs/2026-05-31-headless-components-investigation.md`) adds a whole new body of reference docs: Dialog, Popover, Tooltip, Menu, Select, Combobox, plus shared machinery (LayerHost, FocusScope, collection/navigation), shipped in phases and growing over time. Appending these to the flat list makes it tall enough to require scrolling and pushes the collapsed icon rail past the ~20-icon point where the icons stop being distinguishable.

## Goals

- Keep the sidebar legible and bounded as the component reference grows.
- Preserve the site's signature hover-peek icon rail.
- Make adding a component page as mechanical as adding a guide page is today.

## Non-goals (YAGNI / deferred)

- **Docs search.** Net-new and substantial (needs an index like Pagefind plus a results UI). Out of scope; can be added to the top bar later.
- **Scaffolding empty component stub pages now.** The structure ships ready; pages land as each component is built per the phased plan.
- A virtualized or arbitrarily-deep nav tree. Two areas with flat-grouped sections is enough.

## Design decisions (the chosen path)

1. **Two areas, not one list.** Split the docs into **Guide** (everything that exists today) and **Components** (the new reference). This is the decision that keeps the icon rail viable: each area's section list stays short (~7-10), so the collapsed rail never has to render the full ~40-item union.
2. **Area switcher lives in a new docs top bar.** A horizontal bar above the sidebar+content with Guide/Components tabs. Chosen over an in-rail segmented control or a dropdown.
3. **The top bar is docs-only.** It lives in `DocsLayout`, not a site-wide app shell. The landing page keeps its full-bleed hero shader untouched. (The landing page already links into docs via "Get started → /docs/quick-start".)
4. **Icons on section headers only.** Page links are plain text. The icon moves from `NavEntry` to `NavSection`. This de-clutters the expanded list and turns the collapsed rail into a short column of meaningful section icons instead of ~20 lookalikes.
5. **Theme toggle is tri-state: System / Light / Dark.** Default is System, which follows `prefers-color-scheme` and keeps reacting to OS changes. Light/Dark are explicit overrides persisted in `localStorage`; selecting System clears the override. This honors "respect the OS suggestion as the default."

## Architecture

### A. Navigation data model (`nav.ts`)

Reshape from a flat `NavSection[]` to an array of areas:

```ts
export type NavEntry = { title: string; route: string };           // icon removed
export type NavSection = { heading: string; icon: LucideIcon; entries: NavEntry[] }; // icon added
export type NavArea = {
  id: 'guide' | 'components';
  label: string;        // 'Guide' | 'Components'
  icon: LucideIcon;     // tab icon
  basePath: string;     // '/docs' | '/docs/components'
  sections: NavSection[];
};
export const nav: NavArea[] = [ /* guide, components */ ];
```

- **Guide** area: the 7 existing sections, content unchanged, each gaining a representative section icon (e.g. Introduction→BookOpen, Pages & Routing→Map, Data→Database, Mutations→Send, View Transitions→Wand2, Access Control→Shield, Infrastructure→Settings). Per-page icons are dropped.
- **Components** area: `Overview` (the only page initially) → `Overlays` (Dialog, Popover, Tooltip) → `Collections` (Menu, Select, Combobox) → `Foundations` (LayerHost, FocusScope, Collections & nav). Section icons curated from `lucide-preact`. Component/foundation pages are added as they ship.

Section icons are sourced from `lucide-preact`; the import list shrinks from ~20 per-page icons to ~11 section icons.

### B. Routing (`DocsRoute.tsx`) — nested component pages

Component MDX files live under `apps/site/src/pages/docs/components/`, served at `/docs/components/<slug>`. The current glob is flat and only discovers top-level files, so:

- Change the glob from `import.meta.glob('../pages/docs/*.mdx')` to `import.meta.glob('../pages/docs/**/*.mdx')` (recursive).
- Update the `relative` slug derivation to keep subdirectory segments: `components/dialog.mdx` → `components/dialog`; `components/index.mdx` → `components` (serves `/docs/components`, the Overview); top-level `index.mdx` → `''` (serves `/docs`).
- The outer route is already a catch-all (`routes.ts`: `{ path: '/docs/*', view: docsView }`), so nested URLs reach `DocsRoute`. The inner `<Router>` must match multi-segment static paths (e.g. `path="components/dialog"`).

**Implementation check (blocking):** verify preact-iso's inner `<Route>` matches multi-segment static `path` values against the rest path. If it does not, fall back to either (a) a per-area inner Router keyed off the first segment, or (b) flat filenames with nav-driven area detection (see Alternatives). Resolve this in the first implementation step before building on it.

### C. `DocsLayout.tsx`

- **Top bar** (full width, above the existing grid): logo/home link · Guide/Components tabs · spacer · version badge (`__HONO_PREACT_VERSION__`, as the landing page already uses) · GitHub link (reuse `https://github.com/sbesh91/hono-preact`) · theme toggle control.
- **Active-area detection:** derive from the path. `path.startsWith('/docs/components')` → Components, else Guide. The active tab highlights and the rail renders only `nav.find(a => a.id === active).sections`.
- **Rail (mostly unchanged):** keep the 56px↔240px hover/pin behavior. Render section-header icons; page entries as text. Remove the in-rail "📚 hono-preact docs" header (the top bar now carries the logo).
- **Collapsed-rail click:** with no per-page icons, a collapsed section icon navigates to that section's first entry's route; hover/pin still expands to the full text tree. Active section icon stays highlighted.
- **Pager:** scope prev/next to the active area only. Replace `nav.flatMap(s => s.entries)` with the active area's entries, so paging cannot cross from Guide into Components.
- **Mobile:** the top bar keeps logo + Guide/Components tabs + the existing ☰ drawer trigger; the drawer lists the active area's sections (text entries, section-header icons).

### D. Theme system (`styles/root.css` + init script + toggle)

- Refactor tokens so the **default** still comes from `@media (prefers-color-scheme: dark)`, with explicit overrides via `:root[data-theme="light"]` / `:root[data-theme="dark"]` carrying the same token blocks. No stored choice → media query wins and keeps reacting to OS changes.
- **Pre-paint init:** a tiny synchronous inline script in the SSR document `<head>` reads `localStorage` and sets `document.documentElement.dataset.theme` before first paint to avoid a flash. The server renders no `data-theme` (so SSR output is OS-default and there's no hydration mismatch); the attribute lives on `<html>`, outside the hydrated app root, and is managed imperatively (not via Preact render).
- **Toggle control:** a Preact component in the top bar cycling System → Light → Dark, writing/clearing `localStorage` and setting/removing the `<html data-theme>` attribute. System removes the key and the attribute.

**Implementation check:** locate where the SSR document `<head>` is emitted (the document shell / server entry) to host the inline init script.

## Replacement parity: touchpoints that MUST change together

| File | Change |
|---|---|
| `apps/site/src/pages/docs/nav.ts` | Reshape to `NavArea[]`; icons move to sections. |
| `apps/site/src/components/DocsRoute.tsx` | Recursive glob; nested slug derivation; verify inner multi-segment matching. |
| `apps/site/src/components/DocsLayout.tsx` | Top bar, area switcher, scoped rail/pager, active-area detection, theme toggle, remove in-rail logo. |
| `apps/site/src/styles/root.css` | `data-theme` override layer alongside the media-query default. |
| SSR document head (locate) | Pre-paint theme init script. |
| `apps/site/src/pages/docs/__tests__/nav.test.ts` | Currently asserts every `entry.icon` is a function. Update: assert `section.icon` is a function, entries are `{title, route}`, iterate areas→sections→entries, routes unique across all areas. |
| `apps/site/src/pages/docs/__tests__/mdx-routes.test.ts` | `discoverMdxSlugs()` must walk recursively (currently flat `readdirSync`); `navSlugs()` must flatten areas→sections→entries. |
| `.claude/skills/add-docs-page.md` | Rewrite for two areas: where guide vs. component MDX files go (`docs/` vs `docs/components/`), the section-icon model (entries have no icon), correct glob location (`DocsRoute.tsx`, not `iso.tsx`). |
| `.claude/skills/keep-docs-fresh.md` | Line ~42 "Nav structure (6 sections)" reference must reflect the new area/section structure. |

## Testing

- Unit (`nav.test.ts`): area/section/entry shape; section icons are components; routes unique; every Components route under `/docs/components/`.
- Contract (`mdx-routes.test.ts`): recursive MDX discovery ↔ nav parity in both directions, including nested files; `index.mdx`→`/docs` and `components/index.mdx`→`/docs/components`.
- Manual / visual: tab switch swaps the rail and highlights the right tab; collapsed-rail section click lands on the section's first page; pager stays within the area; theme toggle cycles System/Light/Dark with no flash on reload; landing-page hero unchanged.
- Run the six-step pre-push CI sequence (build → format:check → typecheck → test → test:integration → site build) before opening a PR.

## Alternatives considered

- **One sidebar with collapsible sections** (no areas): rejected, the collapsed icon rail still degrades because all sections stack into one list.
- **Switcher in a site-wide header**: rejected as more scope (no header exists; would touch the landing page) for the same navigational win; docs-only is sufficient.
- **Dropdown header + icon-light list**: held as the escape hatch if the component count later outgrows a single screen of section icons.
- **Flat component files with nav-driven area detection** (`/docs/dialog`, no `/components/` segment): avoids the routing change, but crowds the docs directory, loses area signaling in URLs, and risks slug collisions. Kept only as the fallback if preact-iso can't match nested inner routes.
