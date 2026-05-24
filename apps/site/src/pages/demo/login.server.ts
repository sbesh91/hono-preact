import { defineAction, redirect } from 'hono-preact';
import { upsertUser } from '../../demo/data.js';
import { signIn, signOut } from '../../demo/session.js';

export const serverActions = {
  login: defineAction<{ email: string; name: string }, never>(
    async (ctx, input) => {
      const email = (input.email ?? '').trim().toLowerCase();
      const name = (input.name ?? '').trim() || email.split('@')[0];
      if (!email || !email.includes('@')) {
        throw new Error('email is required');
      }
      const user = upsertUser(email, name);
      await signIn(ctx.c, user);
      throw redirect('/demo/projects');
    }
  ),

  logout: defineAction<{}, { ok: true }>(async (ctx) => {
    signOut(ctx.c);
    return { ok: true };
  }),
};
