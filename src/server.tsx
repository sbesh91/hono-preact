import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { createMiddleware } from "hono/factory";
import { lazy, Route } from "preact-iso";
import { locationStub } from "preact-iso/prerender";
import { Base, Layout } from "./iso.js";

const port = 3000;
const app = new Hono();

const location = createMiddleware(async (c, next) => {
  console.log(c.req.url);
  const url = new URL(c.req.url);
  locationStub(url.pathname);
  await next();
});

const Home = lazy(() => import("./pages/home.js"));
const Test = lazy(() => import("./pages/test.js"));

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
          <Route path="/" component={Home} />
          <Route path="/test" component={Test} />
        </Base>
      </Layout>
    );
  });

console.log(`Server is running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
