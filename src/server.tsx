import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { createMiddleware } from "hono/factory";
import { Base, Layout, Routes } from "./iso.js";

const port = 3000;
const app = new Hono();

globalThis.location = {
  origin: "",
  pathname: "/",
  search: "",
} as Location;

const location = createMiddleware(async (c, next) => {
  console.log(c.req.url);
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
