# Zune Tailwind Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/site` a Zune-brand Tailwind v4 theme: a brand + semantic token layer with an OS-driven dark variant, signature "orangenta" gradient utilities, a bundled Selawik font, and a light application pass across home, docs, and MDX prose.

**Architecture:** Tailwind v4 is CSS-first, so all theming lives in `apps/site/src/styles/root.css`. A static `@theme` holds the brand palette + `--font-sans`; `@theme inline` maps semantic `--color-*` tokens onto plain CSS vars that flip under `@media (prefers-color-scheme: dark)`. Four `@utility` rules expose the orange-to-magenta gradient. Selawik is self-hosted as woff2 referenced from `@font-face`. Components swap stock `blue-*`/`slate-*` for the new tokens.

**Tech Stack:** Tailwind v4 (`@tailwindcss/postcss`), Vite, Preact, MDX. Font conversion is a one-off build step using `wawoff2` (wasm woff2 encoder). The site builds via `hono-preact/vite` + the Cloudflare adapter.

**Spec:** `docs/superpowers/specs/2026-06-01-zune-tailwind-theme-design.md`

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `apps/site/src/styles/fonts/*.woff2` | Selawik Light/Regular/Semibold/Bold web fonts | create (binary) |
| `apps/site/src/styles/fonts/LICENSE-Selawik.txt` | OFL 1.1 license for the bundled font | create |
| `apps/site/src/styles/root.css` | `@font-face`, brand + semantic tokens, dark variant, gradient utilities, MDX prose tokens | modify |
| `apps/site/src/Layout.tsx` | global background/text/font on `<body>` | modify |
| `apps/site/src/pages/home.tsx` | hero gradient heading + energy bar, magenta CTA, tokenized cards/footer | modify |
| `apps/site/src/components/DocsLayout.tsx` | magenta active state, slate chrome -> semantic tokens | modify |

All paths below are relative to the repo root `/Users/stevenbeshensky/Documents/repos/hono-preact`.

**Note on TDD:** This is a styling change; the token layer and utilities are not unit-testable. The existing `home.test.tsx` (text/href/structure assertions, none on color classes) is the regression guard and must stay green. Each task ends with a build or test verification plus a commit. No new test framework is added.

---

## Task 1: Bundle the Selawik font

**Files:**
- Create: `apps/site/src/styles/fonts/selawik-light.woff2`
- Create: `apps/site/src/styles/fonts/selawik-regular.woff2`
- Create: `apps/site/src/styles/fonts/selawik-semibold.woff2`
- Create: `apps/site/src/styles/fonts/selawik-bold.woff2`
- Create: `apps/site/src/styles/fonts/LICENSE-Selawik.txt`

This is a proven recipe: `Selawik_Release.zip` (GitHub release 1.01) contains `selawkl/selawk/selawksb/selawkb.ttf`; `wawoff2` converts each (`selawk.ttf` 44,224 B -> 14,476 B, valid `wOF2`).

- [ ] **Step 1: Create the fonts directory**

Run:
```bash
mkdir -p apps/site/src/styles/fonts
```

- [ ] **Step 2: Download + convert the four weights to woff2**

Run (writes the four woff2 files straight into the repo):
```bash
REPO="$(pwd)"
WORK=/tmp/selawik-build; rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
curl -fsSL --max-time 60 -o Selawik_Release.zip \
  "https://github.com/microsoft/Selawik/releases/download/1.01/Selawik_Release.zip"
unzip -oq Selawik_Release.zip
npm init -y >/dev/null 2>&1
npm i wawoff2@2.0.1 >/dev/null 2>&1
cat > convert.mjs <<'EOF'
import { compress } from 'wawoff2';
import { readFileSync, writeFileSync } from 'node:fs';
const out = process.env.OUT;
const map = {
  'selawkl.ttf': 'selawik-light.woff2',
  'selawk.ttf': 'selawik-regular.woff2',
  'selawksb.ttf': 'selawik-semibold.woff2',
  'selawkb.ttf': 'selawik-bold.woff2',
};
for (const [src, dst] of Object.entries(map)) {
  const woff2 = await compress(readFileSync(src));
  writeFileSync(`${out}/${dst}`, Buffer.from(woff2));
  console.log(dst, woff2.length, 'bytes');
}
EOF
OUT="$REPO/apps/site/src/styles/fonts" node convert.mjs
cd "$REPO"
```

