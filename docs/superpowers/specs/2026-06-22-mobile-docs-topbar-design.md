# Declutter the docs topbar on mobile

Date: 2026-06-22
Status: Approved, ready for implementation plan

## Problem

The docs topbar (`apps/site/src/components/DocsLayout.tsx`, wrapping every
`/docs/*` page) has accumulated controls as features shipped: the
Guide/Components area tabs (PR B, #155), the Cmd+K search button (#144), and the
"For LLMs" link (#158, made always-visible in #159), on top of the logo,
version, GitHub mark, and theme toggle.

Below the `md` breakpoint the bar tries to fit all of these on one
non-wrapping 48px row. The area tabs and the search button carry text that does
not shrink, so on a phone the content sums well past the viewport width and
overflows. The homepage (`/`) and `/demo` have their own chrome and are not
affected; this is purely the docs layout.

## Goals

- The mobile (`< md`) topbar fits a phone width with no overflow.
- Search, the section-nav hamburger, and the theme toggle stay one tap away in
  the bar (user-selected priorities).
- Everything moved out of the bar (area switch, GitHub, For LLMs, version) stays
  reachable in one drawer-open.
- Desktop (`>= md`) chrome is unchanged.

## Non-goals

- Desktop topbar layout, homepage/`/demo` nav, the nav data model
  (`pages/docs/nav.ts`).
- The `/llms.txt` dev-serving middleware (landed in #159, already on `main`).
- Any change to view transitions, the Cmd+K shortcut, or the search dialog.

## Design

### Breakpoint strategy

A single breakpoint, `md` (768px), governs the whole change. It is already the
point where the hamburger/drawer appear and the layout grid gains its sidebar.
Below `md`: "compact" chrome. At `md` and up: the bar is exactly as it is today.

### 1. Mobile topbar (`< md`)

Left to right: `☰` hamburger, **hono-preact** logo, flex spacer, search
(icon-only), theme toggle. Five compact controls; nothing carries
non-shrinking text except the logo.

Hidden below `md` (shown at `md`+ as today): the Guide/Components area tabs, the
GitHub mark, the "For LLMs" link, and the `v{__HONO_PREACT_VERSION__}` label.
Post-#159 the For LLMs link is always-visible in the bar (its `hidden sm:inline`
was removed); this redesign gives it `hidden md:inline` in the bar and renders it
in the drawer footer below `md`, so it stays discoverable on mobile (#159's
intent) without crowding the bar. The version label keeps the same
bar-at-`md`+ / drawer-on-mobile treatment.

Decision: search sits **left of** the theme toggle.

### 2. Responsive search trigger

`CommandPalette` is used only in `DocsLayout`, so the trigger is made responsive
locally. Below `md` it collapses to a single ~32px square icon button (matching
the GitHub and theme buttons): the "Search" label and the `⌘K` kbd are hidden,
and the button becomes a centered square. At `md`+ it is the full pill as today.

Mechanism: hide the label/kbd spans below `md` and switch the trigger to a fixed
square via responsive classes (Tailwind utilities on the spans plus a small
adjustment to `.docs-cmdk-trigger` in `root.css`, or equivalent). The Cmd+K
keyboard shortcut and the `Dialog` popup are untouched; only the trigger's
presentation changes.

### 3. Drawer (opened by `☰`, `< md` only)

The drawer is already the mobile section-nav surface. It gains an area switcher
and a footer.

- **Top:** a **segmented** area switcher with two controls, **[Guide]** and
  **[Components]**, plus the existing close `✕`. Tapping a control navigates to
  that area's `basePath` (same target the desktop tabs use); the existing
  `useEffect(() => setMobileOpen(false), [path])` closes the drawer on the
  resulting navigation. The active area is highlighted. This replaces today's
  static `{activeArea.label}` title row.
- **Body:** the active area's section nav, unchanged (`renderNav(activeArea)`).
- **Footer:** pinned below the section list, a GitHub link, a "For LLMs" link,
  and the `v{__HONO_PREACT_VERSION__}` label. The For LLMs link must carry
  `target="_blank" rel="noreferrer noopener"` exactly as the bar link does: this
  is a real requirement, not cosmetic. `/llms.txt` is not an SPA route, so a
  same-tab `<a>` is intercepted by preact-iso and soft-navs to the not-found
  page (the bug #159 fixed); `target="_blank"` forces a native navigation to the
  served file. The discoverability gate also asserts every `/llms*.txt` anchor
  in `DocsLayout.tsx` is a native nav. The GitHub link is already `target="_blank"`.

### Result

The mobile bar drops from seven jostling items to five compact ones, nothing
overflows, and every moved control is reachable with a single drawer-open. The
desktop bar is byte-for-byte unchanged.

## Files

- `apps/site/src/components/DocsLayout.tsx` — topbar responsive classes (hide
  area tabs / GitHub / For LLMs / version below `md`); drawer area switcher
  (segmented) replacing the static label row; drawer footer with
  GitHub / For LLMs / version.
- `apps/site/src/components/CommandPalette.tsx` — responsive trigger
  (icon-only below `md`).
- `apps/site/src/styles/root.css` — if needed, a small adjustment to
  `.docs-cmdk-trigger` for the square-icon state.

## Testing and verification

- Keep `apps/site/src/pages/docs/__tests__/llms-discoverability.test.ts` green.
  Two of its assertions touch `DocsLayout.tsx`: (1) the file still contains
  `href="/llms.txt"` (satisfied by the drawer-footer link), and (2) every
  `<a href="/llms*.txt">` in the file carries `target="_blank"` or `download`
  (satisfied by keeping the native-nav attributes on the relocated link). After
  the move there is exactly one such anchor in the file; it must keep
  `target="_blank"`.
- Run the pre-push subset that applies: `pnpm format:check`, `pnpm typecheck`,
  `pnpm test`, and `pnpm --filter site build`.
- Visually verify with the run skill at ~375px (bar fits; drawer opens; the
  segmented switch flips areas and navigates; footer links work) and at ~1280px
  (desktop bar unchanged). No view-transition behavior changes, so the
  "MCP can't verify view transitions" caveat does not apply here.

## Baseline: PR #159 (merged, on `main`)

PR #159 (`07cc041`) is the immediate predecessor and the baseline this work
edits. It did two things, both now on `main`:

1. Serve `/llms.txt` and `/llms-full.txt` in dev via a `configureServer`
   middleware (the Cloudflare dev server does not serve the dist/client assets
   dir). Untouched by this work.
2. Made the For LLMs topbar link always-visible (removed `hidden sm:inline`) and
   a native nav (`target="_blank" rel="noreferrer noopener"`), and extended the
   discoverability gate to assert every `/llms*.txt` anchor is a native nav.

This redesign keeps #159's intent (For LLMs reachable on mobile) while fixing the
crowding it added to the mobile bar: the link moves to the drawer footer below
`md`, retaining its native-nav attributes so the gate stays green and the
soft-nav 404 stays fixed. It remains in the desktop bar at `md`+.
