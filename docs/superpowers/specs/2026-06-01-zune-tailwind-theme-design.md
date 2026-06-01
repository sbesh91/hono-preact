# Zune-inspired Tailwind theme for `apps/site` (design spec)

**Status:** Design spec (ready for implementation plan)
**Date:** 2026-06-01
**Author:** Steven Beshensky (with Claude)
**Source material:** Zune Brand Guidelines 2008, V3.0 (`~/Downloads/zune-brand-guidelines.pdf`)

---

## 1. Goal and scope

Give `apps/site` a brand theme derived from the Zune 2008 guidelines, expressed as Tailwind v4 tokens plus a small set of signature utilities, and apply it lightly across the existing surfaces. The site already runs Tailwind v4 via `@tailwindcss/postcss` with `@import 'tailwindcss'` in `src/styles/root.css` and no `@theme` block (stock defaults). Components currently use stock `blue-*` / `gray-*` / `slate-*`.

Success criteria:

1. A brand palette and semantic token layer exist in `root.css`, usable as Tailwind utilities (`bg-zune-magenta`, `text-foreground`, `bg-surface`, etc.).
2. The signature "orangenta" gradient is available as reusable utilities (`bg-orangenta`, `text-orangenta`, `energy-bar`, `bg-zune-cloud`) driven by one gradient variable.
3. A **dark variant** flips the semantic tokens via `prefers-color-scheme`, and the shared neutral surfaces render coherently in both modes.
4. The brand font (**Selawik**, Microsoft's open, Segoe-metric-compatible face) is bundled and wired as `--font-sans`, with a documented system-stack fallback if acquisition is blocked.
5. The obvious brand surfaces (home hero, primary CTA, docs active state, MDX prose links) are wired to the new tokens without a full redesign.
6. Existing tests stay green and the full pre-push CI sequence passes.

**In scope:** the token layer, signature utilities, dark variant, Selawik bundling, and the light application listed in Section 7.

**Out of scope (deferred, see Section 10):** a manual light/dark toggle UI, a redesign of the demo app pages, changing the `HeroShader` WebGL palette, and redefining Tailwind's built-in `gray`/`slate` scales.

---

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Tailwind theming | v4 CSS-first: static `@theme` for brand palette + fonts; `@theme inline` for semantic tokens |
| Dark mode | OS-driven via `@media (prefers-color-scheme: dark)` flipping `:root` vars; no toggle UI |
| Functional accent | Zune Magenta `#ec008c` for links / CTAs / active states (replaces stock blue on touched surfaces) |
| Signature gradient | Orange to magenta "orangenta", used sparingly as a flourish; never the primary field (guideline rule) |
| Orange usage | Gradient-only; no standalone orange utility surfaced for fills (guideline: "orange is to be avoided") |
| Neutrals | Brand cool-grey ramp + Pantone 426C ink for `zune-*`; stock `gray`/`slate` left intact |
| Font | Bundle Selawik (OFL 1.1) self-hosted woff2; `'Selawik','Segoe UI',system-ui,sans-serif` |
| Font fallback | If TTF fetch / woff2 conversion is blocked, ship the Segoe-first system stack and leave the woff2 drop-in for later |
| Application depth | Tokens + light application; dark mode raises the floor so shared neutrals move to semantic tokens |

---

## 3. Palette

All values are sRGB approximations of the guideline's Pantone specs.

### 3.1 Brand (static `@theme`)

| Token | Hex | Source |
|---|---|---|
| `--color-zune-magenta` | `#ec008c` | Pantone Process Magenta C |
| `--color-zune-orange` | `#fe5000` | Pantone Orange 021 C (gradient-only) |
| `--color-zune-grey` | `#888b8d` | Cool Gray 8C (the wordmark grey) |
| `--color-zune-ink` | `#25282a` | Pantone 426C |

Magenta ramp for hover / active steps:

```
--color-magenta-50:  #fdeaf4;
--color-magenta-100: #fbcfe6;
--color-magenta-200: #f7a3cf;
--color-magenta-300: #f06fb3;
--color-magenta-400: #f23a9b;
--color-magenta-500: #ec008c;  /* brand */
--color-magenta-600: #c40076;
--color-magenta-700: #9b005d;
--color-magenta-800: #7a0049;
--color-magenta-900: #5c0037;
```

### 3.2 Semantic tokens (light to dark)

Defined as plain vars in `:root`, flipped in the dark media query, exposed to Tailwind via `@theme inline` (`--color-background: var(--background)`, etc.).

| Semantic | Light | Dark |
|---|---|---|
| `background` | `#ffffff` | `#1b1d1e` |
| `foreground` | `#25282a` | `#e9eae8` |
| `muted` (2nd-ary text) | `#63666a` (Cool Gray 10C) | `#bbbcbc` (Cool Gray 4C) |
| `surface` | `#ffffff` | `#25282a` (426C) |
| `surface-subtle` | `#f4f4f2` | `#2f3234` |
| `border` | `rgba(37,40,42,.10)` | `rgba(255,255,255,.12)` |
| `accent` | `#ec008c` | `#ec008c` |
| `accent-foreground` | `#ffffff` | `#ffffff` |
| `accent-hover` | `#c40076` | `#ff4db0` |
| `ring` | `#ec008c` | `#ec008c` |

White-dominant in light (on-brand); Pantone 426C-led surfaces in dark.

---

## 4. Signature utilities

One gradient variable, four utilities (all honoring the guideline's left-to-right / bottom-to-top orange to magenta reading):

```css
:root {
  --gradient-orangenta: linear-gradient(90deg, #fe5000 0%, #ec008c 100%);
}

@utility bg-orangenta { background-image: var(--gradient-orangenta); }

@utility text-orangenta {
  background-image: var(--gradient-orangenta);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

@utility energy-bar {           /* the thin gradient rule atop every guideline page */
  display: block;
  height: 0.25rem;
  border-radius: 9999px;
  background-image: var(--gradient-orangenta);
}

@utility bg-zune-cloud {        /* soft "energy cloud", with the sanctioned purple hint */
  background-image:
    radial-gradient(60% 60% at 30% 20%, rgba(254,80,0,.18), transparent 70%),
    radial-gradient(60% 60% at 75% 60%, rgba(236,0,140,.18), transparent 70%),
    radial-gradient(50% 50% at 60% 90%, rgba(201,125,255,.16), transparent 70%);
}
```

---

## 5. Font: bundle Selawik (OFL 1.1)

- Self-host Selawik **Light / Regular / Semibold / Bold** as woff2 under `apps/site/src/styles/fonts/`.
- `@font-face` per weight with `font-display: swap`; map to `font-weight` 300 / 400 / 600 / 700.
- `--font-sans: 'Selawik', 'Segoe UI', system-ui, -apple-system, sans-serif;` in `@theme`.
- Applied globally by putting `font-sans` on `<body>` (Section 7).

**Acquisition path:** fetch Selawik TTFs from `github.com/microsoft/Selawik`, convert to woff2 with the `wawoff2` wasm encoder (no native build), commit the woff2 files. Verified absent locally: no `fonttools`, no `woff2_compress`, no brotli, no Fontsource/npm package, so conversion tooling is part of the work.

**Fallback (if network / conversion is blocked):** drop the `@font-face` block and ship `--font-sans: 'Segoe UI', system-ui, -apple-system, sans-serif`. Real Segoe UI renders on Windows; a clean humanist sans elsewhere. Leave a note so the woff2 can be added later without touching consumers.

License: Selawik is SIL OFL 1.1; include its license text alongside the font files.

---

## 6. `root.css` structure (after change)

```
@import 'tailwindcss';

/* @font-face: Selawik x4 (or omitted in fallback mode) */

@theme { /* brand palette (static) + --font-sans */ }
@theme inline { /* semantic --color-* -> var(--*) */ }

:root { /* semantic var values (light) + --gradient-orangenta + existing --spring-* */ }
@media (prefers-color-scheme: dark) { :root { /* semantic var values (dark) */ } }

@utility shadow-card { ... }          /* existing */
@utility bg-orangenta / text-orangenta / energy-bar / bg-zune-cloud { ... }

/* MDX prose: hardcoded slate hexes -> semantic vars (Section 7) */
/* existing view-transition / motion CSS unchanged */
```

---

## 7. Light application (files touched)

Dark mode requires the shared neutrals to be semantic, so a few mechanical slate -> token swaps come along; structure is otherwise unchanged.

- **`src/Layout.tsx`** — `body class="bg-gray-300 isolate"` -> `bg-background text-foreground font-sans antialiased isolate`.
- **`src/pages/home.tsx`**
  - Hero `<h1>` -> add `text-orangenta` (cover-page signature); keep `font-semibold`.
  - Add a small centered `energy-bar` flourish above/under the hero heading (e.g. `w-16 mx-auto`).
  - "Get started" CTA: `bg-blue-600 text-white` -> `bg-accent text-accent-foreground hover:bg-magenta-600`.
  - Secondary CTA + cards + code blocks: `bg-white` -> `bg-surface`, `border-black/5` -> `border-border`, `text-gray-700/600` -> `text-muted`.
  - Footer links: `underline` -> `text-zune-magenta hover:text-magenta-600`.
- **`src/components/DocsLayout.tsx`**
  - Active nav `bg-blue-100 text-blue-700` -> `bg-magenta-50 text-zune-magenta`.
  - Logo hover `hover:text-blue-700` -> `hover:text-zune-magenta`; prev/next `text-blue-600` -> `text-zune-magenta`.
  - Sidebar / mobile chrome: `bg-slate-50` -> `bg-surface-subtle`, `border-slate-200` -> `border-border`, `text-slate-600/900/400` -> `text-muted` / `text-foreground` / `text-muted`, hover `bg-slate-200` -> `bg-surface-subtle` (kept legible in dark).
- **`src/styles/root.css` (MDX prose)** — link `#2563eb`/`#1d4ed8` -> `var(--accent)` / `var(--accent-hover)`; code bg `#f1f5f9` -> `var(--surface-subtle)`; borders `#cbd5e1`/`#e2e8f0` -> `var(--border)`; blockquote/secondary text `#475569`/`#94a3b8` -> `var(--muted)`; table header bg `#f8fafc` -> `var(--surface-subtle)`.

The demo app pages (`src/pages/demo/*`) are out of scope for this pass.

---

## 8. Testing and verification

- Keep `src/pages/__tests__/home.test.tsx` and `src/components/__tests__/HeroShader.test.tsx` green; if either asserts on a stock class string (e.g. `bg-blue-600`), update the assertion to the new class rather than reverting the style.
- Add no new test framework; this is a styling change. If a small render assertion is warranted (e.g. hero renders the `energy-bar` element), add it to the existing home test.
- Run the full pre-push CI sequence before claiming done: framework build, `format:check`, `typecheck`, `test:coverage`, `test:integration`, `pnpm --filter site build`.
- Manual check: load home + a docs page in light and dark OS modes; confirm the gradient flourishes, magenta accents, surfaces, and Selawik all render, and that reduced-motion is unaffected.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Selawik TTF fetch or woff2 conversion blocked by sandbox | Validate first; fall back to the Segoe-first system stack (Section 5) |
| Dark mode reveals an un-tokenized surface | Section 7 sweeps the shared neutrals; manual dark-mode pass in Section 8 |
| Class swaps break a test assertion | Section 8: update assertions to the new classes |
| Gradient text illegible at small sizes | Reserve `text-orangenta` for the large hero heading only |

---

## 10. Out of scope / future

- Manual light/dark toggle (would add `@custom-variant dark` + a control and persistence).
- Restyling the demo app (`/demo/*`) to the brand.
- Aligning the `HeroShader` WebGL palette to the canonical orangenta stops.
- Redefining Tailwind's built-in `gray` / `slate` scales to the cool-grey ramp.
