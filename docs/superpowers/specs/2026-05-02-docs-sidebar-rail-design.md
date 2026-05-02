# Docs Sidebar Rail — Design

## Summary

Replace the current docs sidebar with a three-state, icon-aware rail:

1. **Collapsed** (default): 56px wide, icon-only.
2. **Hover-peek**: 240px wide, icons + text, floats over content (does not push layout).
3. **Pinned**: 240px wide, icons + text, layout reserves the full width. Toggled by a pin button at the bottom of the rail.

Mobile (`< md`) preserves the current full-width slide-in overlay drawer; the rail markup is unified across breakpoints, with state and width branched by viewport.

Pin state is in-component state only. No persistence (localStorage / cookie).

Width and translate animations use a CSS `linear()` spring curve declared in `root.css`.

## Non-goals

- localStorage / cookie persistence of pin state.
- Mobile rail behavior (mobile keeps the existing slide-in drawer).
- Swipe gestures or Base UI Drawer integration on either platform.
- View-transition animation of the rail itself (existing route view-transitions are unaffected).
- Configurable widths or user-tunable animation speed.

## Architecture

### Component

A single `<aside>` rendered in `apps/app/src/components/DocsLayout.tsx`. The component owns three pieces of state:

- `pinned: boolean` (default `false`)
- `hovered: boolean` (driven by mouse enter/leave on the rail; an internal close-delay timer holds it true for ~120ms after leave)
- `mobileOpen: boolean` (existing behavior, controlled by the `☰ Menu` button)

The viewport split is purely CSS-driven via Tailwind's `md:` prefix; the same DOM is used at both breakpoints.

### State, viewport, and layout

| Viewport | State | Rail width | Grid column | Rail position |
|---|---|---|---|---|
| `< md` | closed | 0 (translated -100%) | n/a (rail is fixed) | `fixed`, off-screen |
| `< md` | open | 260px | n/a | `fixed`, on-screen |
| `≥ md` | collapsed | 56px | 56px | sticky in-flow |
| `≥ md` | hover-peek (`!pinned && hovered`) | 240px | 56px | sticky in-flow, but the *inner* panel is `absolute` and overflows the cell so it floats over content |
| `≥ md` | pinned | 240px | 240px | sticky in-flow |

Implementation note: to make hover-peek "float over" content while pinned "reserves" width, the desktop layout grid template column is driven by `pinned`, not `hovered`:

```
grid-template-columns: ${pinned ? '240px' : '56px'} 1fr;
```

The rail itself uses a wrapper of width `pinned ? 240px : 56px` (matches the grid), with an inner panel whose width is `(pinned || hovered) ? 240px : 56px`. The inner panel is `position: absolute; top: 0; left: 0; height: 100%` and has `overflow: hidden`, with a higher `z-index` than main content. When unpinned and hovered, the inner panel grows to 240px while the wrapper stays at 56px, producing the float-over effect. When pinned, both are 240px, so no float.

### Nav data shape change

`apps/app/src/pages/docs/nav.ts` gains an `icon` field per entry:

```ts
import type { LucideIcon } from 'lucide-preact';

export type NavEntry = { title: string; route: string; icon: LucideIcon };
export type NavSection = { heading: string; entries: NavEntry[] };
```

Concrete icon assignments (subject to taste, easy to swap later):

| Route | Icon |
|---|---|
| `/docs` | `BookOpen` |
| `/docs/quick-start` | `Rocket` |
| `/docs/pages` | `FileText` |
| `/docs/loaders` | `Database` |
| `/docs/loading-states` | `Loader` |
| `/docs/reloading` | `RefreshCw` |
| `/docs/prefetch` | `Zap` |
| `/docs/actions` | `Send` |
| `/docs/optimistic-ui` | `Sparkles` |
| `/docs/guards` | `ShieldCheck` |
| `/docs/action-guards` | `ShieldAlert` |
| `/docs/structure` | `FolderTree` |
| `/docs/render-page` | `Layers` |
| `/docs/vite-config` | `Settings` |
| `/docs/deployment` | `Cloud` |

Section headings are unchanged (no icon at the section level).

### Icon library

Add `lucide-preact` to `apps/app/package.json`. It exports React-compatible Preact components that work with the existing `@preact/compat` aliasing. Tree-shaken; one icon adds ~1KB.

If `lucide-preact` proves incompatible with the build for any reason, fall back to `lucide-react` (the project already aliases `react` → `@preact/compat`, so the React build of lucide should resolve to Preact-compatible components).

### Rendering by state

