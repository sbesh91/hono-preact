---
name: add-docs-page
description: Use when adding a new documentation page to the hono-preact docs site
type: process
---

# Adding a Docs Page

Three files must be updated when adding a new docs page. The route is auto-registered — no router changes needed.

## 1. Create the MDX file

Create `src/pages/docs/<slug>.mdx`. The route will be `/docs/<slug>` automatically via the glob in `src/iso.tsx`.

Follow the style of existing docs pages:
- Start with a back-link: `[← docs](/docs)`
- Use `#` for the page title, `##` for sections
- Lead with a one-paragraph explanation of what the feature does and why it exists
- Show code examples for the common case before edge cases
- Keep examples realistic — use the project's actual import aliases (`@/iso/...`, `@/server/...`)

## 2. Add to the index

Add a bullet to `src/pages/docs/index.mdx` under the appropriate section:

```md
- [Page Title](/docs/<slug>) — one-line description
```

## 3. Add to the sidebar nav

Add an entry to `src/pages/docs/nav.ts` in the appropriate `NavSection`:

```ts
{ title: 'Page Title', route: '/docs/<slug>' },
```

The `nav` array has two sections: `Getting Started` and `Guides`. New feature docs belong in `Guides`. Place the entry in reading order (foundational concepts before advanced ones).

## Checklist

- [ ] `src/pages/docs/<slug>.mdx` created
- [ ] Link added to `src/pages/docs/index.mdx`
- [ ] Entry added to `src/pages/docs/nav.ts`
- [ ] Dev server shows the page at `/docs/<slug>`
- [ ] Page appears in the sidebar