Expected: four lines like `selawik-regular.woff2 14476 bytes`.

- [ ] **Step 3: Download the OFL license**

Run:
```bash
curl -fsSL --max-time 30 \
  "https://raw.githubusercontent.com/microsoft/Selawik/master/LICENSE.txt" \
  -o apps/site/src/styles/fonts/LICENSE-Selawik.txt
```

- [ ] **Step 4: Verify the woff2 headers and license**

Run:
```bash
for f in light regular semibold bold; do
  printf '%s: ' "$f"; head -c 4 "apps/site/src/styles/fonts/selawik-$f.woff2" | xxd | head -1
done
head -n 2 apps/site/src/styles/fonts/LICENSE-Selawik.txt
ls -la apps/site/src/styles/fonts/
```

Expected: every woff2 begins `774f 4632` (`wOF2`); the license file is non-empty; five files total (4 woff2 + 1 txt).

> **Fallback (only if Steps 2-3 are blocked by no network):** skip this task, leave `apps/site/src/styles/fonts/` absent, and in Task 2 omit the `@font-face` block and set `--font-sans: 'Segoe UI', system-ui, -apple-system, sans-serif;` instead. Note the deferral in the Task 7 commit message.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/styles/fonts
git commit -m "feat(site): bundle Selawik (OFL 1.1) as woff2 for the Zune theme"
```

---

## Task 2: Brand + semantic tokens, dark variant, font wiring

**Files:**
- Modify: `apps/site/src/styles/root.css` (top of file + existing `:root` block at lines 9-23)

- [ ] **Step 1: Add the `@font-face` block + token blocks after the `@import`**

In `apps/site/src/styles/root.css`, the file currently starts:
```css
@import 'tailwindcss';

