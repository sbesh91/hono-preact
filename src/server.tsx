import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prerender } from "preact-iso";
import { Layout } from "./server/layout.js";
import { location } from "./server/middleware/location.js";

const port = 3000;
export const app = new Hono();
const key = readFileSync(resolve("./.env")).toString();
process.env.API_KEY = key;

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
    const { html } = await prerender(<Layout context={c} />);
    return c.html(`<!DOCTYPE html>${html}`);
  });

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
