# Docs Restructure Design — 2026-04-25

## Goal

Restructure the framework docs to tell a clear story for first-time developers. The current docs are a flat list of reference pages with no narrative arc, no mental model intro, and no guided entry point. The new structure leads with the pattern, provides a short tutorial, and organizes reference material by concern.

## Primary audience

First-time developers picking up this framework. Every structural decision optimizes for someone who has never seen the codebase before.

## Core identity

The framework's identity is the **file pair pattern** — a `.tsx` page and a `.server.ts` file that never touches the browser. The deploy target (Cloudflare Workers) is infrastructure detail, not the headline. The framework's value is: one file pair gives you SSR, RPC data fetching, typed mutations, and access control with zero manual wiring.

---

## Structure

### Nav sections (6)

```
Introduction
  Overview               ← rewritten
  Quick Start            ← new

Pages & Routing
  Adding Pages

Data
  Server Loaders
  Loading States
  Reloading Data

Mutations
  Server Actions
  Action Guards

Access Control
  Route Guards

Infrastructure
  Vite Config
  Project Structure
  renderPage
  Build & Deploy
```

`nav.ts` is updated to reflect all 6 sections and 13 entries. The `prev/next` footer navigation follows this order.

---

## New and changed pages

### Overview (`index.mdx`) — rewritten

**Current state:** Stack table + flat link list. Cloudflare Workers is the headline. No mental model, no "start here" signal.

**New content:**
- Tagline: "Fullstack made easy"
- 2–3 sentences explaining the file pair pattern and what the framework handles automatically
- A 4-line code example showing `movies.server.ts` (serverLoader) + `movies.tsx` (getLoaderData) — the simplest possible demonstration of the pattern
- One sentence on SSR → hydration → client navigation: same loader, three environments, zero config
- A prominent "→ Quick Start" CTA with a one-line description
- The server-only boundary explanation: 1 paragraph explaining the Vite plugins (canonical location — all other pages reference this instead of repeating it)

**Removed from current index:**
- Stack table (Hono / Preact / Vite / Tailwind / Cloudflare Workers) — dropped entirely; the stack is derivable from the codebase and ties the identity to the current deploy target
- Flat doc link list (replaced by sidebar)

### Quick Start (`quick-start.mdx`) — new page

A tutorial that builds a movies list app end-to-end. Covers the full loop: load → render → mutate.

**Sections:**
1. **Prerequisites** — clone the starter, `pnpm install && pnpm dev`, brief note on what's pre-wired
2. **Create your first page** — `movies.tsx` with `getLoaderData`, register `<Route>` in `iso.tsx`; static page working
3. **Add a server loader** — `movies.server.ts` with `serverLoader`, return a movies array, render the list; one paragraph on SSR → hydration → client-nav
4. **Add a server action** — `serverActions` with `addMovie` + `defineAction`, `<Form>` on the page, `invalidate="auto"` so the list refreshes on submit
5. **What's next** — links to: Server Loaders (deep dive), Server Actions (deep dive), Route Guards, Loading States, Build & Deploy

**Intentionally excluded:** caching, loading states/skeletons, reloading, action guards, route guards, streaming, file uploads. Those are reference material.

---

## Deleted pages

- `hello.mdx` — placeholder page, removed entirely

---

## Pruned content (existing pages)

### `loaders.mdx` and `actions.mdx` — server-only plugins section

Both pages currently contain a full explanation of `serverOnlyPlugin` and `serverLoaderValidationPlugin`. This is the same content in two places.

**Change:** Trim both pages to a short summary paragraph (2–3 sentences) with a link to the Overview's canonical boundary explanation. The detailed stub code examples are removed from both pages.

### `action-guards.mdx` — composing guards section

Currently duplicates the composing guards pattern from `guards.mdx` nearly verbatim.

**Change:** Trim `action-guards.mdx`'s composing section to 1–2 sentences and add "See [Route Guards](/docs/guards#composing-guards) for the composition pattern — the same approach applies here."

---

## Moved pages (nav reordering only, no content changes)

| Page | From | To |
|------|------|----|
| `render-page.mdx` | Guides | Infrastructure |
| `action-guards.mdx` | after Route Guards | Mutations (after Server Actions) |
| `structure.mdx` | Getting Started | Infrastructure |
| `vite-config.mdx` | Getting Started | Infrastructure |
| `loading-states.mdx` | Guides (ungrouped) | Data (after Server Loaders) |
| `reloading.mdx` | Guides (ungrouped) | Data (after Loading States) |

---

## What does not change

- The content of individual reference pages (except the pruning described above)
- The `DocsLayout` component — sidebar and prev/next nav already work
- MDX rendering pipeline
- Any page's URL — no redirects needed (nav reordering doesn't change routes)

---

## Success criteria

- A developer who has never seen this framework can open the docs, read the Overview, work through the Quick Start, and have a page with data and a working mutation running locally — without reading anything else
- The sidebar communicates the shape of the framework at a glance: Introduction → Pages → Data → Mutations → Access Control → Infrastructure
- No concept is explained in full in more than one place
