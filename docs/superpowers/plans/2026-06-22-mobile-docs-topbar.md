# Mobile Docs Topbar Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/docs/*` topbar usable on phones by moving secondary controls into the hamburger drawer and shrinking the search trigger to an icon below the `md` breakpoint.

**Architecture:** A single breakpoint, `md` (768px, already where the hamburger/drawer and the sidebar grid appear), governs the whole change. Below `md` the bar is compact (hamburger, logo, spacer, icon-only search, theme); at `md`+ it is byte-for-byte what it is today. The drawer gains a segmented Guide/Components area switcher and a footer (GitHub, For LLMs, version) so every moved control stays reachable on mobile.

**Tech Stack:** Preact + JSX, Tailwind v4 utility classes (mobile-first responsive variants), the `hono-preact-ui` `Dialog`, `lucide-preact` icons. No new dependencies.

## Global Constraints

- **Single breakpoint:** `md` (768px). Below `md` = compact chrome; `md`+ = unchanged from today. Use mobile-first Tailwind variants (base = mobile, `md:` = desktop). Do not introduce `sm:` for any control touched here.
- **llms.txt links are native navs:** every `<a href="/llms*.txt">` in `apps/site/src/components/DocsLayout.tsx` MUST carry `target="_blank" rel="noreferrer noopener"`. This is load-bearing (the `/llms.txt` path is not an SPA route; a same-tab `<a>` soft-navs to the not-found page) and is enforced by `llms-discoverability.test.ts`. After this work there are TWO such anchors (the desktop-bar link and the new drawer-footer link); both must keep the attributes.
- **Desktop chrome unchanged:** at `md`+ the topbar renders exactly as before. Verify the desktop bar visually at the end.
- **No em-dashes** in prose, comments, or commit messages (global rule). Use commas, colons, parentheses, or two sentences.
- **No new dependencies.**

## File Structure

- `apps/site/src/components/DocsLayout.tsx` (modify) — owns the topbar and the mobile drawer. Tasks 1 and 3 edit it: Task 1 adds the drawer area switcher and footer (additive, drawer-only); Task 3 hides the secondary bar items below `md`.
- `apps/site/src/components/CommandPalette.tsx` (modify) — owns the search trigger + dialog. Task 2 makes the trigger icon-only below `md`. The Cmd+K shortcut and the dialog are untouched.
- `apps/site/src/pages/docs/__tests__/llms-discoverability.test.ts` (run only, do not edit) — the source-content gate that must stay green.

**Task ordering rationale:** Task 1 is additive (drawer gains a switcher; bar unchanged), so every intermediate commit leaves a working app. Task 3 (which removes the bar tabs on mobile) comes last, after the drawer already provides the mobile area switcher, so mobile area-switching is never broken between commits.

**Testing note (read before starting):** This is a markup/CSS change with no new logic. The load-bearing invariant (For LLMs native-nav) is already guarded by `llms-discoverability.test.ts`; everything else is layout, verified visually at two widths. We deliberately add no new unit test: a full `DocsLayout` render test would require mocking `virtual:docs-index`, the preact-iso router context, `NavLink`, and `useRouteActive` for a pure-presentation change, and a class-string assertion would be brittle test theater. Verification is: existing gate green + `pnpm typecheck` + `pnpm format:check` + `pnpm --filter site build` + visual check at ~375px and ~1280px.

---

### Task 1: Drawer area switcher + footer

Add a segmented Guide/Components switcher to the top of the mobile drawer (replacing the static area-label title) and a footer with GitHub / For LLMs / version. Additive: the topbar is untouched in this task, so the app keeps working.

**Files:**
- Modify: `apps/site/src/components/DocsLayout.tsx`
- Run (do not edit): `apps/site/src/pages/docs/__tests__/llms-discoverability.test.ts`

**Interfaces:**
- Consumes (already in the file): `nav` (`NavArea[]`), `activeAreaId` (`'guide' | 'components'`), `activeArea`, `setMobileOpen`, `renderNav`, `GithubMark`, `__HONO_PREACT_VERSION__`.
- Produces: a `renderAreaSwitcher()` local helper used inside the drawer; a drawer footer block. Nothing outside this file consumes these.

- [ ] **Step 1: Add the `renderAreaSwitcher` helper**

In `apps/site/src/components/DocsLayout.tsx`, immediately AFTER the closing of the `renderNav` arrow (the line `  );` that ends `renderNav`, just before `return (`), insert:

```tsx
  // Drawer-only area switcher (the desktop bar has its own tabs). Plain <a>s to
  // each area's basePath, same soft-nav targets as the bar tabs; the active one
  // is highlighted. Navigation closes the drawer via the existing path effect.
  const renderAreaSwitcher = () => (
    <nav
      aria-label="Docs areas"
      class="flex-1 flex rounded-md border border-border overflow-hidden text-sm"
    >
      {nav.map((area) => {
        const TabIcon = area.icon;
        const isActive = area.id === activeAreaId;
        return (
          <a
            key={area.id}
            href={area.basePath}
            aria-current={isActive ? 'true' : undefined}
            class={`flex-1 flex items-center justify-center gap-1.5 h-9 no-underline ${
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
  );
```

- [ ] **Step 2: Replace the drawer header (static label) with the switcher row**

Find this block (the drawer's first child):

```tsx
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
```

Replace it with:

```tsx
          <div class="flex items-center gap-2 px-3 py-3 border-b border-border">
            {renderAreaSwitcher()}
            <button
              type="button"
              class="shrink-0 bg-transparent border-none text-[1.1rem] text-muted cursor-pointer leading-none p-1 hover:text-foreground"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              ✕
            </button>
          </div>
```

- [ ] **Step 3: Add the drawer footer**

Find the drawer body line and its closing `</aside>`:

```tsx
          <div class="p-3 overflow-y-auto flex-1">{renderNav(activeArea)}</div>
        </aside>
```

Replace with (body unchanged, footer added before `</aside>`):

```tsx
          <div class="p-3 overflow-y-auto flex-1">{renderNav(activeArea)}</div>
          <div class="border-t border-border px-4 py-3 flex items-center gap-4 text-xs text-muted">
            <a
              href="https://github.com/sbesh91/hono-preact"
              target="_blank"
              rel="noreferrer noopener"
              class="flex items-center gap-1.5 no-underline hover:text-foreground"
            >
              <GithubMark size={16} />
              <span>GitHub</span>
            </a>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noreferrer noopener"
              class="no-underline hover:text-foreground"
              title="Plain-text docs for LLMs (llms.txt)"
            >
              For LLMs
            </a>
            <span class="ml-auto">v{__HONO_PREACT_VERSION__}</span>
          </div>
        </aside>
```

- [ ] **Step 4: Run the discoverability gate**

Run: `pnpm exec vitest run llms-discoverability`
Expected: PASS (5 tests). The new drawer-footer `href="/llms.txt"` carries `target="_blank"`, so the "native navigations" assertion stays green with two matching anchors.

- [ ] **Step 5: Typecheck and format**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm format` then `pnpm format:check`
Expected: `format:check` reports all files formatted (the auto-fix in `format` settles any whitespace).

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/DocsLayout.tsx
git commit -m "feat(site): add area switcher and footer to the docs mobile drawer"
```

---

### Task 2: Icon-only search trigger below `md`

Make the `CommandPalette` trigger collapse to a single search icon below `md`, hiding the "Search" label and the ⌘K kbd. The dialog and the Cmd+K shortcut are untouched.

**Files:**
- Modify: `apps/site/src/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change. `CommandPalette` still takes `{ pages }` and renders the same trigger element, only with responsive label visibility and an `aria-label` so the icon-only state keeps an accessible name.

- [ ] **Step 1: Make the trigger label/kbd responsive and add an accessible name**

In `apps/site/src/components/CommandPalette.tsx`, find:

```tsx
      <button
        type="button"
        class="docs-cmdk-trigger"
        onClick={() => setOpen(true)}
      >
        <Search size={15} class="shrink-0 opacity-70" />
        <span>Search</span>
        <kbd class="docs-cmdk-kbd">⌘K</kbd>
      </button>
```

Replace with:

```tsx
      <button
        type="button"
        class="docs-cmdk-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search docs"
      >
        <Search size={15} class="shrink-0 opacity-70" />
        <span class="hidden md:inline">Search</span>
        <kbd class="docs-cmdk-kbd hidden md:inline">⌘K</kbd>
      </button>
```

Below `md` only the icon renders; with the label gone, `.docs-cmdk-trigger`'s `0.6rem` horizontal padding around the 15px icon yields a ~34px square that sits beside the theme toggle. At `md`+ the full pill returns. No CSS change is required.

- [ ] **Step 2: Typecheck and format**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm format` then `pnpm format:check`
Expected: `format:check` clean.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/components/CommandPalette.tsx
git commit -m "feat(site): collapse the docs search trigger to an icon below md"
```

---

### Task 3: Hide secondary bar items below `md`

Hide the area tabs, version, For LLMs link, and GitHub mark in the topbar below `md` (they now live in the drawer from Task 1). This completes the declutter. Search is already icon-only (Task 2).

**Files:**
- Modify: `apps/site/src/components/DocsLayout.tsx`
- Run (do not edit): `apps/site/src/pages/docs/__tests__/llms-discoverability.test.ts`