- **Collapsed:** each row shows only the icon, centered in a 56px square. Section headings are hidden. Active route is indicated by a colored background on the icon row.
- **Hover-peek / pinned:** each row shows icon + title side by side, left-aligned with 12px padding. Section headings (the existing uppercase labels) are visible above each section.
- **Mobile open:** identical visual treatment to "pinned" (icon + title + section headings), inside the existing 260px slide-in panel.

The transition between collapsed and expanded visuals is driven by the inner-panel width animation; text labels fade in via `opacity` keyed off the same width threshold (CSS `@container` query on the panel, or a parallel `data-expanded` attribute).

### Pin button

Bottom of the rail, in a `mt-auto` flex container so it always sits at the bottom regardless of nav length.

- Icon: `Pin` when unpinned, `PinOff` (or rotated `Pin`) when pinned.
- Hidden on mobile (`md:flex` on the button row, since on mobile the drawer is always fully expanded when open).
- Hidden text label in collapsed mode; visible "Pin sidebar" / "Unpin sidebar" label in hover-peek and pinned states.
- Click: `setPinned(p => !p)`. On unpin while still hovered, the rail stays expanded (because `hovered` is still true) until the user mouses away, which feels natural.

### Hover handling

- `onMouseEnter` on the rail wrapper sets `hovered = true` and clears any pending close timer.
- `onMouseLeave` schedules `setHovered(false)` after 120ms; re-entering cancels the timer.
- No open delay; expansion is instant.

The open and close timing live in the component, not in CSS, because the CSS `linear()` curve handles the *animation*, not the *trigger latency*.

### Animation

Add to `apps/app/src/styles/root.css`:

```css
:root {
  --spring-soft: linear(
    0, 0.5 7.5%, 0.85 14%, 1.02 21%, 1.04 28%, 1.01 38%,
    0.998 50%, 1.001 70%, 1
  );
  --spring-duration: 280ms;
}
```

Used by:

- The rail inner-panel `width` (`56px` ↔ `240px`).
- The desktop grid `grid-template-columns` (`56px` ↔ `240px`) when pinned toggles.
- The mobile drawer `transform: translateX(...)` (`-100%` ↔ `0`).

Per-property:

```css
transition:
  width var(--spring-duration) var(--spring-soft),
  transform var(--spring-duration) var(--spring-soft),
  grid-template-columns var(--spring-duration) var(--spring-soft);
```

Note: `grid-template-columns` is animatable in modern browsers (Chrome / Safari / Firefox via interpolation between equivalent track lists). If browser support proves spotty, the fallback is to animate the rail wrapper width directly and let the main content reflow without an explicit grid transition; the user-perceived effect is similar.

`linear()` is supported in Chrome 113+, Safari 17.2+, Firefox 112+. No fallback declaration needed for the project's target browsers.

### Coexistence with view-transitions

`@view-transition { navigation: auto }` (already in `root.css`) handles route changes with a fade. The rail's CSS transitions are scoped to the `<aside>` and apply to layout properties unrelated to view-transition pseudo-elements, so the two effects do not interact.

When the route changes, the rail's "active" highlight moves; this is animated by the same `linear()` curve via `background-color` and color transitions on the link rows.

## Accessibility

- The rail is a single `<aside>` with `aria-label="Docs navigation"`.
- The pin button is a `<button>` with `aria-pressed={pinned}` and an accessible name reflecting the current action ("Pin sidebar" / "Unpin sidebar").
- Each link's accessible name is its `title`; in collapsed mode, the icon-only row has `aria-label={title}` so screen readers still get the route name.
- `prefers-reduced-motion: reduce` overrides set `--spring-duration: 0ms` on the relevant transitions.

## Files touched

- `apps/app/src/components/DocsLayout.tsx` — rewrite the layout to introduce the three-state rail and unify mobile/desktop markup.
- `apps/app/src/pages/docs/nav.ts` — add `icon` field per entry; populate from the table above.
- `apps/app/src/styles/root.css` — add `--spring-soft` and `--spring-duration` variables; add `prefers-reduced-motion` override.
- `apps/app/package.json` — add `lucide-preact` (or `lucide-react` if the former does not build cleanly).

## Open questions

None.

## Risks

- **`grid-template-columns` interpolation:** if the browser's interpolation produces a janky animation on the layout grid, fall back to animating only the rail wrapper width (the page main content reflows naturally as the rail wrapper changes width).
- **lucide-preact build:** if Preact-compat aliasing causes resolution issues, swap to `lucide-react`. Both consume the same icon names; the change is mechanical.
- **Hover trap on transient hovers:** the 120ms close delay is intentional; if testers report "rail stays open too long" or "rail closes too fast," tune in 40ms increments.
