import { defineAction, deny, redirect } from 'hono-preact';
import { upsertUser } from '../../demo/data.js';
import { signIn, signOut } from '../../demo/session.js';
import { LoginSchema } from './login-schema.js';

export const serverActions = {
  login: defineAction(
    async (ctx, input) => {
      // The schema already trimmed and lowercased; this is the business
      // check, thrown as deny so the form receives a 400 with a message it
      // renders (a plain thrown Error would be masked as 'Action failed'
      // in production).
      if (!input.email || !input.email.includes('@')) {
        throw deny(400, 'A valid email is required.');
      }
      const name = input.name || input.email.split('@')[0];
      const user = upsertUser(input.email, name);
      await signIn(ctx.c, user);
      throw redirect('/demo/projects');
    },
    { input: LoginSchema }
  ),

  logout: defineAction<{}, { ok: true }>(async (ctx) => {
    signOut(ctx.c);
    return { ok: true };
  }),
};
