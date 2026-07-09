# Add a loader

**Use this when:** a page needs data fetched on the server before it renders.

## Mental model (read first)

- Data comes from a `defineLoader` in a colocated `*.server.ts` file, not from
  `getServerSideProps`, a route handler, or `fetch` in `useEffect`.
- A `.server.ts` file may export only `serverLoaders` and `serverActions` (plus erased
  `export type`s). The Vite plugin rewrites the client's import of `serverLoaders` into a
  client-safe data handle, so secrets and server-only helpers must stay inside the loader
  body, never at module top level where they would be inlined into the client bundle.
- The component reads the data with `<loader>.useData()` inside a `<loader>.View(...)`
  wrapper. There is no `useLoaderData` hook.

## Steps

1. Create or extend `src/pages/<name>.server.ts`:

   ```ts
   import { defineLoader } from 'hono-preact';

   export const serverLoaders = {
     default: defineLoader(async () => ({
       message: 'Hello from the server',
       renderedAt: new Date().toISOString(),
     })),
   };
   ```

   The loader function receives `{ c, location, signal }` (the Hono context, the route
   location, and an abort signal) and returns the data. Read request-scoped values off `c`.

2. There is nothing to wire in `src/routes.ts`. A `.server.ts` file named after the
   route's view file (`profile.tsx` pairs with `profile.server.ts`) is discovered and
   wired to the route automatically. The explicit `server:` field on a route node is
   an advanced override (a non-sibling module, or `server: false` to opt out).

3. Read the data in `src/pages/<name>.tsx`. Import `serverLoaders` from the sibling
   `.server.js` and render through `.View(render)`; the render function receives the
   `LoaderState` union. `data` reads straight off the union (it is absent only in the
   cold `loading` arm, so a truthy check doubles as the loading guard); reach for
   `status` when you need to tell `revalidating` or `error` apart. Descendants that
   need the same data inside the view can call `.useData()`:

   ```tsx
   import { definePage } from 'hono-preact';
   import { serverLoaders } from './profile.server.js';

   const ProfileView = serverLoaders.default.View(({ data }) =>
     data ? (
       <section>
         <p>{data.message}</p>
         <small>Rendered at {data.renderedAt}</small>
       </section>
     ) : (
       <p>Loading...</p>
     )
   );

   export default definePage(ProfileView);
   ```

## Verify

- Run `pnpm typecheck`. The shape from `useData()` is inferred from the loader's return;
  destructuring a field the loader does not return fails here.
- Run `pnpm dev`, open the page, and confirm the data renders.
- In devtools Network, confirm no server-only value (a secret, a DB handle) appears in the
  client payload.

## Common mistakes

- Misnaming the server file. Discovery pairs `profile.tsx` with `profile.server.ts`;
  a mismatched basename (`profileServer.ts`, `profile-data.server.ts`) is never
  discovered, the loader never runs, and the view renders its loading arm forever.
- Adding other named exports to `.server.ts`. Only `serverLoaders` and `serverActions` are
  allowed; anything else is a build error.
- Fetching in `useEffect` instead. Loaders run on the server, are typed, and are SSR'd;
  client fetches are none of those.
- Casting the loader data. Let inference flow from the loader's return; do not annotate or
  cast `useData()`.
- Top-level secrets. A secret imported at the top of `.server.ts` can be inlined into the
  client. Keep it inside the loader body.

## Reference

- Loaders in depth: see "Server Loaders" and "Loading States" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
