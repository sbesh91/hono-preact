# Add a guard

**Use this when:** a route (and its data and actions) must be restricted, for example to a
signed-in user.

## Mental model (read first)

- A guard is a `use: [...]` array on a route node in `src/routes.ts`. It gates the page
  render and the loader/action RPC together, and it inherits down the tree: put it on a
  parent node and every descendant is protected.
- A guard is built from `defineServerMiddleware` and/or `defineClientMiddleware`. The
  server guard is authoritative; the client guard is a UX shortcut (it can redirect before
  a flash, but never trust it for security).
- A guard allows the request by calling `await next()` and blocks it by throwing
  `redirect(...)` or `deny(...)`.

## Steps

1. Write the guard (for example `src/guards.ts`):

   ```ts
   import {
     defineServerMiddleware,
     defineClientMiddleware,
     redirect,
   } from 'hono-preact';

   const requireUserServer = defineServerMiddleware(async (ctx, next) => {
     const user = await getUser(ctx.c); // your server-side session lookup
     if (!user) throw redirect('/login');
     await next();
   });

   const requireUserClient = defineClientMiddleware(async (_ctx, next) => {
     if (typeof window === 'undefined') {
       await next();
       return;
     }
     if (!localStorage.getItem('authed')) throw redirect('/login');
     await next();
   });

   export const requireUser = [requireUserServer, requireUserClient];
   ```

2. Attach it to the route node in `src/routes.ts` with `use:`. Put it on the node you want
   to protect, or on a parent to protect a whole subtree:

   ```ts
   {
     path: '/dashboard',
     view: () => import('./pages/dashboard.js'),
     server: () => import('./pages/dashboard.server.js'),
     use: requireUser,
     // any children here inherit requireUser automatically
   },
   ```

## Verify

- Run `pnpm typecheck`.
- Run `pnpm dev`. Hit the route while unauthorized: you are redirected or denied.
  Authorize, then hit it again: it renders.
- Confirm the data is gated too, not just the render: while unauthorized, the loader and
  any action for that route must also be refused (the server guard runs before them).

## Common mistakes

- Checking auth inside the loader or component. That gates one thing and duplicates logic.
  Use `use:` so render and RPC are gated from one place.
- Repeating the guard on every child. `use:` inherits; put it once on the parent.
- Assuming a render gate covers data. It does here, but verify the loader/action is refused
  while unauthorized.
- Trusting the client guard. It is UX only; security lives in the server middleware.

## Reference

- Access control in depth: see "Middleware" and "CSRF Protection" in `../llms-full.txt`.
- Framework conventions: `../../AGENTS.md`.
