# Using hono-preact

This project uses **hono-preact**: a small full-stack framework. Hono runs on the
server (Cloudflare Workers or Node), Preact renders in the browser, routes are
declared in code, and loaders, actions, and guards are typed end to end.

Read this before generating code. The framework's shape differs from Next.js,
Remix, and plain React in ways that trip up assumptions.

## How this framework differs from what you may assume

| You might assume | Here it actually is |
| --- | --- |
| Routes come from a `pages/` or `app/` folder | Routes are declared in code in `src/routes.ts` with `defineRoutes(...)` (or `contentRoutes(...)` for content globs). There is no file-system routing. |
| This is React | This is **Preact**. Import hooks from `preact/hooks`, not `react`. JSX renders through Preact. |
| Server code can live in the page component | Loaders, actions, and guards live in a colocated `*.server.ts` file (e.g. `home.server.ts` next to `home.tsx`). Server code never ships to the client. |
| Data is fetched with `getServerSideProps`, route handlers, or `fetch` in `useEffect` | Data comes from `defineLoader` in a `.server.ts`; the page reads it through the loader (typed). |
| Mutations are ad-hoc POST handlers | Mutations are `defineAction`s; forms submit through them and results come back in a uniform `__outcome` envelope (`useActionResult`, `useFormStatus`). |
| You cast to get types | The route table is typed end to end: `useParams()` is typed per route and loader data is typed from the loader. Do not cast; let inference work. |
| Auth checks are sprinkled per handler | Page guards are a single `use: [...]` array on a route node; they gate render and the loader/action RPC together and inherit down the tree. |

## Where things go

A page is up to four files:

- `src/pages/home.tsx` - the Preact view (default export).
- `src/pages/home.server.ts` - loaders/actions for that page. Optional. Use
  `export const serverLoaders = { default: defineLoader(fn) }` and
  `export const serverActions = { ... }`. Realtime modules add
  `export const serverRooms = { ... }` (`defineRoom`) and
  `export const serverSockets = { ... }` (`defineSocket`). No default export;
  `serverLoaders`, `serverActions`, `serverRooms`, and `serverSockets` are the
  only allowed named exports (plus erased `export type`s). Client code imports
  those containers and reads data
  through them; the Vite plugin rewrites those imports into client-safe RPC
  handles. Never put secrets or server-only helpers where they would be inlined
  into the client; keep that logic inside the loader and action bodies.
- `src/routes.ts` - declares every URL and which view (and optional `.server`
  module) lives there.
- `src/Layout.tsx` - the HTML document shell. It must render `<ClientScript />`
  (hydration) and a `<Head />` (both from `hono-preact`).

## Public entry points

Import from these subpaths of the `hono-preact` package:

- `hono-preact` - routing, loaders, actions, hooks, and components
  (`defineRoutes`, `defineLoader`, `defineAction`, `useParams`, `Head`,
  `ClientScript`, `Form`, `useActionResult`, ...).
- `hono-preact/page` - page-level outcome helpers (`redirect`, `deny`, `render`).
- `hono-preact/server` - the page render entry point and Hono context access
  (`renderPage`, `useHonoContext`, `HonoContext`). The request handlers are
  internal; the generated server entry wires them for you.
- `hono-preact/vite` - the `honoPreact()` Vite plugin. It requires an `adapter`:
  `honoPreact({ adapter: cloudflareAdapter() })`.
- `hono-preact/adapter-cloudflare` - `cloudflareAdapter()` for Cloudflare Workers.
- `hono-preact/adapter-node` - `nodeAdapter()` for Node.

The UI component library is a separate package, `hono-preact-ui` (Dialog,
Popover, Tooltip, Menu, Select, Combobox, plus headless hooks). It ships unstyled.

## Recipes

Step-by-step procedures for the most common tasks. Open the file and follow it top to
bottom; each one ends with a command to verify your work.

- Add a page (a new URL): `agents/skills/add-a-page.md`
- Add a loader (server data for a page): `agents/skills/add-a-loader.md`
- Add an action and form (a mutation): `agents/skills/add-an-action.md`
- Add a guard (restrict a route): `agents/skills/add-a-guard.md`

## Docs

- Full docs (online): https://framework.sbesh.com/docs
- Full documentation corpus, bundled offline in this project: `agents/llms-full.txt`
