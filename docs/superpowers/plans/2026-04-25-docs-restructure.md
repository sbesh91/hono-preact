# Docs Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the framework docs to tell a clear story for first-time developers — a rewritten Overview, a new Quick Start tutorial, and reference pages reorganized into 6 grouped nav sections.

**Architecture:** All changes are to MDX content files and the `nav.ts` config file. No component code changes. MDX pages in `apps/app/src/pages/docs/` are auto-discovered via `import.meta.glob` in `iso.tsx` — creating a new `.mdx` file automatically creates the route. The `DocsLayout` component (sidebar + prev/next) reads from `nav.ts` and already handles the new structure.

**Tech Stack:** MDX, TypeScript (nav.ts only), pnpm dev server for verification

---

## File Map

| Action | File |
|--------|------|
| **Modify** | `apps/app/src/pages/docs/nav.ts` |
| **Delete** | `apps/app/src/pages/docs/hello.mdx` |
| **Rewrite** | `apps/app/src/pages/docs/index.mdx` |
| **Create** | `apps/app/src/pages/docs/quick-start.mdx` |
| **Prune** | `apps/app/src/pages/docs/loaders.mdx` |
| **Prune** | `apps/app/src/pages/docs/actions.mdx` |
| **Prune** | `apps/app/src/pages/docs/action-guards.mdx` |

---

## Task 1: Update nav.ts and delete hello.mdx

**Files:**
- Modify: `apps/app/src/pages/docs/nav.ts`
- Delete: `apps/app/src/pages/docs/hello.mdx`

- [ ] **Step 1: Replace nav.ts with 6-section structure**

Replace the entire contents of `apps/app/src/pages/docs/nav.ts`:

```ts
export type NavEntry = { title: string; route: string };
export type NavSection = { heading: string; entries: NavEntry[] };

export const nav: NavSection[] = [
  {
    heading: 'Introduction',
    entries: [
      { title: 'Overview', route: '/docs' },
      { title: 'Quick Start', route: '/docs/quick-start' },
    ],
  },
  {
    heading: 'Pages & Routing',
    entries: [
      { title: 'Adding Pages', route: '/docs/pages' },
    ],
  },
  {
    heading: 'Data',
    entries: [
      { title: 'Server Loaders', route: '/docs/loaders' },
      { title: 'Loading States', route: '/docs/loading-states' },
      { title: 'Reloading Data', route: '/docs/reloading' },
    ],
  },
  {
    heading: 'Mutations',
    entries: [
      { title: 'Server Actions', route: '/docs/actions' },
      { title: 'Action Guards', route: '/docs/action-guards' },
    ],
  },
  {
    heading: 'Access Control',
    entries: [
      { title: 'Route Guards', route: '/docs/guards' },
    ],
  },
  {
    heading: 'Infrastructure',
    entries: [
      { title: 'Vite Config', route: '/docs/vite-config' },
      { title: 'Project Structure', route: '/docs/structure' },
      { title: 'renderPage', route: '/docs/render-page' },
      { title: 'Build & Deploy', route: '/docs/deployment' },
    ],
  },
];
```

- [ ] **Step 2: Delete hello.mdx**

```bash
rm apps/app/src/pages/docs/hello.mdx
```

- [ ] **Step 3: Start dev server and verify sidebar**

```bash
pnpm dev
```

