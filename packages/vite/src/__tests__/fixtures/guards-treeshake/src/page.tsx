import {
  defineServerMiddleware,
  defineClientMiddleware,
} from '@hono-preact/iso';
import { SECRET_SERVER_TOKEN } from './server-secrets.js';
import { CLIENT_USER_KEY } from './client-state.js';

const adminMiddleware = defineServerMiddleware<'page'>(async (ctx, next) => {
  (ctx as unknown as { token?: string }).token = SECRET_SERVER_TOKEN;
  await next();
});

const scrollRestore = defineClientMiddleware(async (ctx, next) => {
  (ctx as unknown as { userKey?: string }).userKey = CLIENT_USER_KEY;
  await next();
});

export const use = [adminMiddleware, scrollRestore];
