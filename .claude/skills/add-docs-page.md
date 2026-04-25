---
name: add-docs-page
description: Use when adding a new documentation page to the hono-preact docs site
type: process
---

# Adding a Docs Page

Two files must be updated when adding a new docs page. The route is auto-registered — no router changes needed.

## 1. Create the MDX file

Create `apps/app/src/pages/docs/<slug>.mdx`. The route will be `/docs/<slug>` automatically via the glob in `apps/app/src/iso.tsx`.

Follow the style of existing docs pages:
- Use `#` for the page title, `##` for sections
- Lead with a one-paragraph explanation of what the feature does and why it exists
- Show code examples for the common case before edge cases
- Keep examples realistic — use the project's actual import paths (`@hono-preact/iso`, `@hono-preact/server`)
- Do NOT include a `[← docs](/docs)` back-link — navigation is handled by the sidebar

## 2. Add to nav.ts

Add an entry to `apps/app/src/pages/docs/nav.ts` in the correct `NavSection`:

```ts
{ title: 'Page Title', route: '/docs/<slug>' },
```

The nav has 6 sections — place the entry in the right one:

| Section | Content |
|---|---|
| Introduction | Overview, Quick Start only |
| Pages & Routing | Page creation, routing conventions |
| Data | Loaders, loading states, reloading |
| Mutations | Actions, action guards |
| Access Control | Route guards |
| Infrastructure | Vite config, project structure, renderPage, deployment |

Place the entry in reading order within the section (foundational before advanced).

## Checklist

- [ ] `apps/app/src/pages/docs/<slug>.mdx` created
- [ ] Entry added to `apps/app/src/pages/docs/nav.ts` in the correct section