Open `http://localhost:5173/docs` in a browser. Verify:
- Sidebar shows 6 sections: Introduction, Pages & Routing, Data, Mutations, Access Control, Infrastructure
- "Quick Start" appears in Introduction (it will 404 for now — that's expected until Task 3)
- `/docs/hello` returns 404 (the route no longer exists)
- Prev/next footer on any existing page follows the new order

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/pages/docs/nav.ts apps/app/src/pages/docs/hello.mdx
git commit -m "docs: restructure nav into 6 sections, remove hello placeholder"
```

---

## Task 2: Rewrite index.mdx (Overview)

**Files:**
- Modify: `apps/app/src/pages/docs/index.mdx`

- [ ] **Step 1: Replace index.mdx with the new Overview content**

Replace the entire contents of `apps/app/src/pages/docs/index.mdx`:

````mdx
# hono-preact

Fullstack made easy.

Every route is a file pair: a `.tsx` page component and a `.server.ts` file that never reaches the browser. The framework handles SSR, data fetching, mutations, and access control — you write the logic.

```ts
// movies.server.ts — runs only on the server
const serverLoader: Loader<{ movies: Movie[] }> = async () => ({
  movies: await getMovies(),
});
export default serverLoader;

// movies.tsx — the page component
export default getLoaderData(Movies, { serverLoader });
```

On the first request, the server runs the loader directly and preloads the result into the HTML. On hydration, the client reads from that attribute — no fetch fires. On client-side navigation, the framework calls the loader over RPC. Same loader, three environments, zero config.

**[→ Quick Start](/docs/quick-start)** — build a page with data and a mutation in ~10 minutes

## The server/client boundary

Two Vite plugins enforce the boundary between server and client code. During the client bundle build, every `*.server.*` import is replaced with stubs: the default export becomes an RPC function, `serverGuards` and `actionGuards` become empty arrays, and `serverActions` becomes a Proxy. Database clients, secrets, and internal API URLs in `.server.*` files never reach the browser bundle.

`serverLoaderValidationPlugin` enforces the contract at build time: `.server.*` files may only export `serverGuards`, `serverActions`, or `actionGuards` as named exports. Any other named export fails the build.
````

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173/docs`. Verify:
- Page title is "hono-preact"
- Tagline "Fullstack made easy." appears below the title
- Code block shows the two-file example
- "→ Quick Start" link is present and clickable (will 404 until Task 3)
- "The server/client boundary" section appears below the CTA
- No stack table, no flat link list

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs/index.mdx
git commit -m "docs: rewrite overview — pattern-first with boundary explanation"
```

---

## Task 3: Create quick-start.mdx

**Files:**
- Create: `apps/app/src/pages/docs/quick-start.mdx`

- [ ] **Step 1: Create quick-start.mdx**

Create `apps/app/src/pages/docs/quick-start.mdx` with the following content:

````mdx
# Quick Start

Build a movies list with a server loader and a form action — the full file pair pattern in one example.

## Prerequisites

Clone the starter and install dependencies:

```bash
git clone <repo-url> my-app
cd my-app
pnpm install
pnpm dev
```

Open `http://localhost:5173`. The dev server runs both the Hono server and the Vite HMR client. `server.tsx` handles API routes and the catch-all SSR handler; `iso.tsx` defines all client-side routes. Both `/__loaders` and `/__actions` endpoints are already registered — any `.server.ts` file you add to `src/pages/` is automatically discovered.

## 1. Create a page

Create `src/pages/movies.tsx`:

```tsx
import type { FunctionComponent } from 'preact';
import { getLoaderData } from '@hono-preact/iso';

const Movies: FunctionComponent = () => {
  return (
    <main>
      <h1>Movies</h1>
    </main>
  );
};

Movies.displayName = 'Movies';

export default getLoaderData(Movies);
```

Register the route in `src/iso.tsx` alongside the other lazy imports:

```tsx
const Movies = lazy(() => import('./pages/movies.js'));
// inside <Router>:
<Route path="/movies" component={Movies} />
```

Open `http://localhost:5173/movies`. You should see "Movies".

> **`getLoaderData` is always required**, even for pages with no data. It wires the component into the loader/preload system so hydration works correctly.

## 2. Add a server loader

Create `src/pages/movies.server.ts`:

```ts
import { type Loader } from '@hono-preact/iso';

export type Movie = { id: string; title: string };

const store: Movie[] = [
  { id: '1', title: 'The Godfather' },
  { id: '2', title: 'Chinatown' },
];

export const getMovies = () => store;
export const addMovieToStore = (title: string) =>
  store.push({ id: String(store.length + 1), title });

const serverLoader: Loader<{ movies: Movie[] }> = async () => ({
  movies: getMovies(),
});

export default serverLoader;
```

Update `src/pages/movies.tsx` to use the loader data:

```tsx
import type { FunctionComponent } from 'preact';
import { getLoaderData, type LoaderData } from '@hono-preact/iso';
import serverLoader, { type Movie } from './movies.server.js';

const Movies: FunctionComponent<LoaderData<{ movies: Movie[] }>> = ({ loaderData }) => {
  return (
    <main>
      <h1>Movies</h1>
      <ul>
        {loaderData?.movies.map((m) => (
          <li key={m.id}>{m.title}</li>
        ))}
      </ul>
    </main>
  );
};

Movies.displayName = 'Movies';

export default getLoaderData(Movies, { serverLoader });
```

Reload `http://localhost:5173/movies`. The list renders server-side on first load — the data is preloaded into the HTML. On client-side navigation away and back, the framework calls the loader over RPC. Same function, no manual wiring.

## 3. Add a server action

Add `serverActions` to `src/pages/movies.server.ts`:

```ts
import { defineAction, type Loader } from '@hono-preact/iso';

export type Movie = { id: string; title: string };

const store: Movie[] = [
  { id: '1', title: 'The Godfather' },
  { id: '2', title: 'Chinatown' },
];

export const getMovies = () => store;
export const addMovieToStore = (title: string) =>
  store.push({ id: String(store.length + 1), title });

const serverLoader: Loader<{ movies: Movie[] }> = async () => ({
  movies: getMovies(),
});

export default serverLoader;

export const serverActions = {
  addMovie: defineAction<{ title: string }, { ok: boolean }>(
    async (_ctx, { title }) => {
      addMovieToStore(title);
      return { ok: true };
    }
  ),
};
```

Update `src/pages/movies.tsx` to add the form:

```tsx
import type { FunctionComponent } from 'preact';
import { Form, getLoaderData, type LoaderData } from '@hono-preact/iso';
import serverLoader, { serverActions, type Movie } from './movies.server.js';

const Movies: FunctionComponent<LoaderData<{ movies: Movie[] }>> = ({ loaderData }) => {
  return (
    <main>
      <h1>Movies</h1>
      <Form action={serverActions.addMovie} invalidate="auto">
        <input name="title" placeholder="Movie title" required />
        <button type="submit">Add</button>
      </Form>
      <ul>
        {loaderData?.movies.map((m) => (
          <li key={m.id}>{m.title}</li>
        ))}
      </ul>
    </main>
  );
};

Movies.displayName = 'Movies';

export default getLoaderData(Movies, { serverLoader });
```

Submit a title in the form. The action runs on the server, `invalidate="auto"` re-fetches the loader, and the list updates — no manual state management.

## What's next

- [Server Loaders](/docs/loaders) — caching, named caches, path params
- [Server Actions](/docs/actions) — `useAction`, optimistic updates, file uploads, streaming
- [Route Guards](/docs/guards) — protect pages with server and client guard chains
- [Loading States](/docs/loading-states) — show a fallback while the loader fetches
- [Build & Deploy](/docs/deployment) — production build and deployment
````

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173/docs/quick-start`. Verify:
- Page renders with the "Quick Start" heading
- Sidebar shows "Quick Start" active under Introduction
- Prev link: "Overview" (`/docs`)
- Next link: "Adding Pages" (`/docs/pages`)
- All 3 sections (Prerequisites, 1, 2, 3) render correctly with code blocks
- "What's next" links at the bottom are clickable

- [ ] **Step 3: Verify the Overview CTA now works**

Navigate to `http://localhost:5173/docs`. Click "→ Quick Start". Confirm it lands on the Quick Start page.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/pages/docs/quick-start.mdx
git commit -m "docs: add Quick Start tutorial — page, loader, action end-to-end"
```

---

## Task 4: Prune loaders.mdx

**Files:**
- Modify: `apps/app/src/pages/docs/loaders.mdx`

The "The server-only plugins" section (the long section starting with "Two custom Vite plugins..." near the bottom) is a full repeat of the boundary explanation now on the Overview. Replace it with a short summary and a link.

- [ ] **Step 1: Replace the server-only plugins section in loaders.mdx**

Find and replace the entire section starting from `## The server-only plugins` to the end of the file:

```mdx
## The server/client boundary

Two Vite plugins enforce that `.server.*` code never reaches the browser. `serverOnlyPlugin` replaces the default export with an RPC stub and named exports (`serverGuards`, `serverActions`, `actionGuards`) with empty arrays or Proxies. `serverLoaderValidationPlugin` fails the build if a `.server.*` file has any named export other than those three. See [Overview — The server/client boundary](/docs#the-serverclient-boundary) for the full explanation.
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173/docs/loaders`. Verify:
- The page still renders all sections up to and including "Named caches"
- The "The server/client boundary" section at the bottom is now 3 sentences + a link
- The long stub code examples (the `serverLoader = async ({ location }) => { const res = await fetch...` block) are gone

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs/loaders.mdx
git commit -m "docs: trim loaders boundary section — reference overview instead"
```

---

## Task 5: Prune actions.mdx

**Files:**
- Modify: `apps/app/src/pages/docs/actions.mdx`

The "The server-only boundary" section near the bottom (the section with the Proxy stub and `serverLoaderValidationPlugin` explanation) duplicates the Overview. Replace it with a short summary and a link.

- [ ] **Step 1: Replace the server-only boundary section in actions.mdx**

Find and replace the entire section starting from `## The server-only boundary` to the end of the file:

```mdx
## The server/client boundary

`serverOnlyPlugin` replaces `serverActions` imports in the client bundle with a Proxy — each property access returns an `ActionStub` with the module and action name. `actionGuards` imports become empty arrays. `serverLoaderValidationPlugin` enforces that `.server.*` files only export `serverGuards`, `serverActions`, or `actionGuards` as named exports. See [Overview — The server/client boundary](/docs#the-serverclient-boundary) for the full explanation.
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173/docs/actions`. Verify:
- All sections through "Action guards" render correctly
- The "The server/client boundary" section at the bottom is now 3 sentences + a link
- The long Proxy stub code example (`const serverActions = new Proxy({}, { get(_, action) {` block) is gone

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs/actions.mdx
git commit -m "docs: trim actions boundary section — reference overview instead"
```

---

## Task 6: Prune action-guards.mdx

**Files:**
- Modify: `apps/app/src/pages/docs/action-guards.mdx`

The "Composing guards" section repeats the composition pattern from `guards.mdx` nearly verbatim. Trim it to a short example + cross-reference.

- [ ] **Step 1: Replace the Composing guards section in action-guards.mdx**

Find and replace the entire `## Composing guards` section (from that heading to the next `##` heading or end of file):

```mdx
## Composing guards

Guards are plain functions — extract and reuse them across modules:

```ts
// src/server/guards.ts
export const requireAuth = defineActionGuard(async ({ c }, next) => {
  const user = await getCurrentUser(c as Context);
  if (!user) throw new ActionGuardError('Authentication required', 401);
  return next();
});
```

```ts
// src/pages/admin.server.ts
import { requireAuth } from '@/server/guards.js';

export const actionGuards = [requireAuth];
```

See [Route Guards — Composing guards](/docs/guards#composing-guards) for the full composition pattern — the same approach applies to action guards.
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:5173/docs/action-guards`. Verify:
- All sections through "Guard chains" render correctly
- The "Composing guards" section is now the short version (extract + import example, one cross-reference sentence)
- The long `requireRole` factory function example is gone from this page

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/pages/docs/action-guards.mdx
git commit -m "docs: trim action-guards composing section — cross-reference guards page"
```

---

## Task 7: Final end-to-end verification

No file changes — this task is a complete walkthrough to confirm everything works together.

- [ ] **Step 1: Verify sidebar structure on all pages**

Open each page and confirm the sidebar shows the correct 6 sections and the current page is highlighted:

| URL | Expected active section | Expected active entry |
|-----|------------------------|-----------------------|
| `/docs` | Introduction | Overview |
| `/docs/quick-start` | Introduction | Quick Start |
| `/docs/pages` | Pages & Routing | Adding Pages |
| `/docs/loaders` | Data | Server Loaders |
| `/docs/loading-states` | Data | Loading States |
| `/docs/reloading` | Data | Reloading Data |
| `/docs/actions` | Mutations | Server Actions |
| `/docs/action-guards` | Mutations | Action Guards |
| `/docs/guards` | Access Control | Route Guards |
| `/docs/vite-config` | Infrastructure | Vite Config |
| `/docs/structure` | Infrastructure | Project Structure |
| `/docs/render-page` | Infrastructure | renderPage |
| `/docs/deployment` | Infrastructure | Build & Deploy |

- [ ] **Step 2: Verify prev/next navigation order**

Navigate through the docs in order using the "next →" footer link, starting from Overview. The full sequence should be:

Overview → Quick Start → Adding Pages → Server Loaders → Loading States → Reloading Data → Server Actions → Action Guards → Route Guards → Vite Config → Project Structure → renderPage → Build & Deploy

Confirm no broken links and no pages that appear in the sidebar but are unreachable via prev/next.

- [ ] **Step 3: Verify no dead routes**

Confirm these routes return 404 (not found, not broken rendering):
- `/docs/hello` — deleted

- [ ] **Step 4: Commit**

```bash
git add -p  # stage any incidental fixes found during verification
git commit -m "docs: restructure complete — 6 nav sections, overview rewrite, quick start tutorial"
```
