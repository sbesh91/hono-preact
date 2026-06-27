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

2. Wire the server module onto the route in `src/routes.ts` by adding `server:` beside
   `view:`:

   ```ts
   {
     path: '/profile',
     view: () => import('./pages/profile.js'),
     server: () => import('./pages/profile.server.js'),
   },
   ```

3. Read the data in `src/pages/<name>.tsx`. Import `serverLoaders` from the sibling
   `.server.js`, call `.useData()` in the component (it returns a `LoaderState` union),
   and wrap it with `.View(...)`; branch on the loader's `status`:

   ```tsx
   import { definePage } from 'hono-preact';
   import type { FunctionComponent } from 'preact';
   import { serverLoaders } from './profile.server.js';

   const loader = serverLoaders.default;

   const ProfilePage: FunctionComponent = () => {
     const s = loader.useData();
     if (s.status === 'loading') return <p>Loading...</p>;
     const { message, renderedAt } = s.data;
     return (
       <section>
         <p>{message}</p>
         <small>Rendered at {renderedAt}</small>
       </section>
     );
   };
   ProfilePage.displayName = 'ProfilePage';

   const ProfileView = loader.View((s) =>
     s.status === 'loading' ? <p>Loading...</p> : <ProfilePage />
   );

   export default definePage(ProfileView, {});
   ```

## Verify

- Run `pnpm typecheck`. The shape from `useData()` is inferred from the loader's return;
  destructuring a field the loader does not return fails here.
- Run `pnpm dev`, open the page, and confirm the data renders.
- In devtools Network, confirm no server-only value (a secret, a DB handle) appears in the
  client payload.

## Common mistakes

- Forgetting the `server:` import in `routes.ts`. The loader never runs and `useData()`
  has no data.
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
