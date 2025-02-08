import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { createMiddleware } from "hono/factory";
import { locationStub } from "preact-iso/prerender";
import { Base, Layout, Routes } from "./iso.js";

const port = 3000;
const app = new Hono();

locationStub("/");

const location = createMiddleware(async (c, next) => {
  console.log(c.req.url);
  const url = new URL(c.req.url);
  globalThis.location.pathname = url.pathname;
  await next();
});

app
  .use(compress(), location)
  .use(
    "/static/*",
    serveStatic({
      root: "./src",
      rewriteRequestPath: (path) => path.replace(/^\/static/, "./public"),
    })
  )
  .get("*", (c) => {
    return c.html(
      <Layout>
        <Base>
          <Routes />
        </Base>
      </Layout>
    );
  });

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
