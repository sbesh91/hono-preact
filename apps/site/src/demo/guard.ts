import { defineServerGuard } from 'hono-preact';
import { currentUser } from './session.js';

export const requireSession = defineServerGuard(async (ctx, next) => {
  const user = await currentUser(ctx.c);
  if (!user) return { redirect: '/demo/login' };
  return next();
});
