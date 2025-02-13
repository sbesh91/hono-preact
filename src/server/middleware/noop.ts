import { createMiddleware } from "hono/factory";

export const noopMiddleware = createMiddleware(async (_c, next) => {
  await next();
});
