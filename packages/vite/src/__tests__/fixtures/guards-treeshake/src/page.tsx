import { defineServerGuard, defineClientGuard } from '@hono-preact/iso';
import { SECRET_SERVER_TOKEN } from './server-secrets.js';
import { CLIENT_USER_KEY } from './client-state.js';

const adminGuard = defineServerGuard(async (_ctx, next) => {
  if (SECRET_SERVER_TOKEN !== 'expected') return { redirect: '/forbidden' };
  return next();
});

const scrollRestore = defineClientGuard(async (_ctx, next) => {
  if (typeof window !== 'undefined') {
    void CLIENT_USER_KEY;
  }
  return next();
});

export const guards = [adminGuard, scrollRestore];