**Interfaces:**
- Consumes: the drawer switcher + footer from Task 1 (so the hidden items remain reachable on mobile).
- Produces: the final compact mobile bar (hamburger, logo, spacer, icon search, theme).

- [ ] **Step 1: Hide the area tabs below `md`**

Find:

```tsx
        <nav class="flex items-center gap-1" aria-label="Docs areas">
```

Replace with:

```tsx
        <nav class="hidden md:flex items-center gap-1" aria-label="Docs areas">
```

- [ ] **Step 2: Move the version label to `md`+ only**

Find:

```tsx
        <span class="hidden sm:inline text-xs text-muted whitespace-nowrap">
          v{__HONO_PREACT_VERSION__}
        </span>
```

Replace with:

```tsx
        <span class="hidden md:inline text-xs text-muted whitespace-nowrap">
          v{__HONO_PREACT_VERSION__}
        </span>
```

- [ ] **Step 3: Hide the topbar For LLMs link below `md` (keep native-nav attrs)**

Find:

```tsx
        <a
          href="/llms.txt"
          target="_blank"
          rel="noreferrer noopener"
          class="text-xs text-muted hover:text-foreground whitespace-nowrap no-underline"
          title="Plain-text docs for LLMs (llms.txt)"
        >
          For LLMs
        </a>
```

Replace with (only the `class` gains `hidden md:inline`; `target`/`rel` stay):

```tsx
        <a
          href="/llms.txt"
          target="_blank"
          rel="noreferrer noopener"
          class="hidden md:inline text-xs text-muted hover:text-foreground whitespace-nowrap no-underline"
          title="Plain-text docs for LLMs (llms.txt)"
        >
          For LLMs
        </a>
```

- [ ] **Step 4: Hide the topbar GitHub mark below `md`**

Find:

```tsx
        <a
          href="https://github.com/sbesh91/hono-preact"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="hono-preact on GitHub"
          class="flex items-center justify-center h-8 w-8 rounded text-muted hover:text-foreground hover:bg-foreground/10"
        >
          <GithubMark />
        </a>
```

Replace with (class gains `hidden md:flex`):

```tsx
        <a
          href="https://github.com/sbesh91/hono-preact"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="hono-preact on GitHub"
          class="hidden md:flex items-center justify-center h-8 w-8 rounded text-muted hover:text-foreground hover:bg-foreground/10"
        >
          <GithubMark />
        </a>
```

- [ ] **Step 5: Run the discoverability gate**

Run: `pnpm exec vitest run llms-discoverability`
Expected: PASS. The topbar For LLMs anchor kept `target="_blank"` (now `hidden md:inline`), and the drawer-footer anchor from Task 1 also has it; both `/llms.txt` anchors satisfy the native-nav assertion.

- [ ] **Step 6: Typecheck, format, build**

Run: `pnpm typecheck`
Expected: no errors.
Run: `pnpm format` then `pnpm format:check`
Expected: `format:check` clean.
Run: `pnpm --filter site build`
Expected: build succeeds.

- [ ] **Step 7: Visual verification (the whole feature)**

Start the dev server (`pnpm --filter site dev`, served at http://localhost:5173) and open `/docs`. Verify at two widths (resize the window or use a responsive tool / browser MCP `set_viewport_size`):

Mobile (~375px wide):
- The topbar shows exactly: `☰`, `hono-preact`, a gap, a square search icon button, the theme toggle. Nothing overflows or wraps; no horizontal scroll.
- Tapping the search icon opens the Cmd+K dialog.
- Tapping `☰` opens the drawer. The drawer top shows a segmented `[Guide][Components]` switcher with the current area highlighted, then the section links, then a footer with GitHub, For LLMs, and the version.
- Tapping the inactive area in the switcher navigates to it and closes the drawer; reopening shows the other area's sections highlighted.
- The footer For LLMs link opens `/llms.txt` in a new tab (plain text, not the docs not-found page).

Desktop (~1280px wide):
- The topbar is unchanged from before: logo, Guide/Components tabs (with text), full Search pill with ⌘K, version, For LLMs, GitHub icon, theme toggle.
- No drawer; the left rail is pinned open.

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/components/DocsLayout.tsx
git commit -m "feat(site): collapse secondary docs topbar controls into the drawer below md"
```

---

## Final pre-PR verification

Before opening a PR, run the CLAUDE.md pre-push sequence (framework dist must be current first, since site typecheck resolves cross-package types through it):

```bash
pnpm --filter '@hono-preact/*' --filter hono-preact --filter hono-preact-ui build
pnpm format:check
pnpm typecheck
pnpm test:types
pnpm test:coverage   # or `pnpm test`
pnpm test:integration
pnpm --filter site build
```

All site changes are presentation-only and app-scoped, so no framework package or release note is affected.