@utility shadow-card {
```

Insert the following between the `@import 'tailwindcss';` line and the `@utility shadow-card` rule:
```css
@font-face {
  font-family: 'Selawik';
  font-style: normal;
  font-weight: 300;
  font-display: swap;
  src: url('./fonts/selawik-light.woff2') format('woff2');
}
@font-face {
  font-family: 'Selawik';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('./fonts/selawik-regular.woff2') format('woff2');
}
@font-face {
  font-family: 'Selawik';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('./fonts/selawik-semibold.woff2') format('woff2');
}
@font-face {
  font-family: 'Selawik';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('./fonts/selawik-bold.woff2') format('woff2');
}

@theme {
  --font-sans: 'Selawik', 'Segoe UI', system-ui, -apple-system, sans-serif;

  /* Zune brand colors (sRGB equivalents of the guideline Pantone specs) */
  --color-zune-magenta: #ec008c; /* Pantone Process Magenta C */
  --color-zune-orange: #fe5000; /* Pantone Orange 021 C - gradient use only */
  --color-zune-grey: #888b8d; /* Cool Gray 8C - the wordmark grey */
  --color-zune-ink: #25282a; /* Pantone 426C */

  --color-magenta-50: #fdeaf4;
  --color-magenta-100: #fbcfe6;
  --color-magenta-200: #f7a3cf;
  --color-magenta-300: #f06fb3;
  --color-magenta-400: #f23a9b;
  --color-magenta-500: #ec008c;
  --color-magenta-600: #c40076;
  --color-magenta-700: #9b005d;
  --color-magenta-800: #7a0049;
  --color-magenta-900: #5c0037;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-surface: var(--surface);
  --color-surface-subtle: var(--surface-subtle);
  --color-border: var(--border-color);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent-hover: var(--accent-hover);
  --color-ring: var(--ring);
}
```

> Fallback mode only: drop the four `@font-face` blocks above and set `--font-sans: 'Segoe UI', system-ui, -apple-system, sans-serif;`.

- [ ] **Step 2: Add semantic var values + gradient into the existing `:root` block**

The existing `:root` block is:
```css
:root {
  --spring-soft: linear(
    0,
    0.18 6%,
    0.42 14%,
    0.66 24%,
    0.84 34%,
    0.94 44%,
    0.985 55%,
    1.005 70%,
    1.001 82%,
    1
  );
  --spring-duration: 380ms;
}
```

Replace it with (adds the light-mode semantic tokens + the gradient var; keeps the spring vars):
```css
:root {
  --spring-soft: linear(
    0,
    0.18 6%,
    0.42 14%,
    0.66 24%,
    0.84 34%,
    0.94 44%,
    0.985 55%,
    1.005 70%,
    1.001 82%,
    1
  );
  --spring-duration: 380ms;

  /* Semantic theme tokens (light) - flipped in the dark media query below */
  --background: #ffffff;
  --foreground: #25282a;
  --muted: #63666a; /* Cool Gray 10C */
  --surface: #ffffff;
  --surface-subtle: #f4f4f2;
  --border-color: rgba(37, 40, 42, 0.1);
  --accent: #ec008c;
  --accent-foreground: #ffffff;
  --accent-hover: #c40076;
  --ring: #ec008c;

  /* Signature orange-to-magenta "orangenta" gradient (left to right) */
  --gradient-orangenta: linear-gradient(90deg, #fe5000 0%, #ec008c 100%);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #1b1d1e;
    --foreground: #e9eae8;
    --muted: #bbbcbc; /* Cool Gray 4C */
    --surface: #25282a; /* Pantone 426C */
    --surface-subtle: #2f3234;
    --border-color: rgba(255, 255, 255, 0.12);
    --accent: #ec008c;
    --accent-foreground: #ffffff;
    --accent-hover: #ff4db0;
    --ring: #ec008c;
  }
}
```

- [ ] **Step 3: Build the site to verify tokens compile and fonts emit**

Run:
```bash
pnpm --filter site build
```
Expected: build succeeds. Then confirm the fonts were emitted and referenced (skip in fallback mode):
```bash
find apps/site/dist -name 'selawik-*.woff2' | head
grep -rl 'selawik-' apps/site/dist --include='*.css' | head
```
Expected: four hashed `selawik-*.woff2` assets and at least one CSS file referencing them.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/styles/root.css
git commit -m "feat(site): add Zune brand + semantic tokens with dark variant"
```

---

## Task 3: Signature gradient utilities + MDX prose tokens

**Files:**
- Modify: `apps/site/src/styles/root.css` (after the `shadow-card` utility; and the `.mdx-content` rules)

- [ ] **Step 1: Add the four gradient utilities**

Immediately after the existing `@utility shadow-card { ... }` block in `apps/site/src/styles/root.css`, add:
```css
@utility bg-orangenta {
  background-image: var(--gradient-orangenta);
}

@utility text-orangenta {
  background-image: var(--gradient-orangenta);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

@utility energy-bar {
  display: block;
  height: 0.25rem;
  border-radius: 9999px;
  background-image: var(--gradient-orangenta);
}

@utility bg-zune-cloud {
  background-image:
    radial-gradient(60% 60% at 30% 20%, rgba(254, 80, 0, 0.18), transparent 70%),
    radial-gradient(60% 60% at 75% 60%, rgba(236, 0, 140, 0.18), transparent 70%),
    radial-gradient(50% 50% at 60% 90%, rgba(201, 125, 255, 0.16), transparent 70%);
}
```

- [ ] **Step 2: Swap hardcoded MDX prose colors for semantic tokens**

In the `.mdx-content` section of `apps/site/src/styles/root.css`, apply these exact replacements:

`.mdx-content a` block:
```css
.mdx-content a {
  color: var(--accent);
  text-decoration: underline;
}
.mdx-content a:hover {
  color: var(--accent-hover);
}
```

`.mdx-content code`: change `background: #f1f5f9;` to `background: var(--surface-subtle);`

`.mdx-content th`: change `border: 1px solid #cbd5e1;` to `border: 1px solid var(--border-color);` and `background: #f8fafc;` to `background: var(--surface-subtle);`

`.mdx-content td`: change `border: 1px solid #cbd5e1;` to `border: 1px solid var(--border-color);`

`.mdx-content tr:nth-child(even) td`: change `background: #f8fafc;` to `background: var(--surface-subtle);`

`.mdx-content blockquote`: change `border-left: 3px solid #94a3b8;` to `border-left: 3px solid var(--border-color);` and `color: #475569;` to `color: var(--muted);`

`.mdx-content hr`: change `border-top: 1px solid #e2e8f0;` to `border-top: 1px solid var(--border-color);`

- [ ] **Step 3: Build to verify the utilities compile**

Run:
```bash
pnpm --filter site build
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/styles/root.css
git commit -m "feat(site): add orangenta gradient utilities, tokenize MDX prose"
```

---

## Task 4: Apply global background, text, and font on `<body>`

**Files:**
- Modify: `apps/site/src/Layout.tsx:11`

- [ ] **Step 1: Update the `<body>` class**

Change line 11 of `apps/site/src/Layout.tsx` from:
```tsx
      <body class="bg-gray-300 isolate">
```
to:
```tsx
      <body class="bg-background text-foreground font-sans antialiased isolate">
```

- [ ] **Step 2: Build to verify**

Run:
```bash
pnpm --filter site build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/site/src/Layout.tsx
git commit -m "feat(site): apply themed background, text, and Selawik font globally"
```

---

## Task 5: Brand the home page

**Files:**
- Modify: `apps/site/src/pages/home.tsx`
- Test: `apps/site/src/pages/__tests__/home.test.tsx` (run only; no edits expected)

- [ ] **Step 1: Hero - version pill, energy bar, gradient heading, description**

In `apps/site/src/pages/home.tsx`, replace the hero `<section>` (currently lines 17-40, from `<section class="space-y-4 text-center">` through its closing `</section>`) with:
```tsx
        {/* Hero */}
        <section class="space-y-4 text-center">
          <span
            class="energy-bar w-16 mx-auto"
            aria-hidden="true"
          />
          <p class="inline-block bg-surface/70 backdrop-blur text-xs px-2 py-0.5 rounded-full border border-border">
            hono-preact v{__HONO_PREACT_VERSION__}
          </p>
          <h1 class="text-5xl font-semibold text-orangenta">
            A small full-stack framework.
          </h1>
          <p class="text-lg text-muted max-w-2xl mx-auto">
            Hono on the edge, Preact in the browser, manifest driven routes,
            typed RPC, streaming everywhere.
          </p>
          <div class="flex gap-3 justify-center pt-2">
            <a
              href="/docs/quick-start"
              class="bg-accent text-accent-foreground px-4 py-2 font-medium rounded-md hover:bg-accent-hover"
            >
              Get started
            </a>
            <a
              href="/demo"
              class="border border-border text-foreground px-4 py-2 font-medium rounded-md bg-surface/80 backdrop-blur"
            >
              See the demo
            </a>
          </div>
        </section>
```

- [ ] **Step 2: "Keep it simple" heading + footer**

In the same file, change the section heading:
```tsx
          <h2 class="text-sm uppercase tracking-wide text-gray-600">
            Keep it simple
          </h2>
```
to:
```tsx
          <h2 class="text-sm uppercase tracking-wide text-muted">
            Keep it simple
          </h2>
```

And replace the footer (currently the `<footer>` block, lines 99-113) with:
```tsx
        {/* Footer */}
        <footer class="pt-8 border-t border-border text-sm text-muted flex flex-wrap gap-4 justify-between">
          <span>
            <a
              class="underline text-zune-magenta hover:text-magenta-600"
              href="https://github.com/sbesh91/hono-preact"
            >
              GitHub
            </a>{' '}
            ·{' '}
            <a
              class="underline text-zune-magenta hover:text-magenta-600"
              href="https://www.npmjs.com/package/hono-preact"
            >
              npm
            </a>
          </span>
          <span>MIT</span>
        </footer>
```

- [ ] **Step 3: Tokenize the `CodeBlock` and `Card` helpers**

Replace the `CodeBlock` component (currently lines 120-132) with:
```tsx
const CodeBlock: FunctionComponent<{
  filename: string;
  children: string;
}> = ({ filename, children }) => (
  <figure class="rounded-md border border-border bg-surface shadow-card overflow-hidden">
    <figcaption class="text-xs text-muted px-3 py-1 border-b border-border bg-surface-subtle">
      {filename}
    </figcaption>
    <pre class="text-xs p-3 overflow-x-auto">
      <code>{children}</code>
    </pre>
  </figure>
);
```

Replace the `Card` component (currently lines 134-142) with:
```tsx
const Card: FunctionComponent<{ title: string; children: any }> = ({
  title,
  children,
}) => (
  <article class="rounded-md border border-border bg-surface shadow-card p-4">
    <h3 class="font-semibold mb-1">{title}</h3>
    <p class="text-sm text-muted">{children}</p>
  </article>
);
```

- [ ] **Step 4: Run the home tests (regression guard)**

Run:
```bash
pnpm --filter site exec vitest run src/pages/__tests__/home.test.tsx
```
Expected: all 5 tests pass (text, both CTA hrefs, four cards, shader mount are unchanged). If the runner script differs, fall back to `pnpm test` filtered to the site; do not weaken an assertion to make it pass.

- [ ] **Step 5: Build to verify**

Run:
```bash
pnpm --filter site build
```
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/pages/home.tsx
git commit -m "feat(site): brand the home page (gradient hero, energy bar, magenta CTA)"
```

---

## Task 6: Brand the docs chrome

**Files:**
- Modify: `apps/site/src/components/DocsLayout.tsx`

All swaps below are mechanical: stock `blue` -> magenta accent, stock `slate` -> semantic tokens, so docs render coherently in dark mode.

- [ ] **Step 1: Section heading + active/inactive nav links**

In `apps/site/src/components/DocsLayout.tsx`:

Section heading (in `renderNav`): change `text-slate-400` to `text-muted` in:
```tsx
              <div class="text-[0.7rem] font-bold uppercase tracking-[0.08em] text-muted mb-1.5 px-3 whitespace-nowrap">
```

Nav link active/inactive classes: replace
```tsx
                  active
                    ? 'bg-blue-100 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
```
with
```tsx
                  active
                    ? 'bg-magenta-50 text-zune-magenta font-semibold'
                    : 'text-muted hover:text-foreground hover:bg-surface-subtle'
```

- [ ] **Step 2: Desktop sidebar panel, logo, and pin button**

Sidebar panel: change `bg-slate-50 border-r border-slate-200` to `bg-surface-subtle border-r border-border` in:
```tsx
          class="docs-sidebar absolute top-0 left-0 h-full bg-surface-subtle border-r border-border overflow-hidden flex flex-col z-20 shadow-sm"
```

Logo link: change `text-slate-900` to `text-foreground` and `hover:text-blue-700` to `hover:text-zune-magenta` in:
```tsx
            class={`flex whitespace-nowrap overflow-hidden text-ellipsis items-center h-12 shrink-0 font-bold text-[0.95rem] text-foreground no-underline hover:text-zune-magenta ${
```

Pin-button footer border: change `border-t border-slate-200` to `border-t border-border` in:
```tsx
          <div
            class={`shrink-0 border-t border-border py-2 ${expanded ? 'px-2' : 'px-1.5'}`}
          >
```

Pin button itself: change `text-slate-600 hover:text-slate-900 hover:bg-slate-200` to `text-muted hover:text-foreground hover:bg-surface-subtle` in:
```tsx
              class={`flex items-center gap-3 h-9 w-full rounded text-sm text-muted hover:text-foreground hover:bg-surface-subtle ${
```

- [ ] **Step 3: Mobile top bar + drawer**

Mobile top bar: change `bg-slate-50 border-b border-slate-200` to `bg-surface-subtle border-b border-border` in:
```tsx
      <div class="flex items-center gap-3 bg-surface-subtle border-b border-border py-2.5 px-3 sticky top-0 z-30 md:hidden col-span-full">
```

Menu button: change `bg-white border border-slate-200 ... text-slate-600 ... hover:bg-slate-100` to surface/border/muted in:
```tsx
        <button
          type="button"
          class="flex items-center gap-1 bg-surface border border-border rounded-md py-1 px-2.5 text-[0.8rem] font-semibold text-muted cursor-pointer shadow-sm shrink-0 hover:bg-surface-subtle"
          onClick={() => setMobileOpen(true)}
        >
```

Current-title span: change `text-slate-900` to `text-foreground` in:
```tsx
          <span class="text-[0.85rem] font-semibold text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
```

Mobile drawer aside: change `bg-slate-50 border-r border-slate-200` to `bg-surface-subtle border-r border-border` in:
```tsx
        class="fixed top-0 bottom-0 left-0 w-65 bg-surface-subtle border-r border-border z-50 flex flex-col md:hidden"
```

Drawer header: change `border-b border-slate-200 ... text-slate-900` to border/foreground in:
```tsx
        <div class="flex justify-between items-center px-4 py-3 border-b border-border font-bold text-[0.9rem] text-foreground">
```

Drawer close button: change `text-slate-500 ... hover:text-slate-900` to muted/foreground in:
```tsx
          <button
            type="button"
            class="bg-transparent border-none text-[1.1rem] text-muted cursor-pointer leading-none p-1 hover:text-foreground"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
```

- [ ] **Step 4: Prev/next footer links**

Bottom nav border: change `border-t border-slate-200` to `border-t border-border` in:
```tsx
        <nav class="flex justify-between mt-12 pt-6 border-t border-border text-sm">
```

Both prev and next links: change `text-blue-600 no-underline hover:underline` to `text-zune-magenta no-underline hover:underline` (two occurrences):
```tsx
                class="text-zune-magenta no-underline hover:underline"
```

- [ ] **Step 5: Build to verify**

Run:
```bash
pnpm --filter site build
```
Expected: build succeeds. Then confirm no stray stock `blue-`/`slate-` classes remain in the file:
```bash
grep -nE '(blue|slate)-[0-9]' apps/site/src/components/DocsLayout.tsx || echo "clean"
```
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/DocsLayout.tsx
git commit -m "feat(site): brand docs chrome (magenta active state, themed surfaces)"
```

---

## Task 7: Full pre-push verification

**Files:** none (verification only)

The project's pre-push contract (per `CLAUDE.md`) mirrors CI in order. Run all of it before claiming done.

- [ ] **Step 1: Build the framework dist (required before typecheck/site build)**

Run:
```bash
pnpm --filter '@hono-preact/*' --filter hono-preact build
```
Expected: all framework packages build.

- [ ] **Step 2: Format check (fix if needed)**

Run:
```bash
pnpm format:check
```
Expected: pass. If it fails, run `pnpm format`, then `git add -A && git commit -m "style: apply prettier"`.

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Unit tests with coverage**

Run:
```bash
pnpm test:coverage
```
Expected: pass (home tests included).

- [ ] **Step 5: Integration tests**

Run:
```bash
pnpm test:integration
```
Expected: pass.

- [ ] **Step 6: Site build**

Run:
```bash
pnpm --filter site build
```
Expected: pass.

- [ ] **Step 7: Manual dark/light check (human)**

Run `pnpm --filter site dev`, then load `/` and a `/docs/*` page. Toggle the OS appearance between light and dark and confirm: gradient hero heading + energy bar render; the magenta CTA/active-nav/links show; surfaces, borders, and secondary text flip coherently in dark; Selawik is the rendered face (or the Segoe-first fallback in fallback mode). Confirm reduced-motion still suppresses the view-transition animations.

- [ ] **Step 8: Final state**

All prior tasks have already been committed. Confirm a clean tree:
```bash
git status --short
```
Expected: empty. The branch `feat/zune-tailwind-theme` is ready for a PR (do not push or open the PR without explicit user approval).

---

## Self-review

- **Spec coverage:** Section 1 tokens -> Task 2; Section 2 utilities -> Task 3; Section 3 dark variant -> Task 2; Section 4 Selawik -> Task 1; Section 5 light application -> Tasks 4-6 (Layout, home, docs, MDX prose). All six spec success criteria map to a task; Task 7 covers criterion 6 (CI green).
- **Placeholder scan:** every code step shows full before/after; the one conditional (font fallback) gives concrete alternative CSS, not a TODO.
- **Type/name consistency:** token names are consistent across files (`--color-border` <- `--border-color`; utilities `bg-accent`, `bg-accent-hover`, `text-orangenta`, `energy-bar`, `bg-surface-subtle`, `text-zune-magenta`, `bg-magenta-50`/`text-magenta-600`). The semantic underlying var is `--border-color` (avoids clashing with the `border` utility) and is mapped to the `--color-border` token in exactly one place (Task 2).
