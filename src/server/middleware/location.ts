import { createMiddleware } from "hono/factory";
import { locationStub } from "preact-iso/prerender";

export const location = createMiddleware(async (c, next) => {
  console.log(c.req.url);
  const url = new URL(c.req.url);
  locationStub(url.pathname);
  await next();
});
