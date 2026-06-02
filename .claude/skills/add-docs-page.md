---
name: add-docs-page
description: Use when adding a new documentation page to the hono-preact docs site
type: process
---

# Adding a Docs Page

Two files must be updated when adding a new docs page. The route is auto-registered — no router changes needed.

## 1. Create the MDX file

- **Guide page:** `apps/site/src/pages/docs/<slug>.mdx` → route `/docs/<slug>`.
- **Component / Components-area page:** `apps/site/src/pages/docs/components/<slug>.mdx` → route `/docs/components/<slug>`.

The glob in `apps/site/src/components/DocsRoute.tsx` is recursive (`../pages/docs/**/*.mdx`), and `docsSlug` derives the route from the path (a nested `index.mdx` serves the directory root, e.g. `components/index.mdx` → `/docs/components`).

Follow the style of existing docs pages:
- Use `#` for the page title, `##` for sections
- Lead with a one-paragraph explanation of what the feature does and why it exists
- Show code examples for the common case before edge cases
- Keep examples realistic — use the project's actual import paths (`@hono-preact/iso`, `@hono-preact/server`)
- Do NOT include a `[← docs](/docs)` back-link — navigation is handled by the sidebar

## 2. Add to nav.ts

`apps/site/src/pages/docs/nav.ts` exports `nav: NavArea[]`. Each area has `sections`, each section has a `heading`, an `icon` (a `lucide-preact` component — **icons live on sections, not entries**), and `entries: { title, route }[]`.

Add an entry `{ title: 'Page Title', route: '/docs/<slug>' }` to the right section, in reading order (foundational before advanced).

**Guide area sections:**

| Section | Content |
|---|---|
| Introduction | Overview, Quick Start |
| Pages & Routing | Page creation, routing conventions |
| Data | Loaders, loading states, reloading, prefetching, streaming |
| Mutations | Actions, optimistic UI |
| View Transitions | View Transitions |
| Access Control | Middleware, CSRF |
| Infrastructure | Vite config, structure, Hono middleware, WebSockets, renderPage, link prefetch, deployment |

**Components area sections** (under `basePath` `/docs/components`): `Getting started`, then add `Overlays` (Dialog, Popover, Tooltip), `Collections` (Menu, Select, Combobox), and `Foundations` (LayerHost, FocusScope, collection/nav machinery) as those pages are created. When adding the first page of a not-yet-present section, create the section with an appropriate `lucide-preact` icon.

## Checklist

- [ ] MDX file created in the correct directory (`docs/` for guide, `docs/components/` for components)
- [ ] Entry added to the correct area/section in `apps/site/src/pages/docs/nav.ts`
- [ ] `pnpm test docs/__tests__` passes (route ↔ nav parity)
