import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { prerender } from "preact-iso";
import { Layout } from "./server/layout.js";
import { location } from "./server/middleware/location.js";

const port = 3000;
export const app = new Hono();

app
  .use(compress())
  .use(
    "/static/*",
    serveStatic({
      root: "./src",
      rewriteRequestPath: (path) => path.replace(/^\/static/, "./public"),
    })
  )
  .use(location)
  .get("*", async (c) => {
    const { html } = await prerender(<Layout />);
    return c.html(`<!DOCTYPE html>${html}`);
  });

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
