// A src/server registry module. `logout` lives here rather than beside the
// login route because it is invoked from the app shell on every /demo/projects
// page, not from /demo/login. Actions in a route's own `.server.ts` are
// addressable only from that route's URL (they are indexed by route path, so
// their route `use` chain is always in force); only registry modules are
// addressable by module key from any page, which is what a shell-wide action
// needs.
import { defineAction } from 'hono-preact';
import { signOut } from '../../demo/session.js';
import { session } from '../../demo/guard.js';

export const serverActions = {
  logout: defineAction<{}, { ok: true }>(async (ctx) => {
    signOut(ctx.c);
    // Clear the client guard's hint explicitly. This action is route
    // independent, so it runs none of the /demo/projects route-node
    // middleware, and a response that publishes nothing leaves the client
    // store untouched.
    session.publish(ctx, { signedIn: false });
    return { ok: true };
  }),
};
