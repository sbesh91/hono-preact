import { createMiddleware } from "hono/factory";
import { locationStub } from "preact-iso/prerender";

export const location = createMiddleware(async (c, next) => {
  const url = new URL(c.req.url);
  // Pass pathname + search so preact-iso's SSR `globalThis.location` carries
  // the query string. Streaming loaders read `ctx.location.searchParams` and
  // would otherwise see empty params on initial render.
  locationStub(url.pathname + url.search);
  await next();
});
