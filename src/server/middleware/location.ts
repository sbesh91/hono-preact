import { createMiddleware } from "hono/factory";
import { locationStub } from "preact-iso/prerender";

export const location = createMiddleware(async (c, next) => {
  const url = new URL(c.req.url);
  locationStub(url.pathname);
  await next();
});
