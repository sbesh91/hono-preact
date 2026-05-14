import { defineServerGuard, defineClientGuard } from '@hono-preact/iso';
import { SECRET_SERVER_TOKEN } from './server-secrets.js';
import { CLIENT_USER_KEY } from './client-state.js';

const adminGuard = defineServerGuard(async (ctx, next) => {
  (ctx as unknown as { token?: string }).token = SECRET_SERVER_TOKEN;
  return next();
});

const scrollRestore = defineClientGuard(async (ctx, next) => {
  (ctx as unknown as { userKey?: string }).userKey = CLIENT_USER_KEY;
  return next();
});

export const guards = [adminGuard, scrollRestore];
