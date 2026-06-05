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

**Components area sections** (under `basePath` `/docs/components`): `Getting started`, `Overlays` (Dialog; Popover and Tooltip as they ship), `Foundations` (the shared primitives: useRender, useControllableState, mergeRefs; LayerHost and FocusScope as they ship), then add `Collections` (Menu, Select, Combobox) as those pages are created. When adding the first page of a not-yet-present section, create the section with an appropriate `lucide-preact` icon.

## Page templates

Every docs page rests on three pillars: **prose**, **examples**, **API reference**. The `docs-template-check` hook (PostToolUse on Edit|Write) infers the page's template from its path and soft-warns on stderr if a required pillar is missing. It never blocks. Match one of the two templates below.

| Pillar | What it is | How the hook recognizes it |
|---|---|---|
| Prose | What the page documents and why it exists | An `# Title` h1 followed by a lead paragraph before the first `##` |
| Examples | Realistic code, common case first | At least one fenced code block, or an `<Example>` live demo |
| API reference | The configurable surface | A `## API reference`, `## Signature`, or `## Options`/`## Parameters` heading plus a GFM table |

`index.mdx` pages (area overviews) are exempt from the hook.

### Guide template (`docs/*.mdx`)

```
# Title
<lead paragraph: what this does and why it exists>

## How it works            (or the first concept section)
  …prose interleaved with code examples…

## Options / <reference>   (a GFM table of the API the page documents)

<cross-links to related docs pages>
```

- **Required:** Prose, Examples.
- **Recommended:** a reference/options table where the page documents configurable API; cross-links to related pages.

Reference implementations: `loaders.mdx`, `actions.mdx`.

### Component / Reference template (`docs/components/*.mdx`)

This area holds two shapes; the hook's required set is their common core (Prose + Examples + API reference). Component pages additionally get optional nudges for `## Demo`, `## Styling`, `## Accessibility`; hook/primitive pages (no live demo) do not.

**Component variant** (reference implementations: `dialog.mdx`, `popover.mdx`, `tooltip.mdx`):

```
# Name
<lead: what it is, why it exists, "ships unstyled" if applicable>

## Demo          (<Example> wrapping a live demo)
## Usage         (common-case code)
## Styling       (CSS + Tailwind via <CodeTabs>)
## API reference (markdown prop tables, one per part)
## Accessibility
```

**Hook / primitive variant** (reference implementations: `use-render.mdx`, `merge-refs.mdx`, `use-dismiss.mdx`):

```
# name
<lead paragraph>

## Signature                   (optional; some pages go straight to Options)
### Options / ### Parameters   (a markdown table), or a top-level ## Options
## Example
```

- **Required (both variants):** Prose, Examples, API reference (any of `## API reference`, `## Signature`, `## Options`, `## Parameters`, plus a table).
- **Recommended (component variant):** `## Demo` with `<Example>`, `## Styling`, `## Accessibility`.

### Shared UI

Use the existing docs components rather than rolling new markup:

- `<Example>` (from `components/docs/Example.js`) frames a live demo.
- `<CodeTabs labels={[...]}>` (from `components/docs/CodeTabs.js`) for multi-flavor code (e.g. CSS + Tailwind).
- API reference tables are plain GFM markdown tables (styled by `.mdx-content`).

## Checklist

- [ ] MDX file created in the correct directory (`docs/` for guide, `docs/components/` for components)
- [ ] Entry added to the correct area/section in `apps/site/src/pages/docs/nav.ts`
- [ ] Page matches its template's required sections (the `docs-template-check` hook warns on stderr if not)
- [ ] `pnpm test docs/__tests__` passes (route ↔ nav parity)
