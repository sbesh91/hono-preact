import {
  defineServerMiddleware,
  defineClientMiddleware,
  defineSessionChannel,
  redirect,
} from 'hono-preact';
import { currentUser } from './session.js';

// What the server guard tells the client guard on every round-trip. The real
// session truth stays in the HttpOnly signed cookie and the server guard below
// stays authoritative; this is a UX hint so intra-app navigation does not have
// to wait for an RPC to know it will be bounced.
export const session = defineSessionChannel<{ signedIn: boolean }>();

// Server-side check (SSR / full reload + RPC requests for loaders/actions):
// validates the signed cookie and resolves the user. Declared once as `use` on
// the route tree node in routes.ts; the framework runs it for every render and
// every loader/action RPC under that subtree, so unauthenticated requests
// redirect the same way regardless of entry point.
const requireSessionServer = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  if (!user) throw redirect('/demo/login');
  session.publish(ctx, { signedIn: true });
  await next();
});

// Client-side check (intra-app navigation): reads what the last server
// round-trip published. On a full reload hydrateChannelsFromDocument in
// boot-client.ts fills the store from the SSR bootstrap before any client
// chain runs, so there is no window in which the value is missing and no
// defensive `typeof window` bail is needed here. On a client navigation the
// value is whatever the most recent loader or action RPC published.
//
// A response that publishes nothing leaves the store as it was, so the hint is
// cleared by an explicit publish: the logout action in login.server.ts
// publishes { signedIn: false } after signOut.
const requireSessionClient = defineClientMiddleware(async (ctx, next) => {
  if (!session.read(ctx)?.signedIn) throw redirect('/demo/login');
  await next();
});

// requireSession is declared once as `use` on the /demo/projects route node in
// routes.ts. The dispatcher partitions server vs client members by their `runs`
// tag, so handing the same array to the route node gates both render and RPC
// paths without drift.
export const requireSession = [requireSessionServer, requireSessionClient];
