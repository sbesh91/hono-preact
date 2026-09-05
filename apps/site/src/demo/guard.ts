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

// App-level publisher (AppConfig.use in app-config.ts): runs on every render
// and every loader/action RPC in the whole site, so any cold load of any page
// seeds the client store before a navigation can reach the guarded subtree.
//
// Publishing has to be broader than enforcing. The client leg treats an
// unpublished channel as "not signed in", so a hint published only under
// /demo/projects would be missing for a signed-in visitor who cold-loads /
// and then navigates in: the client chain runs before the first loader RPC,
// reads undefined, and bounces them to /demo/login.
//
// The session lookup runs again in requireSessionServer below on the guarded
// subtree. Caching it across the two would mean a per-request memo keyed on the
// Hono context, which the login and logout actions (which change the cookie
// mid-request) would then have to invalidate. A signed-cookie verify plus an
// idempotent in-memory upsert is cheap, so this stays two plain reads.
export const publishSession = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  session.publish(ctx, { signedIn: Boolean(user) });
  await next();
});

// Server-side check (SSR / full reload + RPC requests for loaders/actions):
// validates the signed cookie and resolves the user. Declared once as `use` on
// the route tree node in routes.ts; the framework runs it for every render and
// every loader/action RPC under that subtree, so unauthenticated requests
// redirect the same way regardless of entry point.
//
// It publishes as well as enforcing, and the publish precedes the redirect
// throw because the redirect response still carries the channel header. An
// expired cookie therefore publishes { signedIn: false } and actively clears
// the client hint, rather than leaving the client leg waving navigations
// through on a stale { signedIn: true }.
const requireSessionServer = defineServerMiddleware(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  session.publish(ctx, { signedIn: Boolean(user) });
  if (!user) throw redirect('/demo/login');
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
